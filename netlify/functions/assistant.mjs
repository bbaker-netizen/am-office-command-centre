/* A&M - each person's own assistant (My day).

   GET  /api/assistant                  this person's list, check-ins, chases, inbox sort
   GET  /api/assistant?action=bank      money in and out since they last looked (leadership)
   POST /api/assistant { action, ... }
     add { item }        put something on the list (kind todo, pay, expect, call, ask)
     log { text }        someone at the door, a phone call: joins the list at the next check-in
     say { text }        talk to it ("put this on my list", "I just paid Aces")
     photo { image }     a photo of a paper list: new lines added, ticked lines ticked
     tick | untick | remove | pin { id }
     triage              sort new mail in this person's inboxes now
     draft { inbox, id } a reply drafted into their own Gmail, for them to send
     chase { job..., who, email, what, from }   start a three-day chase
     chaseCall { id, outcome }   the call on day three, and what next
     chaseClose { id }
     checkin { slot }    a check-in now (morning, noon or end)
     seenBank            "I have looked at the bank"
     settings { emailCheckins }

   Whose: always the signed-in person's own. Nobody can read another person's
   assistant, and View as shows the list but not their mail.
   What it writes: this person's assistant record ("assist-<id>"), drafts in
   their own Gmail (never sent), and for promises to pay or money expected,
   one line in the cash flow plan so the weeks stay right. */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit, readAccounts, userOf } from "./_accounts.mjs";
import { withLock } from "./_lock.mjs";
import { cleanEntry, addItem, rank, buildCheckin, chaseStep, chaseStatus, chaseDraft, matchPayments, callContext, parseSaying, localNow, KINDS, newId } from "./_assist.mjs";
import { claude, jsonFrom, hasKey, fastModel, draftModel, OUTSIDE_RULE, STYLE } from "./_claudecall.mjs";
import { readInboxes, tokenFor, recentMail, makeDraft, heardFrom, addressOf, getMessage } from "./_gmail.mjs";
import { query as qboQuery } from "./_qbo.mjs";
import { sendEmail } from "./mail.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const KEY = id => "assist-" + id;
const PLAN = "cashflow-plan";

export async function readDoc(s, id) {
  const d = (await s.get(KEY(id), { type: "json" })) || {};
  return { items: [], checkins: [], chases: [], triage: { at: null, seen: [], items: [] }, settings: {}, lastBankLook: null, ...d };
}
const writeDoc = (s, id, d) => s.setJSON(KEY(id), { ...d, items: (d.items || []).slice(0, 400), checkins: (d.checkins || []).slice(0, 40), chases: (d.chases || []).slice(0, 100) });
async function change(s, id, fn) { return withLock(s, "assist-" + id, async () => { const d = await readDoc(s, id); const out = await fn(d); await writeDoc(s, id, d); return out; }); }

/* ----------------------------------------------------- cash flow links */
async function planChange(s, fn) {
  return withLock(s, "cashflow-plan", async () => {
    const p = await s.get(PLAN, { type: "json" });
    if (!p) return null;                         /* the cash flow page creates it on first open */
    p.done = p.done || {}; p.log = p.log || [];
    const out = fn(p);
    await s.setJSON(PLAN, p);
    return out;
  });
}
/* A promise to pay, or money expected, with an amount: one line in the cash
   flow plan on the date, so the weeks include it. */
async function linkToCashFlow(s, u, it, today) {
  if (!(it.kind === "pay" || it.kind === "expect") || !it.amount || !sees(u, "money") || !canEdit(u)) return null;
  const date = it.due || today;
  return planChange(s, p => {
    const id = "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
    p.items.push({ id, name: (it.kind === "pay" ? "" : "") + (it.who || it.text).slice(0, 60), amount: it.amount, every: "once", start: date, cat: it.kind === "pay" ? "oneoff" : "income", note: "From " + u.name.split(" ")[0] + "'s list: " + it.text.slice(0, 120), fromAssistant: it.id, createdBy: u.name, createdAt: new Date().toISOString() });
    p.log.unshift({ at: new Date().toISOString(), by: u.name, text: "From My day: " + (it.kind === "pay" ? "promised to pay " : "expecting ") + (it.who || it.text) + " $" + it.amount + " on " + date });
    return { cfItemId: id, cfDate: date };
  });
}
async function tickCashFlow(s, u, it, done) {
  if (!it.cfItemId || !it.cfDate) return;
  await planChange(s, p => { const k = "item:" + it.cfItemId + ":" + it.cfDate; if (done) p.done[k] = { at: new Date().toISOString(), by: u.name, via: "My day" }; else delete p.done[k]; });
}

/* ----------------------------------------------------- payments seen */
export async function recentPayments(sinceDate) {
  const out = [];
  try {
    const p = await qboQuery(`select * from Payment where TxnDate >= '${sinceDate}' maxresults 200`);
    for (const x of (p.QueryResponse && p.QueryResponse.Payment) || []) out.push({ kind: "in", name: (x.CustomerRef && x.CustomerRef.name) || "", amount: Number(x.TotalAmt) || 0, date: x.TxnDate, source: "QuickBooks" });
  } catch (e) {}
  try {
    const b = await qboQuery(`select * from BillPayment where TxnDate >= '${sinceDate}' maxresults 200`);
    for (const x of (b.QueryResponse && b.QueryResponse.BillPayment) || []) out.push({ kind: "out", name: (x.VendorRef && x.VendorRef.name) || "", amount: Number(x.TotalAmt) || 0, date: x.TxnDate, source: "QuickBooks" });
  } catch (e) {}
  return out;
}

/* ----------------------------------------------------- mail sorting */
const ROLE_WORDS = u => u.assistant === "exec"
  ? `${u.name} is ${u.title || "a leader"} at A&M Abatement Services (hazardous materials abatement, demolition and restoration, Edmonton and Calgary). Owners: Craig and Amir.`
  : `${u.name} is ${u.title || "a project manager"} at A&M Abatement Services.`;
export async function triage(s, u, { max = 10, autoDraft = 0 } = {}) {
  const inboxes = await readInboxes(s, u.id);
  if (!inboxes.length) return { at: null, items: [], note: "No inbox connected yet." };
  const d = await readDoc(s, u.id);
  const seen = new Set(d.triage.seen || []);
  const fresh = [];
  for (const ib of inboxes) {
    try {
      const tok = await tokenFor(s, u.id, ib.email);
      const mail = await recentMail(tok, { max, skip: [...seen] });
      mail.forEach(m => fresh.push({ ...m, inbox: ib.email }));
    } catch (e) { fresh.push({ error: e.message, inbox: ib.email }); }
  }
  const msgs = fresh.filter(m => !m.error).slice(0, max);
  let sorted = [];
  if (msgs.length && hasKey()) {
    const text = await claude({
      model: fastModel(), max_tokens: 2000,
      system: `You sort a person's email for their personal assistant. ${ROLE_WORDS(u)} ${OUTSIDE_RULE}
Return only a JSON array, one object per email, in the same order: {"id":"...","bucket":"needs_you"|"payment"|"fyi"|"not_yours"|"junk","why":"under 12 words","who":"sender's name","action":"what they need to do, under 10 words, or empty","payment":null or {"direction":"in"|"out","name":"who paid or was paid","amount":number},"draft":true|false}.
needs_you: a person asking ${u.name.split(" ")[0]} for a decision, an answer, money or a call. payment: an e-transfer, deposit, bank notice or payment portal notice showing money in or out. not_yours: estimating mail (bids, quotes, tenders, plan downloads), mail meant for someone else's work, or copies where someone else is handling it. fyi: worth knowing, nothing to do. junk: marketing, newsletters, automatic notices with nothing to do.
draft is true only when a short written reply would help.`,
      messages: [{ role: "user", content: msgs.map(m => `<email id="${m.id}">\nFrom: ${m.from}\nTo: ${m.to}${m.cc ? "\nCc: " + m.cc : ""}\nSubject: ${m.subject}\nDate: ${m.date}\n\n${(m.body || m.snippet).slice(0, 1200)}\n</email>`).join("\n\n") }]
    }).catch(e => { throw new Error("Sorting the mail did not work: " + e.message); });
    const arr = jsonFrom(text);
    sorted = Array.isArray(arr) ? arr : [];
  }
  const byId = Object.fromEntries(sorted.filter(x => x && x.id).map(x => [x.id, x]));
  const items = msgs.map(m => { const c = byId[m.id] || {}; return { id: m.id, threadId: m.threadId, inbox: m.inbox, from: m.from, address: addressOf(m.from), subject: m.subject, date: m.date, messageId: m.messageId, snippet: (m.snippet || "").slice(0, 240),
    bucket: ["needs_you", "payment", "fyi", "not_yours", "junk"].includes(c.bucket) ? c.bucket : (hasKey() ? "fyi" : "unsorted"), why: String(c.why || "").slice(0, 120), who: String(c.who || "").slice(0, 80), action: String(c.action || "").slice(0, 100),
    payment: c.payment && c.payment.name ? { direction: c.payment.direction === "out" ? "out" : "in", name: String(c.payment.name).slice(0, 80), amount: Number(c.payment.amount) || 0 } : null, wantsDraft: !!c.draft, at: new Date().toISOString() }; });
  /* Drafts for the top few that need a reply (scheduled runs only). */
  for (const it of items.filter(x => x.bucket === "needs_you" && x.wantsDraft).slice(0, autoDraft)) {
    try { const m = msgs.find(x => x.id === it.id); const dr = await draftReply(s, u, it, m); it.draft = dr; } catch (e) { it.draftError = e.message; }
  }
  const errors = fresh.filter(m => m.error).map(m => m.inbox + ": " + m.error);
  await change(s, u.id, doc => {
    doc.triage = { at: new Date().toISOString(), seen: [...new Set([...(doc.triage.seen || []), ...msgs.map(m => m.id)])].slice(-600), items: items.concat(doc.triage.items || []).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, 120), errors };
    /* e-transfers and payment notices can tick a sticky note */
    const pays = items.filter(x => x.payment).map(x => ({ kind: x.payment.direction, name: x.payment.name, amount: x.payment.amount, date: localNow().date, source: "email from " + (x.who || x.address) }));
    for (const m of matchPayments(doc.items, pays)) { const it = doc.items.find(x => x.id === m.id); if (it) { it.done = true; it.doneAt = new Date().toISOString(); it.doneWhy = m.reason; } }
  });
  return { at: new Date().toISOString(), count: items.length, errors };
}

async function draftReply(s, u, it, full) {
  const tok = await tokenFor(s, u.id, it.inbox);
  const body = await claude({ model: draftModel(), max_tokens: 700,
    system: `You draft a short email reply for ${u.name} (${u.title || "A&M Abatement Services"}) to send himself after reading it. ${OUTSIDE_RULE} ${STYLE} Never promise money, dates or prices that are not in the email; where a decision is needed, leave a clear [square bracket] for ${u.name.split(" ")[0]} to fill in. Sign off with "${u.name.split(" ")[0]}". Return only the email body.`,
    messages: [{ role: "user", content: `<email>\nFrom: ${it.from}\nSubject: ${it.subject}\n\n${((full && full.body) || it.snippet || "").slice(0, 3000)}\n</email>\n\nDraft the reply.` }] });
  const subject = /^re:/i.test(it.subject) ? it.subject : "Re: " + it.subject;
  return makeDraft(tok, { to: it.address, subject, body, threadId: it.threadId, inReplyTo: it.messageId });
}

/* ----------------------------------------------------- the chase */
export async function runChases(s, u, today) {
  const d = await readDoc(s, u.id);
  const notes = [];
  for (const ch of d.chases || []) {
    if (ch.closed || ch.answeredAt) continue;
    /* answered? */
    if (ch.email && ch.inbox) {
      try { const tok = await tokenFor(s, u.id, ch.inbox); if (await heardFrom(tok, ch.email, ch.startedOn)) { ch.answeredAt = new Date().toISOString(); notes.push(ch.who + " answered about " + ch.what); continue; } } catch (e) {}
    }
    const st = chaseStep(ch, today);
    if (st.step === "draft" && ch.email) {
      const dr = chaseDraft(ch, st.day, u.name.split(" ")[0]);
      try {
        let made;
        if (ch.from === "robots") made = await robotsDraft(s, ch.email, dr.subject, dr.body, u.email);
        else { const tok = await tokenFor(s, u.id, ch.inbox); made = await makeDraft(tok, { to: ch.email, subject: dr.subject, body: dr.body }); }
        ch.drafts = (ch.drafts || []).concat([{ date: today, n: st.day, draftId: made.draftId }]);
        notes.push(`Chase ${st.day} of 3 to ${ch.who} is drafted for you to send.`);
      } catch (e) { ch.lastError = e.message; }
    } else if (st.step === "call" && !ch.callItem) {
      const it = addItem(d, { text: `Call ${ch.who} about ${ch.what}${ch.jobNumber ? " (job " + ch.jobNumber + ")" : ""}. Three emails, no answer.`, kind: "call", who: ch.who, amount: null, due: today, source: "chase", pinned: true, jobId: ch.jobId || "", jobNumber: ch.jobNumber || "", since: today }, new Date().toISOString());
      ch.callItem = it.id; notes.push(`Day three on ${ch.who}: it is on your list to call.`);
    }
  }
  await withLock(s, "assist-" + u.id, async () => { const cur = await readDoc(s, u.id); cur.chases = d.chases; cur.items = d.items.concat((cur.items || []).filter(x => !d.items.some(y => y.id === x.id))); await writeDoc(s, u.id, cur); });
  return notes;
}
/* A chase drafted in the robots' mailbox (automation@), when the person
   approved that. It waits in To send like every robot draft. */
async function robotsDraft(s, to, subject, body, replyTo) {
  const { makeRobotsDraft } = await import("./mail.mjs");
  return makeRobotsDraft({ to, subject, body, replyTo });
}

/* ----------------------------------------------------- one person's check-in
   Used by the scheduled check-ins (assistant-run-background.mjs) and by the
   "Check in now" button. */
export async function runFor(s, u, slot, { heavy = true } = {}) {
  const now = new Date(), L = localNow(now), notes = [];
  if (heavy && (slot === "morning" || slot === "noon")) {
    try { const t = await triage(s, u, { max: 15, autoDraft: slot === "morning" ? 3 : 1 }); if (t.count) notes.push(`Sorted ${t.count} new email${t.count === 1 ? "" : "s"}.`); } catch (e) { notes.push(e.message); }
  }
  if (slot === "morning") { try { notes.push(...await runChases(s, u, L.date)); } catch (e) { notes.push("The chases did not run: " + e.message); } }
  let pays = [];
  if (u.assistant === "exec" && sees(u, "money")) { try { pays = await recentPayments(new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)); } catch (e) {} }
  const c = await change(s, u.id, d => {
    for (const m of matchPayments(d.items, pays)) { const it = d.items.find(x => x.id === m.id); if (it && !it.done) { it.done = true; it.doneAt = now.toISOString(); it.doneWhy = m.reason; } }
    const c = buildCheckin(d, slot, now);
    const ctx = callContext(d.items, pays);
    if (ctx.length) { c.context = ctx.map(x => x.text); c.text += "\n\n" + c.context.join("\n"); }
    const needs = (d.triage.items || []).filter(x => x.bucket === "needs_you" && !x.handled).length;
    if (needs) c.text += `\n\n${needs} email${needs === 1 ? "" : "s"} need${needs === 1 ? "s" : ""} you.`;
    if (notes.length) c.text += "\n\n" + notes.join("\n");
    return { c, email: d.settings.emailCheckins !== false };
  });
  if (c.email && u.email) {
    const site = process.env.URL || "https://am-office-command-centre.netlify.app";
    const title = { morning: "Your day", noon: "Noon check-in", end: "End of day" }[slot];
    try { await sendEmail({ to: u.email, subject: `${title} - ${L.date}`, text: c.c.text + `\n\nOpen My day: ${site}/command.html#brief`, html: `<div style="font-family:Arial;font-size:14px;color:#1a1917;line-height:1.5">${c.c.text.split("\n").map(x => x.replace(/&/g, "&amp;").replace(/</g, "&lt;")).join("<br>")}<p><a href="${site}/command.html#brief" style="color:#329dbb">Open My day</a></p></div>` }); }
    catch (e) { /* the check-in is still in the app */ }
  }
  return c.c;
}

/* ----------------------------------------------------- talking to it */
async function understand(u, text, open, today) {
  if (!hasKey()) { const p = parseSaying(text, today); return { add: [p], tick: [], reply: "Added: " + p.text }; }
  const out = await claude({ model: fastModel(), max_tokens: 800,
    system: `You are ${u.name.split(" ")[0]}'s assistant at A&M Abatement Services. They speak or type short notes. Today is ${today}. ${OUTSIDE_RULE}
Turn the note into list changes. Return only JSON: {"add":[{"text":"short line","kind":"todo"|"pay"|"expect"|"call"|"ask","who":"person or company or empty","amount":number or null,"due":"YYYY-MM-DD or empty"}],"tick":["id of an open item the note says is done"],"reply":"one short sentence back to them"}.
pay: they promised to pay someone. expect: money they expect in. call: a call to return or make. ask: someone asked them for something. "I just paid X" or "X paid me" ticks the matching open item. Do not invent amounts or dates.
Open items: ${JSON.stringify(open.slice(0, 60).map(x => ({ id: x.id, text: x.text, kind: x.kind, who: x.who })))}`,
    messages: [{ role: "user", content: `<saying>${String(text).slice(0, 1500)}</saying>` }] });
  const j = jsonFrom(out) || {};
  return { add: Array.isArray(j.add) ? j.add : [], tick: Array.isArray(j.tick) ? j.tick : [], reply: String(j.reply || "Done.").slice(0, 300) };
}
async function readPhoto(u, dataUrl, open) {
  if (!hasKey()) throw new Error("Reading a photo needs the Claude key in Netlify.");
  const m = String(dataUrl || "").match(/^data:(image\/(?:png|jpeg|webp|gif));base64,(.+)$/);
  if (!m) throw new Error("That was not a photo the app can read.");
  if (m[2].length > 6_500_000) throw new Error("That photo is too big. Take it again a little further away.");
  const out = await claude({ model: draftModel(), max_tokens: 1200,
    system: `You read a photo of ${u.name.split(" ")[0]}'s handwritten or printed to-do list for their assistant. ${OUTSIDE_RULE} Return only JSON: {"lines":[{"text":"the line as written, tidied","done":true|false,"kind":"todo"|"pay"|"expect"|"call","who":"","amount":number or null}],"unclear":["anything you could not read"]}. A line crossed out or ticked is done. Open items already on their list: ${JSON.stringify(open.slice(0, 60).map(x => ({ id: x.id, text: x.text })))}. For a done line that matches an open item, add "id" with that item's id.`,
    messages: [{ role: "user", content: [{ type: "image", source: { type: "base64", media_type: m[1], data: m[2] } }, { type: "text", text: "Read this list." }] }] });
  return jsonFrom(out) || { lines: [] };
}

/* ----------------------------------------------------- the door */
export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  const live = u.assistant === "exec" || (u.assistant === "project" && (u.projectLive || u.admin));
  if (!live && !u.viewAs) return json({ error: "off", message: u.assistant === "project" ? "Your project assistant is ready but not switched on for staff yet. Craig and Amir switch it on." : "You do not have a personal assistant yet. An admin sets one up on People and access." }, 403);
  const url = new URL(req.url), today = localNow().date;

  try {
    if (req.method === "GET") {
      const action = url.searchParams.get("action") || "";
      if (action === "bank") {
        if (!sees(u, "money")) return json({ error: "role", message: "The bank is part of Money." }, 403);
        const d = await readDoc(s, u.id);
        const since = (d.lastBankLook || new Date(Date.now() - 7 * 86400000).toISOString()).slice(0, 10);
        const pays = await recentPayments(since);
        const bank = (await s.get("bank-actual", { type: "json" })) || { history: [] };
        return json({ since, lastLook: d.lastBankLook, in: pays.filter(p => p.kind === "in").sort((a, b) => b.amount - a.amount), out: pays.filter(p => p.kind === "out").sort((a, b) => b.amount - a.amount), balances: (bank.history || []).filter(h => h.date >= since).slice(0, 5) });
      }
      const d = await readDoc(s, u.id);
      const ib = await readInboxes(s, u.id);
      /* View as shows mail too: Craig, 2026-11-15 ("it can show someone's
         email"). Only admins can use View as, and it stays look only. */
      const hideMail = false;
      return json({
        role: u.assistant, live, name: u.name, today, settings: d.settings,
        open: rank(d.items, today), held: d.items.filter(x => x.held && !x.done), doneToday: d.items.filter(x => x.done && String(x.doneAt || "").slice(0, 10) === today),
        doneRecent: d.items.filter(x => x.done && x.doneWhy).slice(0, 10),
        checkins: d.checkins.slice(0, 6),
        chases: (d.chases || []).filter(c => !c.closed).map(c => ({ ...c, status: chaseStatus(c, today), step: chaseStep(c, today).step })),
        inboxes: ib.map(x => ({ email: x.email, addedAt: x.addedAt })),
        triage: hideMail ? { at: d.triage.at, hidden: true, counts: countBuckets(d.triage.items) } : { at: d.triage.at, items: (d.triage.items || []).filter(x => !x.handled).slice(0, 60), errors: d.triage.errors || [] },
        claude: hasKey()
      });
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
    const b = await req.json().catch(() => ({}));
    const nowIso = new Date().toISOString();
    const A = b.action;

    if (A === "add" || A === "log") {
      const ck = cleanEntry({ ...(b.item || { text: b.text }), source: A === "log" ? "logged" : ((b.item && b.item.source) || "typed") }, today);
      if (!ck.ok) return json({ error: "bad", message: ck.message }, 400);
      const it = await change(s, u.id, d => addItem(d, ck.value, nowIso, { held: A === "log" }));
      const link = await linkToCashFlow(s, u, it, today).catch(() => null);
      if (link) await change(s, u.id, d => { const x = d.items.find(y => y.id === it.id); if (x) Object.assign(x, link); });
      return json({ ok: true, item: it, cashflow: !!link });
    }
    if (A === "say") {
      const text = String(b.text || "").trim(); if (!text) return json({ error: "bad", message: "Say something first." }, 400);
      const d0 = await readDoc(s, u.id);
      const plan = await understand(u, text, rank(d0.items, today), today);
      const added = [], ticked = [];
      for (const a of plan.add.slice(0, 8)) { const ck = cleanEntry({ ...a, source: b.voice ? "voice" : "typed" }, today); if (!ck.ok) continue; const it = await change(s, u.id, d => addItem(d, ck.value, nowIso)); const link = await linkToCashFlow(s, u, it, today).catch(() => null); if (link) await change(s, u.id, d => { const x = d.items.find(y => y.id === it.id); if (x) Object.assign(x, link); }); added.push(it.text); }
      for (const id of plan.tick.slice(0, 8)) { const it = await change(s, u.id, d => { const x = d.items.find(y => y.id === id && !y.done); if (x) { x.done = true; x.doneAt = nowIso; x.doneWhy = "You said: " + text.slice(0, 80); } return x; }); if (it) { ticked.push(it.text); await tickCashFlow(s, u, it, true); } }
      return json({ ok: true, reply: plan.reply, added, ticked });
    }
    if (A === "photo") {
      const d0 = await readDoc(s, u.id);
      const r = await readPhoto(u, b.image, rank(d0.items, today));
      const added = [], ticked = [];
      for (const l of (r.lines || []).slice(0, 40)) {
        if (l.done && l.id) { const it = await change(s, u.id, d => { const x = d.items.find(y => y.id === l.id && !y.done); if (x) { x.done = true; x.doneAt = nowIso; x.doneWhy = "Ticked on your paper list"; } return x; }); if (it) { ticked.push(it.text); await tickCashFlow(s, u, it, true); } continue; }
        if (l.done) continue;
        const ck = cleanEntry({ ...l, source: "photo" }, today); if (!ck.ok) continue;
        if (d0.items.some(x => !x.done && x.text.toLowerCase() === ck.value.text.toLowerCase())) continue;
        const it = await change(s, u.id, d => addItem(d, ck.value, nowIso)); added.push(it.text);
      }
      return json({ ok: true, added, ticked, unclear: r.unclear || [] });
    }
    if (["tick", "untick", "remove", "pin"].includes(A)) {
      const it = await change(s, u.id, d => {
        const i = d.items.findIndex(x => x.id === b.id); if (i < 0) return null;
        const x = d.items[i];
        if (A === "tick") { x.done = true; x.doneAt = nowIso; x.doneWhy = ""; }
        if (A === "untick") { x.done = false; x.doneAt = null; x.doneWhy = ""; }
        if (A === "pin") x.pinned = !x.pinned;
        if (A === "remove") d.items.splice(i, 1);
        return x;
      });
      if (!it) return json({ error: "missing", message: "That is not on your list any more." }, 404);
      if (A === "tick" || A === "untick") await tickCashFlow(s, u, it, A === "tick");
      return json({ ok: true });
    }
    if (A === "triage") return json(await triage(s, u, { max: 8, autoDraft: 0 }));
    if (A === "draft") {
      const d = await readDoc(s, u.id);
      const it = (d.triage.items || []).find(x => x.id === b.id); if (!it) return json({ error: "missing", message: "That email is not in the sort any more." }, 404);
      const tok = await tokenFor(s, u.id, it.inbox);
      const full = await getMessage(tok, it.id).catch(() => null);
      const dr = await draftReply(s, u, it, full);
      await change(s, u.id, d2 => { const x = (d2.triage.items || []).find(y => y.id === it.id); if (x) x.draft = dr; });
      return json({ ok: true, draft: dr });
    }
    if (A === "handled") { await change(s, u.id, d => { const x = (d.triage.items || []).find(y => y.id === b.id); if (x) x.handled = nowIso; }); return json({ ok: true }); }
    if (A === "chase") {
      const who = String(b.who || "").trim().slice(0, 80), what = String(b.what || "").trim().slice(0, 200), email = String(b.email || "").trim().toLowerCase();
      if (!who || !what) return json({ error: "bad", message: "Say who owes the information and what it is." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({ error: "bad", message: "That email address does not look right." }, 400);
      const ib = await readInboxes(s, u.id);
      const from = b.from === "robots" ? "robots" : "me";
      if (email && from === "me" && !ib.length) return json({ error: "inbox", message: "Connect your inbox under My day first, so the chase drafts go into your own Gmail. Or choose the robots' mailbox." }, 409);
      const ch = { id: newId(), jobId: String(b.jobId || ""), jobNumber: String(b.jobNumber || ""), jobName: String(b.jobName || "").slice(0, 80), who, email, what, from, inbox: ib[0] ? ib[0].email : "", startedOn: today, startedAt: nowIso, drafts: [] };
      await change(s, u.id, d => { d.chases = [ch].concat(d.chases || []); });
      const notes = email ? await runChases(s, u, today) : [];
      return json({ ok: true, chase: ch, notes });
    }
    if (A === "chaseCall") {
      const outcome = String(b.outcome || "").trim().slice(0, 400);
      const d0 = await readDoc(s, u.id); const ch = (d0.chases || []).find(c => c.id === b.id);
      if (!ch) return json({ error: "missing", message: "That chase is not there any more." }, 404);
      let next = "Ask the site or the general contractor's project manager directly, and note the delay on the job in JobTread.";
      if (hasKey() && outcome) { try { next = (await claude({ model: fastModel(), max_tokens: 200, system: `You suggest one practical next step, in one or two short sentences, for a general manager at an abatement and demolition contractor chasing missing information. ${STYLE} ${OUTSIDE_RULE}`, messages: [{ role: "user", content: `Chasing ${ch.who} for: ${ch.what}${ch.jobName ? " (job " + ch.jobNumber + " " + ch.jobName + ")" : ""}. Three emails got no answer. The call: <saying>${outcome}</saying>. What next?` }] })).slice(0, 400); } catch (e) {} }
      await change(s, u.id, d => { const c = d.chases.find(x => x.id === b.id); if (c) { c.called = nowIso; c.callOutcome = outcome; c.nextStep = next; } const it = d.items.find(x => x.id === (c && c.callItem)); if (it && !it.done) { it.done = true; it.doneAt = nowIso; it.doneWhy = "Called: " + outcome.slice(0, 80); } });
      return json({ ok: true, nextStep: next });
    }
    if (A === "chaseClose") { await change(s, u.id, d => { const c = (d.chases || []).find(x => x.id === b.id); if (c) c.closed = nowIso; }); return json({ ok: true }); }
    if (A === "checkin") { const slot = ["morning", "noon", "end"].includes(b.slot) ? b.slot : "noon"; return json({ ok: true, checkin: await runFor(s, u, slot, { heavy: false }) }); }
    if (A === "seenBank") { await change(s, u.id, d => { d.lastBankLook = nowIso; }); return json({ ok: true }); }
    if (A === "settings") { await change(s, u.id, d => { d.settings = { ...d.settings, emailCheckins: b.emailCheckins !== false }; }); return json({ ok: true }); }
    return json({ error: "bad", message: "Unknown request." }, 400);
  } catch (e) {
    return json({ error: e.code === "NO_KEY" ? "no_key" : "upstream", message: e.message }, e.code === "NO_KEY" ? 409 : 502);
  }
};
function countBuckets(items) { const c = {}; for (const x of items || []) if (!x.handled) c[x.bucket] = (c[x.bucket] || 0) + 1; return c; }

/* Everyone who has a live assistant, for the scheduled check-ins. */
export async function assistantPeople(s) {
  const { accounts, settings } = await readAccounts(s);
  return Object.values(accounts).filter(a => a.active !== false).map(a => userOf(a, settings)).filter(u => u.assistant === "exec" || (u.assistant === "project" && u.projectLive));
}

export const config = { path: "/api/assistant" };
