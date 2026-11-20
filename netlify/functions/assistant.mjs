/* A&M - each person's own assistant (My day).

   GET  /api/assistant                  this person's list, check-ins, chases, inbox sort
   GET  /api/assistant?action=bank      money in and out since they last looked (leadership)
   POST /api/assistant { action, ... }
     add { item }        put something on the list (kind todo, pay, expect, call, ask)
     log { text }        someone at the door, a phone call: joins the list at the next check-in
     say { text }        talk to it ("put this on my list", "I just paid Aces")
     photo { image }     a photo of a paper list: new lines added, ticked lines ticked
     tick | untick | remove | pin { id }
     triage              sort new mail in this person's inboxes now; what needs
                         them goes onto their hit list
     send { id, body? }  approve the drafted reply (changed or not): it is sent
                         from their own Gmail, as them. The only thing that sends.
     redraft { id, note } draft it again, saying what they asked for
     notMine { id, always } not theirs; with always, remembered for next time
     later { id, until } off the queue until the next working day
     handoff { id, to, note } sent to a colleague with a note; a check goes on the list
     vip { address, on } a sender who always matters
     rsvp { inbox, eventId, answer } accept, decline or maybe a meeting invite
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
   their own Gmail, and for promises to pay or money expected,
   one line in the cash flow plan so the weeks stay right. */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit, readAccounts, userOf } from "./_accounts.mjs";
import { withLock } from "./_lock.mjs";
import { cleanBid } from "./_assist.mjs";
import { applyClaims } from "./_claims.mjs";
import { ROLES, ROLE_KEYS, roleInfo } from "./_roles.mjs";
import { cleanEntry, addItem, rank, buildCheckin, chaseStep, chaseStatus, chaseDraft, matchPayments, callContext, parseSaying, localNow, KINDS, newId, mailToList, mailDone, listDoneForMail, nextWorkingDay, learnNotMine, setVip, rulesText, afterThread, queueOf } from "./_assist.mjs";
import { claude, jsonFrom, hasKey, fastModel, draftModel, OUTSIDE_RULE, STYLE } from "./_claudecall.mjs";
import { readInboxes, tokenFor, SHARED_ESTIMATING, recentMail, makeDraft, heardFrom, addressOf, getMessage, threadInfo, sentSamples, updateDraft, sendDraft, sendNow, hasCalendar, calEvents, calRespond } from "./_gmail.mjs";
import { query as qboQuery } from "./_qbo.mjs";
import { sendEmail } from "./mail.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const KEY = id => "assist-" + id;
const PLAN = "cashflow-plan";

export async function readDoc(s, id) {
  const d = (await s.get(KEY(id), { type: "json" })) || {};
  return { items: [], checkins: [], chases: [], triage: { at: null, seen: [], items: [] }, settings: {}, lastBankLook: null, rules: { notMine: [], vip: [] }, handoffs: [], ...d };
}
const writeDoc = (s, id, d) => s.setJSON(KEY(id), { ...d, handoffs: (d.handoffs || []).slice(0, 100), items: (d.items || []).slice(0, 400), checkins: (d.checkins || []).slice(0, 40), chases: (d.chases || []).slice(0, 100) });
async function change(s, id, fn) { return withLock(s, "assist-" + id, async () => { const d = await readDoc(s, id); const out = await fn(d); await writeDoc(s, id, d); return out; }); }

/* ----------------------------------------------------- inboxes
   An estimator's assistant also reads the shared estimating@ inbox (Craig,
   2026-11-20). An admin connects it once, under Admin, Connections; it is
   kept apart from anyone's own inboxes and nobody can remove it from My day. */
export async function inboxesFor(s, u) {
  const own = (await readInboxes(s, u.id)).map(x => ({ ...x, owner: u.id }));
  if (u.assistant !== "estimator") return own;
  const shared = (await readInboxes(s, SHARED_ESTIMATING)).filter(x => !own.some(o => o.email === x.email)).map(x => ({ ...x, owner: SHARED_ESTIMATING, shared: true }));
  return own.concat(shared);
}
async function tokenOf(s, u, email) {
  const e = String(email || "").toLowerCase();
  if (u.assistant === "estimator" && !(await readInboxes(s, u.id)).some(x => x.email === e) && (await readInboxes(s, SHARED_ESTIMATING)).some(x => x.email === e)) return tokenFor(s, SHARED_ESTIMATING, e);
  return tokenFor(s, u.id, e);
}

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
  await planChange(s, p => {
    const k = "item:" + it.cfItemId + ":" + it.cfDate, at = new Date().toISOString();
    /* The tick moves the room on the line now (see movesSince in _cashflow.mjs). */
    p.moves = (p.moves || []).filter(m => m.key !== k);
    if (done) { p.done[k] = { at, by: u.name, via: "My day" }; if (it.amount) p.moves.push({ key: k, side: it.kind === "expect" ? "in" : "out", amount: it.amount, name: it.who || it.text, at, day: localNow().date, by: u.name }); }
    else delete p.done[k];
  });
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
/* Who the person is and what their work is, by position (_roles.mjs). */
const ROLE_WORDS = u => { const r = ROLES[u.assistant] || ROLES.admin; return `${u.name} is ${u.title ? u.title + ", " : ""}${r.words} What needs them most: ${r.focus}.`; };
/* For an estimator: what to pick out of bid mail, and who has taken which job. */
const BID_RULE = (u, taken) => u.assistant !== "estimator" ? "" : `
This person is an estimator. Add "bid" to each object: null, or {"kind":"invite"|"addendum"|"rfi"|"site_visit"|"quote_reply","job":"the A&M job number if the email names one (like 26-00123), or empty","project":"project or site name, under 8 words","closes":"YYYY-MM-DD the bid closes or the site visit is, or empty"}. invite: a new tender or invitation to bid. addendum and rfi: changes or questions on a bid already open. site_visit: a walkthrough or site visit being set up. quote_reply: a client answering a quote A&M sent. All of these are needs_you, unless someone else has taken that job (below). A bid invite gets draft false: they read the documents first.
Estimates already taken (job number: who has it): ${taken.length ? taken.join("; ") : "none"}. When an email is about a job someone else has taken, it is not_yours.`;
async function claimsNow(s) {
  try {
    const hit = await s.get("cc-cache-claims", { type: "json" });
    if (hit && Date.now() - hit.at < 600000) return (hit.data && hit.data.claims) || {};
    const { readClaims } = await import("./command.mjs");
    const d = await readClaims(s);
    await s.setJSON("cc-cache-claims", { at: Date.now(), data: d }).catch(() => {});
    return d.claims || {};
  } catch (e) { return {}; }
}
export async function triage(s, u, { max = 10, autoDraft = 0 } = {}) {
  const inboxes = await inboxesFor(s, u);
  if (!inboxes.length) return { at: null, items: [], note: "No inbox connected yet." };
  const d = await readDoc(s, u.id);
  const seen = new Set(d.triage.seen || []);
  const fresh = [];
  for (const ib of inboxes) {
    try {
      const tok = await tokenOf(s, u, ib.email);
      const mail = await recentMail(tok, { max, skip: [...seen] });
      mail.forEach(m => fresh.push({ ...m, inbox: ib.email }));
    } catch (e) { fresh.push({ error: e.message, inbox: ib.email }); }
  }
  const msgs = fresh.filter(m => !m.error).slice(0, max);
  /* The conversation each email sits in: already answered by this person, or
     by someone else at A&M. */
  const mine = [u.email].concat(inboxes.map(x => x.email)).filter(Boolean).map(x => x.toLowerCase());
  const domains = (process.env.INBOX_DOMAINS || "amabatement.com").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  for (const m of msgs) {
    try { const tok = await tokenOf(s, u, m.inbox); m.thread = await threadInfo(tok, m.threadId, m.id, mine, domains); } catch (e) { m.thread = null; }
  }
  const staff = await staffList(s, u);
  const rules = rulesText(d);
  const claims = u.assistant === "estimator" ? await claimsNow(s) : {};
  const taken = Object.values(claims).filter(c => c.jobNumber).slice(0, 80).map(c => c.jobNumber + ": " + c.by);
  const threadLine = m => !m.thread ? "" : "\nConversation: " + (m.thread.count > 1 ? m.thread.count + " emails." : "first email.") + (m.thread.repliedAfter ? " " + u.name.split(" ")[0] + " has ALREADY REPLIED after this email." : "") + (m.thread.othersAfter.length ? " Replied after this email, from A&M: " + m.thread.othersAfter.join(", ") + "." : "");
  let sorted = [];
  if (msgs.length && hasKey()) {
    const text = await claude({
      model: fastModel(), max_tokens: Math.min(8000, 600 + msgs.length * 220),
      system: `You sort a person's email for their personal assistant. ${ROLE_WORDS(u)} Their own addresses: ${[u.email].concat(inboxes.map(x => x.email)).filter((x, i, a) => x && a.indexOf(x) === i).join(", ")}. ${OUTSIDE_RULE}
Return only a JSON array, one object per email, in the same order: {"id":"...","bucket":"needs_you"|"payment"|"fyi"|"not_yours"|"junk","why":"under 12 words","who":"sender's name","action":"what ${u.name.split(" ")[0]} has to do, starting with a verb, under 12 words, naming the job, person or amount (for example: Send Bryan's $800 LOA for Cana Lloydminster), or empty","payment":null or {"direction":"in"|"out","name":"who paid or was paid","amount":number},"draft":true|false,"handTo":"email address of the one colleague below who should deal with it instead, or empty"}.
needs_you: a person asking ${u.name.split(" ")[0]} for a decision, an approval, an answer, money, a document or a call. This includes staff and partners at A&M writing to ${u.name.split(" ")[0]} directly (their address is in To), a customer or supplier chasing an invoice or a payment, a bank or insurer asking for something, and a JobTread message posted to ${u.name.split(" ")[0]} that asks for something. If ${u.name.split(" ")[0]} is the one who has to act, it is needs_you even when others are copied. payment: an e-transfer, deposit, bank notice or payment portal notice showing money in or out. not_yours: ${(ROLES[u.assistant] || {}).notMine ? (ROLES[u.assistant].notMine + ", or ") : ""}mail where ${u.name.split(" ")[0]} is only copied (in Cc) and someone else is clearly handling it. Never use not_yours for mail sent To ${u.name.split(" ")[0]} that asks them for something. fyi: worth knowing, nothing to do. junk: marketing, newsletters, automatic notices with nothing to do.
draft is true only when a short written reply would help.
The Conversation line under each email says what has happened since. If ${u.name.split(" ")[0]} has already replied, it is fyi. If someone else at A&M has already replied and is dealing with it, it is not_yours unless ${u.name.split(" ")[0]} is still asked for something only they can give.
handTo: only when the email is plainly another person's job and they are in this list. Colleagues: ${staff.map(x => `${x.name}${x.title ? " (" + x.title + ")" : ""} <${x.email}>`).join("; ") || "none listed"}.${BID_RULE(u, taken)}
${rules}`,
      messages: [{ role: "user", content: msgs.map(m => `<email id="${m.id}">\nFrom: ${m.from}\nTo: ${m.to}${m.cc ? "\nCc: " + m.cc : ""}\nSubject: ${m.subject}\nDate: ${m.date}${threadLine(m)}\n\n${(m.body || m.snippet).slice(0, 1200)}\n</email>`).join("\n\n") }]
    }).catch(e => { throw new Error("Sorting the mail did not work: " + e.message); });
    const arr = jsonFrom(text);
    sorted = Array.isArray(arr) ? arr : [];
  }
  const byId = Object.fromEntries(sorted.filter(x => x && x.id).map(x => [x.id, x]));
  const staffMail = new Set(staff.map(x => x.email));
  let items = msgs.map(m => { const c = byId[m.id] || {}; return afterThread({ id: m.id, bid: u.assistant === "estimator" ? cleanBid(c.bid) : null, shared: !!(inboxes.find(x => x.email === m.inbox) || {}).shared, threadId: m.threadId, inbox: m.inbox, from: m.from, address: addressOf(m.from), subject: m.subject, date: m.date, messageId: m.messageId, snippet: (m.snippet || "").slice(0, 240),
    bucket: ["needs_you", "payment", "fyi", "not_yours", "junk"].includes(c.bucket) ? c.bucket : (hasKey() ? "fyi" : "unsorted"), why: String(c.why || "").slice(0, 120), who: String(c.who || "").slice(0, 80), action: String(c.action || "").slice(0, 100),
    payment: c.payment && c.payment.name ? { direction: c.payment.direction === "out" ? "out" : "in", name: String(c.payment.name).slice(0, 80), amount: Number(c.payment.amount) || 0 } : null, wantsDraft: !!c.draft, at: new Date().toISOString(),
    handTo: staffMail.has(String(c.handTo || "").toLowerCase()) ? String(c.handTo).toLowerCase() : "", othersReplied: (m.thread && m.thread.othersAfter) || [] }, m.thread); });
  /* An estimate someone else has taken is theirs, whatever the sorting said. */
  if (u.assistant === "estimator") items = applyClaims(items, claims, u.name);
  /* Drafts for the top few that need a reply (scheduled runs only). */
  for (const it of items.filter(x => x.bucket === "needs_you" && x.wantsDraft).slice(0, autoDraft)) {
    try { const m = msgs.find(x => x.id === it.id); const dr = await draftReply(s, u, it, m); it.draft = dr; } catch (e) { it.draftError = e.message; }
  }
  const errors = fresh.filter(m => m.error).map(m => m.inbox + ": " + m.error);
  const listed = await change(s, u.id, doc => {
    /* Mail that could not be sorted (Claude did not answer) is not marked as
       seen, so the next pass tries it again. */
    const done = hasKey() && msgs.length && !sorted.length ? [] : msgs.map(m => m.id);
    doc.triage = { at: new Date().toISOString(), seen: [...new Set([...(doc.triage.seen || []), ...done])].slice(-2000), items: (done.length ? items : []).concat(doc.triage.items || []).filter((x, i, a) => a.findIndex(y => y.id === x.id) === i).slice(0, 200), errors };
    /* e-transfers and payment notices can tick a sticky note */
    const pays = items.filter(x => x.payment).map(x => ({ kind: x.payment.direction, name: x.payment.name, amount: x.payment.amount, date: localNow().date, source: "email from " + (x.who || x.address) }));
    for (const m of matchPayments(doc.items, pays)) { const it = doc.items.find(x => x.id === m.id); if (it) { it.done = true; it.doneAt = new Date().toISOString(); it.doneWhy = m.reason; } }
    /* What needs this person goes straight onto their hit list. */
    return mailToList(doc, localNow().date, new Date().toISOString()).map(x => x.text);
  });
  return { at: new Date().toISOString(), count: items.length, needs: items.filter(x => x.bucket === "needs_you").length, listed, errors };
}

/* A few of the person's own sent emails, read once a week, so a draft
   sounds like them and not like a robot. */
async function voiceFor(s, u, inbox) {
  const d = await readDoc(s, u.id);
  if (d.voice && d.voice.inbox === inbox && Date.now() - Date.parse(d.voice.at) < 7 * 86400000) return d.voice.samples || [];
  let samples = [];
  try { samples = await sentSamples(await tokenOf(s, u, inbox), 5); } catch (e) {}
  await change(s, u.id, doc => { doc.voice = { at: new Date().toISOString(), inbox, samples }; });
  return samples;
}
async function draftReply(s, u, it, full, note) {
  const tok = await tokenOf(s, u, it.inbox);
  const voice = await voiceFor(s, u, it.inbox);
  const first = u.name.split(" ")[0];
  const body = await claude({ model: draftModel(), max_tokens: 700,
    system: `You draft a short email reply for ${u.name} (${u.title || "A&M Abatement Services"}) to approve and send. ${OUTSIDE_RULE} ${STYLE} Never promise money, dates or prices that are not in the email; where a decision is needed, leave a clear [square bracket] for ${first} to fill in. Sign off with "${first}". Return only the email body.${voice.length ? "\nWrite the way " + first + " writes. These are emails " + first + " sent recently, for tone, length and sign-off only (do not reuse their content):\n" + voice.map(v => "<material>" + v + "</material>").join("\n") : ""}`,
    messages: [{ role: "user", content: `<email>\nFrom: ${it.from}\nSubject: ${it.subject}\n\n${((full && full.body) || it.snippet || "").slice(0, 3000)}\n</email>\n\n${note ? "<saying>" + String(note).slice(0, 400) + "</saying>\nDraft the reply, saying what " + first + " asked for above." : "Draft the reply."}` }] });
  const subject = /^re:/i.test(it.subject) ? it.subject : "Re: " + it.subject;
  const made = await makeDraft(tok, { to: it.address, subject, body, threadId: it.threadId, inReplyTo: it.messageId });
  return { ...made, to: it.address, subject, body };
}

/* The people a piece of mail can be handed to: every active account but this one. */
async function staffList(s, u) {
  const { accounts } = await readAccounts(s);
  return Object.values(accounts).filter(a => a.active !== false && a.email && a.id !== u.id).map(a => ({ name: a.name, title: a.title || "", email: String(a.email).toLowerCase() })).sort((x, y) => x.name.localeCompare(y.name));
}

/* Today's meetings and the invites still waiting for an answer, from every
   connected inbox that has calendar permission. Kept five minutes. */
async function calendarFor(s, u, d, inboxes, fresh) {
  const withCal = inboxes.filter(hasCalendar);
  if (!withCal.length) return { connected: false, needsReconnect: inboxes.length > 0, today: [], invites: [] };
  if (!fresh && d.cal && Date.now() - Date.parse(d.cal.at) < 300000 && d.cal.day === localNow().date) return { connected: true, ...d.cal };
  const L = localNow(), now = new Date();
  const dayStart = new Date(now.getTime() - (L.hour * 60 + L.minute) * 60000 - now.getSeconds() * 1000);
  const today = [], invites = [], errors = [];
  for (const ib of withCal) {
    try {
      const tok = await tokenOf(s, u, ib.email);
      const ev = await calEvents(tok, dayStart.toISOString(), new Date(dayStart.getTime() + 14 * 86400000).toISOString());
      const endToday = new Date(dayStart.getTime() + 86400000).toISOString();
      for (const e of ev) { const x = { ...e, inbox: ib.email }; if (e.start < endToday) today.push(x); if (e.status === "needsAction") invites.push(x); }
    } catch (e) { errors.push(ib.email + ": " + e.message); }
  }
  today.sort((a, b) => String(a.start).localeCompare(String(b.start)));
  const cal = { at: now.toISOString(), day: L.date, today: today.slice(0, 20), invites: invites.slice(0, 20), errors };
  await change(s, u.id, doc => { doc.cal = cal; }).catch(() => {});
  return { connected: true, ...cal };
}

/* ----------------------------------------------------- the chase */
export async function runChases(s, u, today) {
  const d = await readDoc(s, u.id);
  const notes = [];
  for (const ch of d.chases || []) {
    if (ch.closed || ch.answeredAt) continue;
    /* answered? */
    if (ch.email && ch.inbox) {
      try { const tok = await tokenOf(s, u, ch.inbox); if (await heardFrom(tok, ch.email, ch.startedOn)) { ch.answeredAt = new Date().toISOString(); notes.push(ch.who + " answered about " + ch.what); continue; } } catch (e) {}
    }
    const st = chaseStep(ch, today);
    if (st.step === "draft" && ch.email) {
      const dr = chaseDraft(ch, st.day, u.name.split(" ")[0]);
      try {
        let made;
        if (ch.from === "robots") made = await robotsDraft(s, ch.email, dr.subject, dr.body, u.email);
        else { const tok = await tokenOf(s, u, ch.inbox); made = await makeDraft(tok, { to: ch.email, subject: dr.subject, body: dr.body }); }
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
  /* Mail is sorted at every check-in and, between them, every half hour
     (slot "sort": the mail only, no check-in and no email to the person). */
  if (heavy) {
    try { const t = await triage(s, u, { max: 25, autoDraft: 8 }); if (t.count) notes.push(`Sorted ${t.count} new email${t.count === 1 ? "" : "s"}${t.listed && t.listed.length ? ", " + t.listed.length + " put on your list" : ""}.`); } catch (e) { notes.push(e.message); }
  }
  if (slot === "sort") return { slot, at: now.toISOString(), notes };
  if (slot === "morning") { try { notes.push(...await runChases(s, u, L.date)); } catch (e) { notes.push("The chases did not run: " + e.message); } }
  let pays = [];
  if ((u.assistant === "exec" || u.assistant === "accounting") && sees(u, "money")) { try { pays = await recentPayments(new Date(Date.now() - 14 * 86400000).toISOString().slice(0, 10)); } catch (e) {} }
  const c = await change(s, u.id, d => {
    for (const m of matchPayments(d.items, pays)) { const it = d.items.find(x => x.id === m.id); if (it && !it.done) { it.done = true; it.doneAt = now.toISOString(); it.doneWhy = m.reason; } }
    mailToList(d, L.date, now.toISOString());
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
  /* Everyone has one, for their position (2026-11-20). */
  const live = ROLE_KEYS.includes(u.assistant);
  if (!live && !u.viewAs) return json({ error: "off", message: "Your assistant is not set up. An admin picks it on People and access." }, 403);
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
      const ib = await inboxesFor(s, u);
      /* View as shows another person's mail only to the master admin (Bruce,
         2026-11-15). Admins viewing as someone see their list, not their mail.
         It stays look only either way. */
      const hideMail = !!u.viewAs && !u.viewAs.mail;
      return json({
        role: u.assistant, roleInfo: roleInfo(u.assistant), live, name: u.name, today, settings: d.settings,
        open: rank(d.items, today), held: d.items.filter(x => x.held && !x.done), doneToday: d.items.filter(x => x.done && String(x.doneAt || "").slice(0, 10) === today),
        doneRecent: d.items.filter(x => x.done && x.doneWhy).slice(0, 10),
        checkins: d.checkins.slice(0, 6),
        chases: (d.chases || []).filter(c => !c.closed).map(c => ({ ...c, status: chaseStatus(c, today), step: chaseStep(c, today).step })),
        inboxes: ib.map(x => ({ email: x.email, addedAt: x.addedAt, shared: !!x.shared })),
        queue: hideMail ? [] : queueOf(d, today).slice(0, 40),
        staff: hideMail ? [] : await staffList(s, u),
        rules: hideMail ? { notMine: [], vip: [] } : d.rules,
        handoffs: hideMail ? [] : (d.handoffs || []).slice(0, 10),
        calendar: hideMail ? { connected: false, hidden: true, today: [], invites: [] } : await calendarFor(s, u, d, ib, false).catch(e => ({ connected: false, today: [], invites: [], errors: [e.message] })),
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
        if (A === "tick") { x.done = true; x.doneAt = nowIso; x.doneWhy = ""; if (x.mailId) mailDone(d, x.mailId, nowIso); }
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
      const tok = await tokenOf(s, u, it.inbox);
      const full = await getMessage(tok, it.id).catch(() => null);
      const dr = await draftReply(s, u, it, full);
      await change(s, u.id, d2 => { const x = (d2.triage.items || []).find(y => y.id === it.id); if (x) x.draft = dr; });
      return json({ ok: true, draft: dr });
    }
    /* ---- the queue's buttons (2026-11-17). Each acts on one email the person
       is looking at, and only when they press it. */
    if (["send", "notMine", "later", "handoff", "redraft"].includes(A)) {
      const d0 = await readDoc(s, u.id);
      const it = (d0.triage.items || []).find(x => x.id === b.id);
      if (!it) return json({ error: "missing", message: "That email is not in your queue any more." }, 404);
      const tok = await tokenOf(s, u, it.inbox);
      const finish = (extra, why) => change(s, u.id, d => {
        const x = (d.triage.items || []).find(y => y.id === it.id); if (x) Object.assign(x, { handled: nowIso }, extra || {});
        const li = (d.items || []).find(y => y.mailId === it.id && !y.done); if (li) { li.done = true; li.doneAt = nowIso; li.doneWhy = why; }
        return li;
      });
      if (A === "send") {
        /* Approve and send: the draft the person has read (and perhaps
           changed) goes from their own Gmail, as them. */
        let dr = it.draft;
        if (!dr || !dr.draftId) return json({ error: "nodraft", message: "There is no draft for that email yet. Press Draft a reply first." }, 409);
        const body = b.body === undefined ? null : String(b.body).replace(/\r\n/g, "\n").trim();
        if (body !== null && !body) return json({ error: "bad", message: "The reply is empty." }, 400);
        const text = body === null ? dr.body : body;
        if (/\[[^\]\n]{1,200}\]/.test(text || "")) return json({ error: "brackets", message: "The draft still has a [square bracket] to fill in. Press Edit, fill it in, then send." }, 409);
        if (body !== null && body !== dr.body) await updateDraft(tok, dr.draftId, { to: dr.to || it.address, subject: dr.subject || ("Re: " + it.subject), body, threadId: it.threadId, inReplyTo: it.messageId });
        const sentMsg = await sendDraft(tok, dr.draftId);
        await finish({ sent: { at: nowIso, to: dr.to || it.address, id: sentMsg.id }, draft: { ...dr, body: text, sent: true } }, "You approved the reply and it was sent");
        return json({ ok: true, sent: { to: dr.to || it.address } });
      }
      if (A === "redraft") {
        const full = await getMessage(tok, it.id).catch(() => null);
        const dr = await draftReply(s, u, it, full, b.note);
        await change(s, u.id, d => { const x = (d.triage.items || []).find(y => y.id === it.id); if (x) x.draft = dr; });
        return json({ ok: true, draft: dr });
      }
      if (A === "notMine") {
        await change(s, u.id, d => { if (b.always) learnNotMine(d, it, nowIso); });
        await finish({ bucket: "not_yours", why: "You said this is not yours" }, "You said it is not yours");
        return json({ ok: true, learned: !!b.always });
      }
      if (A === "later") {
        const until = /^\d{4}-\d{2}-\d{2}$/.test(String(b.until || "")) && b.until > today ? b.until : nextWorkingDay(today);
        await change(s, u.id, d => { const x = (d.triage.items || []).find(y => y.id === it.id); if (x) x.snooze = until; const li = (d.items || []).find(y => y.mailId === it.id && !y.done); if (li) li.snooze = until; });
        return json({ ok: true, until });
      }
      if (A === "handoff") {
        /* Hand it to a colleague: they get the email with a note from this
           person, sent from this person's Gmail, and a line goes on the list
           to check it was dealt with in two working days. */
        const staff = await staffList(s, u);
        const to = staff.find(x => x.email === String(b.to || "").toLowerCase());
        if (!to) return json({ error: "bad", message: "Pick who to hand it to." }, 400);
        const note = String(b.note || "").trim().slice(0, 600);
        const full = await getMessage(tok, it.id).catch(() => null);
        const first = u.name.split(" ")[0];
        const body = `Hi ${to.name.split(" ")[0]},\n\n${note || "Can you look after this one, please?"}\n\n${first}\n\n---------- Handed on ----------\nFrom: ${it.from}\nSubject: ${it.subject}\nDate: ${it.date}\n\n${((full && full.body) || it.snippet || "").slice(0, 4000)}`;
        await sendNow(tok, { to: to.email, cc: it.address && b.copySender ? it.address : "", subject: /^fwd?:/i.test(it.subject) ? it.subject : "Fwd: " + it.subject, body });
        const check = nextWorkingDay(today, 2);
        await finish({ handoff: { to: to.email, name: to.name, at: nowIso, check } }, "Handed to " + to.name);
        await change(s, u.id, d => {
          d.handoffs = [{ id: newId(), mailId: it.id, to: to.email, name: to.name, subject: it.subject, from: it.who || it.address, at: nowIso, check }].concat(d.handoffs || []);
          addItem(d, { text: `Check ${to.name.split(" ")[0]} dealt with: ${it.who || it.address}, ${it.subject}`.slice(0, 300), kind: "chase", who: to.name, amount: null, due: check, source: "handoff", pinned: false, jobId: "", jobNumber: "", since: today, snooze: check, mailThread: "", handoffOf: it.id }, nowIso);
        });
        return json({ ok: true, to: to.name, check });
      }
    }
    if (A === "vip") {
      const okV = await change(s, u.id, d => setVip(d, b.address, b.on !== false));
      return okV ? json({ ok: true }) : json({ error: "bad", message: "That does not look like an email address." }, 400);
    }
    if (A === "forget") { await change(s, u.id, d => { d.rules = d.rules || {}; d.rules.notMine = (d.rules.notMine || []).filter(r => !(r.address === String(b.address || "").toLowerCase() && r.subject === String(b.subject || ""))); }); return json({ ok: true }); }
    if (A === "rsvp") {
      /* Accept or decline a meeting invite, as this person. */
      const status = { accept: "accepted", decline: "declined", maybe: "tentative" }[b.answer];
      if (!status) return json({ error: "bad", message: "Accept, decline or maybe." }, 400);
      const ib = (await inboxesFor(s, u)).find(x => x.email === String(b.inbox || "").toLowerCase() && hasCalendar(x));
      if (!ib) return json({ error: "calendar", message: "That calendar is not connected. Connect the inbox again to add its calendar." }, 409);
      await calRespond(await tokenOf(s, u, ib.email), String(b.eventId || ""), status);
      const d = await readDoc(s, u.id);
      const calNow = await calendarFor(s, u, d, await inboxesFor(s, u), true);
      return json({ ok: true, calendar: calNow });
    }
    if (A === "handled") { await change(s, u.id, d => { const x = (d.triage.items || []).find(y => y.id === b.id); if (x) { x.handled = nowIso; listDoneForMail(d, x.id, nowIso); } }); return json({ ok: true }); }
    if (A === "chase") {
      const who = String(b.who || "").trim().slice(0, 80), what = String(b.what || "").trim().slice(0, 200), email = String(b.email || "").trim().toLowerCase();
      if (!who || !what) return json({ error: "bad", message: "Say who owes the information and what it is." }, 400);
      if (email && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(email)) return json({ error: "bad", message: "That email address does not look right." }, 400);
      const ib = await inboxesFor(s, u);
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
  return Object.values(accounts).filter(a => a.active !== false).map(a => userOf(a, settings)).filter(u => ROLE_KEYS.includes(u.assistant));
}

export const config = { path: "/api/assistant" };
