/* A&M - the personal assistant's rules. Pure functions, so they can be tested.

   From Bruce's brief for session 2 (6 and 10 November with Craig and Amir):
   - Every assistant belongs to one person and pushes only that person's mail,
     to-dos and asks. It can still answer anything about the command centre
     (Ask Claude), but it never puts estimating mail or anyone else's work in
     front of them.
   - Two roles. Executive (Craig and Amir now). Project (project managers and
     field leads): built, but off for staff until Craig and Amir say so.
   - Three check-ins a day: morning (the briefing and a ranked hit list), noon
     (done, left, hours left), end of day (done, rolls to tomorrow). Anything
     logged during the day (someone at the door, a phone call) lands on the
     list at the next check-in.
   - Craig's sticky notes: who he promised to pay, money he expects in, calls
     to return. Tied to the cash flow, ticked when a payment shows up.
   - Amir's chase: when a site or a subcontractor owes information, a draft
     chase each day for three days, then "call them" on day three, then a
     suggested next step if the call got nowhere. */

export const KINDS = {
  todo:   { label: "To do" },
  pay:    { label: "Promised to pay" },
  expect: { label: "Money expected in" },
  call:   { label: "Call back" },
  ask:    { label: "Someone asked" },
  chase:  { label: "Chase" }
};
export const WORK_START = "07:00", WORK_END = "17:30", TZ = "America/Edmonton";
const DAY = 86400000;

export const localNow = (now = new Date()) => {
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: TZ, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(now).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}`, hour: Number(p.hour), minute: Number(p.minute), weekday: p.weekday };
};
const mins = t => { const [h, m] = String(t).split(":").map(Number); return h * 60 + (m || 0); };

/* Hours of the working day left, to the half hour (7:00 to 5:30). */
export function hoursLeft(time) {
  const left = Math.max(0, mins(WORK_END) - Math.max(mins(time), mins(WORK_START)));
  return Math.round(left / 30) / 2;
}

/* Which check-in a moment belongs to. Weekdays 7:00 to 5:30 only. */
export function checkinSlot(local) {
  if (["Sat", "Sun"].includes(local.weekday)) return null;
  if (local.hour === 7) return "morning";
  if (local.hour === 12) return "noon";
  if (local.hour === 17) return "end";
  return null;
}

/* Between check-ins the mail is sorted every half hour, so "Emails need you"
   and the hit list keep up with the day (2026-11-17). Weekdays, 7:00 to 5:30
   only, the same working hours as everything else. */
export function inWorkingHours(local) {
  if (["Sat", "Sun"].includes(local.weekday)) return false;
  const m = local.hour * 60 + (local.minute || 0);
  return m >= mins(WORK_START) && m <= mins(WORK_END);
}

let seq = 0;
export const newId = () => "a" + Date.now().toString(36) + (seq++).toString(36) + Math.random().toString(36).slice(2, 5);

/* A new list item, checked. */
export function cleanEntry(x, today) {
  const text = String((x && x.text) || "").replace(/\s+/g, " ").trim().slice(0, 300);
  if (!text) return { ok: false, message: "Say or type what to put on the list." };
  const kind = KINDS[x.kind] ? x.kind : "todo";
  const amount = x.amount === undefined || x.amount === null || x.amount === "" ? null : Number(String(x.amount).replace(/[$,\s]/g, ""));
  if (amount !== null && (!isFinite(amount) || amount < 0 || amount > 10000000)) return { ok: false, message: "That amount does not look right." };
  const due = /^\d{4}-\d{2}-\d{2}$/.test(String(x.due || "")) ? x.due : "";
  return { ok: true, value: { text, kind, who: String(x.who || "").trim().slice(0, 80), amount: amount === null ? null : Math.round(amount * 100) / 100, due, source: String(x.source || "typed").slice(0, 20), pinned: !!x.pinned, jobId: x.jobId || "", jobNumber: x.jobNumber || "", since: x.since || today } };
}

/* Logged during the day (walk-in, phone call): held until the next check-in. */
export function addItem(doc, value, nowIso, { held = false } = {}) {
  const it = { id: newId(), ...value, createdAt: nowIso, done: false, held };
  doc.items = [it].concat(doc.items || []);
  return it;
}

/* Mail that needs this person goes onto their hit list by itself (2026-11-17).
   Before this the list only held what they said, typed or photographed, so
   it read "Nothing on your list" while their inbox was full of asks.
   One line per email thread. Once a line has been made for an email it is
   never made again, so ticking or removing it sticks. Returns the new lines. */
/* What an estimator's assistant picks out of bid mail (2026-11-20). */
export const BID_KINDS = { invite: "Bid invite", addendum: "Addendum", rfi: "RFI", site_visit: "Site visit", quote_reply: "Quote reply" };
export function cleanBid(b) {
  if (!b || typeof b !== "object" || !BID_KINDS[b.kind]) return null;
  const job = String(b.job || "").trim().match(/^\d{2}-\d{3,6}$/) ? String(b.job).trim() : "";
  const closes = /^\d{4}-\d{2}-\d{2}$/.test(String(b.closes || "")) ? String(b.closes) : "";
  return { kind: b.kind, job, project: String(b.project || "").replace(/\s+/g, " ").trim().slice(0, 80), closes };
}
export function mailToList(doc, today, nowIso) {
  const added = [];
  doc.items = doc.items || [];
  for (const m of (doc.triage && doc.triage.items) || []) {
    if (m.bucket !== "needs_you" || m.handled || m.listed) continue;
    const thread = m.threadId || m.id;
    /* A newer email in a conversation whose line is still open joins that
       line; if the line was already ticked, it gets a new one. */
    const same = doc.items.find(x => x.mailThread === thread && !x.done);
    if (same) { m.listed = same.id; continue; }
    const who = String(m.who || m.address || "").trim();
    const what = String(m.action || m.subject || "Email needs you").trim();
    /* An estimator's bid mail says what it is, and a closing date becomes the due date. */
    const bid = m.bid && BID_KINDS[m.bid.kind] ? m.bid : null;
    const ck = cleanEntry({ text: (bid ? BID_KINDS[bid.kind] + ": " : "") + (who ? who + ": " : "") + what, kind: "ask", who, source: "email",
      due: bid && bid.closes ? bid.closes : "", jobNumber: bid && bid.job ? bid.job : "" }, today);
    if (!ck.ok) continue;
    const it = addItem(doc, { ...ck.value, mailId: m.id, mailThread: thread, inbox: m.inbox || "", subject: String(m.subject || "").slice(0, 160) }, nowIso);
    m.listed = it.id; added.push(it);
  }
  return added;
}
/* ------------------------------------------------------- the assistant's queue
   (2026-11-17) What an executive assistant does with the mail: puts in front
   of the person only what they have to act on, each with a reply drafted,
   and buttons to approve it, hand it on, say it is not theirs, or leave it
   until tomorrow. These are the rules behind those buttons. */

/* The next working day after a date (Monday after a Friday). */
export function nextWorkingDay(d, n = 1) {
  let t = Date.parse(d + "T12:00:00Z");
  while (n > 0) { t += DAY; const w = new Date(t).getUTCDay(); if (w !== 0 && w !== 6) n--; }
  return new Date(t).toISOString().slice(0, 10);
}
const subjKey = s => String(s || "").replace(/^\s*((re|fwd?|fw)\s*:\s*)+/i, "").replace(/\s+/g, " ").trim().slice(0, 80);
/* "Not mine, and others like it": remembered, and told to Claude at every
   sort from then on. One line per sender and subject, newest first, 60 kept. */
export function learnNotMine(doc, m, nowIso) {
  doc.rules = doc.rules || { notMine: [], vip: [] };
  doc.rules.notMine = doc.rules.notMine || [];
  const rule = { address: String(m.address || "").toLowerCase(), name: String(m.who || "").slice(0, 80), subject: subjKey(m.subject), at: nowIso };
  if (!rule.address) return null;
  doc.rules.notMine = [rule].concat(doc.rules.notMine.filter(r => !(r.address === rule.address && r.subject === rule.subject))).slice(0, 60);
  return rule;
}
/* Senders who always matter: never filed away. */
export function setVip(doc, address, on) {
  doc.rules = doc.rules || { notMine: [], vip: [] };
  const a = String(address || "").toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(a)) return false;
  doc.rules.vip = (doc.rules.vip || []).filter(x => x !== a);
  if (on) doc.rules.vip = [a].concat(doc.rules.vip).slice(0, 40);
  return true;
}
export function rulesText(doc) {
  const r = (doc && doc.rules) || {}, out = [];
  if ((r.vip || []).length) out.push("Senders who always matter to this person (their mail is needs_you whenever it asks for anything, and never not_yours or junk): " + r.vip.join(", ") + ".");
  if ((r.notMine || []).length) out.push("This person has said mail like the following is NOT theirs to act on. Put mail like it in not_yours:\n" + r.notMine.slice(0, 40).map(x => `- from ${x.name ? x.name + " " : ""}<${x.address}>${x.subject ? ', about "' + x.subject + '"' : ""}`).join("\n"));
  return out.join("\n");
}
/* What has already happened in the conversation overrides the sort: an email
   the person has answered, or that the same sender has since replaced with a
   newer one, does not need them. */
export function afterThread(item, thread) {
  if (!thread || item.bucket !== "needs_you") return item;
  if (thread.repliedAfter) return { ...item, bucket: "fyi", why: "You already replied in this conversation", wantsDraft: false };
  if (thread.newerFromSender) return { ...item, bucket: "fyi", why: "They wrote again since: see their newer email", wantsDraft: false };
  return item;
}
/* The queue: what needs the person, not dealt with and not put off, senders
   who always matter first, then newest first. */
export function queueOf(doc, today) {
  const vip = new Set(((doc.rules && doc.rules.vip) || []));
  return ((doc.triage && doc.triage.items) || []).filter(x => x.bucket === "needs_you" && !x.handled && !(x.snooze && x.snooze > today))
    .map(x => ({ ...x, vip: vip.has(String(x.address || "").toLowerCase()) }))
    .sort((a, b) => (b.vip - a.vip) || String(b.at || "").localeCompare(String(a.at || "")));
}

/* Ticking the line marks the email dealt with, and the other way round. */
export function mailDone(doc, mailId, nowIso) {
  const m = ((doc.triage && doc.triage.items) || []).find(x => x.id === mailId);
  if (m && !m.handled) m.handled = nowIso;
  return m;
}
export function listDoneForMail(doc, mailId, nowIso) {
  const it = (doc.items || []).find(x => x.mailId === mailId && !x.done);
  if (it) { it.done = true; it.doneAt = nowIso; it.doneWhy = "Marked done in your inbox"; }
  return it;
}

/* The ranked hit list: pinned first, then overdue, due today, promises to
   pay and calls (they involve someone waiting), then the rest, oldest first. */
export function rank(items, today) {
  const score = it => {
    let s = 0;
    if (it.pinned) s += 1000;
    if (it.due && it.due < today) s += 400 + Math.min(100, Math.round((Date.parse(today) - Date.parse(it.due)) / DAY));
    else if (it.due === today) s += 300;
    else if (it.due) s -= Math.min(200, Math.round((Date.parse(it.due) - Date.parse(today)) / DAY) * 10);
    if (it.kind === "pay" || it.kind === "call" || it.kind === "chase") s += 60;
    if (it.kind === "ask") s += 40;
    if (it.kind === "expect") s -= 20;
    s += Math.min(30, Math.round((Date.parse(today) - Date.parse((it.createdAt || today).slice(0, 10))) / DAY));
    return s;
  };
  return (items || []).filter(it => !it.done && !it.held && !(it.snooze && it.snooze > today)).map(it => ({ ...it, score: score(it) })).sort((a, b) => b.score - a.score);
}

/* A check-in: what is done today, what is left, hours left, and what rolls. */
export function buildCheckin(doc, slot, now = new Date()) {
  const L = localNow(now), today = L.date;
  /* Things logged since the last check-in join the list now. */
  const released = [];
  for (const it of doc.items || []) if (it.held && !it.done) { it.held = false; released.push(it.text); }
  const open = rank(doc.items, today);
  const doneToday = (doc.items || []).filter(it => it.done && String(it.doneAt || "").slice(0, 10) === today);
  const c = { slot, at: now.toISOString(), date: today, time: L.time, hoursLeft: hoursLeft(L.time), done: doneToday.map(x => x.text), left: open.map(x => ({ id: x.id, text: x.text, kind: x.kind, due: x.due })), added: released };
  if (slot === "morning") c.top = open.slice(0, 7).map(x => x.text);
  if (slot === "end") c.rolls = open.filter(x => !x.due || x.due <= today).map(x => x.text);
  c.text = checkinText(c);
  doc.checkins = [c].concat(doc.checkins || []).slice(0, 40);
  return c;
}
export function checkinText(c) {
  const lines = [];
  const list = (a, n = 7) => a.slice(0, n).map((x, i) => `${i + 1}. ${x}`).join("\n") + (a.length > n ? `\n...and ${a.length - n} more` : "");
  if (c.slot === "morning") {
    lines.push(`Good morning. ${c.left.length ? "Here is your day, most pressing first:" : "Nothing on your list today."}`);
    if (c.top && c.top.length) lines.push(list(c.top));
  } else if (c.slot === "noon") {
    lines.push(`Noon check-in. Done today: ${c.done.length}. Still on the list: ${c.left.length}. About ${c.hoursLeft} working hours left.`);
    if (c.left.length) lines.push("Still to do:\n" + list(c.left.map(x => x.text), 5));
  } else {
    lines.push(`End of day. Done today: ${c.done.length}.${c.rolls && c.rolls.length ? " Rolling to tomorrow: " + c.rolls.length + "." : " Nothing rolls to tomorrow."}`);
    if (c.rolls && c.rolls.length) lines.push(list(c.rolls, 7));
  }
  if (c.added && c.added.length) lines.push("Added since the last check-in:\n" + c.added.map(x => "- " + x).join("\n"));
  return lines.join("\n\n");
}

/* ----------------------------------------------------------- the chase
   Day 1, 2 and 3: a draft chase each working day (never sent by the app).
   Day 3 with no answer: a "call them" item. After a call that got nowhere:
   a suggested next step. */
export function chaseStep(ch, today) {
  if (ch.closed) return { step: "closed" };
  if (ch.answeredAt) return { step: "answered" };
  const drafted = (ch.drafts || []).map(d => d.date);
  const day = Math.max(1, workingDaysBetween(ch.startedOn, today) + 1);
  if (ch.called) return { step: "after-call", day };
  if (day >= 3 && drafted.length >= 3) return { step: "call", day };
  if (!drafted.includes(today) && drafted.length < 3) return { step: "draft", day: drafted.length + 1 };
  return { step: "wait", day };
}
export function workingDaysBetween(a, b) {
  let n = 0, d = Date.parse(a + "T12:00:00Z"); const end = Date.parse(b + "T12:00:00Z");
  while (d < end) { d += DAY; const w = new Date(d).getUTCDay(); if (w !== 0 && w !== 6) n++; }
  return n;
}
export function chaseStatus(ch, today) {
  const st = chaseStep(ch, today);
  const n = (ch.drafts || []).length;
  if (st.step === "closed") return "Closed";
  if (st.step === "answered") return "Answered " + String(ch.answeredAt).slice(0, 10);
  if (st.step === "after-call") return "Called. " + (ch.callOutcome ? "Next: " + (ch.nextStep || "decide") : "");
  if (st.step === "call") return `Day 3, no answer: call ${ch.who || "them"}`;
  return `Chase ${n} of 3 drafted`;
}
export function chaseDraft(ch, number, sender) {
  const first = String(ch.who || "").split(" ")[0] || "there";
  const tone = number === 1 ? "Could you send" : number === 2 ? "Following up on my note yesterday. Could you send" : "This is my third note. We need";
  const end = number === 3 ? "If it is easier, call me today and we can sort it out on the phone." : "Thanks.";
  return {
    subject: `${ch.jobNumber ? "Job " + ch.jobNumber + " - " : ""}${ch.what}`.slice(0, 120),
    body: `Hi ${first},\n\n${tone} ${ch.what}${ch.jobName ? " for " + ch.jobName : ""}${number === 3 ? " to keep this job moving" : ""}?\n\n${end}\n\n${sender || ""}`.trim()
  };
}

/* ----------------------------------------------------------- matching money
   A payment in QuickBooks (or an e-transfer or payment email) whose name
   matches an "expected in" or "promised to pay" note ticks it, with the
   reason, so Craig can undo it. */
const norm = s => String(s || "").toLowerCase().replace(/[^a-z0-9 ]/g, " ").replace(/\b(ltd|inc|corp|construction|the|and|services|group)\b/g, " ").replace(/\s+/g, " ").trim();
export function nameMatches(a, b) {
  const x = norm(a), y = norm(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const wx = x.split(" ").filter(w => w.length > 2), wy = new Set(y.split(" ").filter(w => w.length > 2));
  return wx.length > 0 && wx.every(w => wy.has(w));
}
export function matchPayments(items, payments) {
  const out = [];
  for (const it of items || []) {
    if (it.done || !(it.kind === "expect" || it.kind === "pay") || !it.who) continue;
    const p = (payments || []).find(p => p.kind === (it.kind === "expect" ? "in" : "out") && nameMatches(it.who, p.name) && p.date >= (it.since || "0000") && (it.amount === null || it.amount === undefined || Math.abs(p.amount - it.amount) <= Math.max(1, it.amount * 0.02)));
    if (p) out.push({ id: it.id, reason: `${p.kind === "in" ? "Received" : "Paid"} ${p.name} $${Math.round(p.amount).toLocaleString("en-CA")} on ${p.date} (${p.source})` });
  }
  return out;
}

/* "You said you'd call X about this; since then X has paid." */
export function callContext(items, payments) {
  const out = [];
  for (const it of items || []) {
    if (it.done || it.kind !== "call" || !it.who) continue;
    const p = (payments || []).find(p => nameMatches(it.who, p.name) && p.date >= String(it.createdAt || "").slice(0, 10));
    const about = (String(it.text || "").match(/\babout\s+(.+?)\.?$/i) || [])[1];
    if (p) out.push({ id: it.id, text: `You said you'd call ${it.who}${about ? " about " + about : ""}. Since then ${p.name} has ${p.kind === "in" ? "paid" : "been paid"} $${Math.round(p.amount).toLocaleString("en-CA")} (${p.date}).` });
  }
  return out;
}

/* Words to a list entry with no Claude: "pay X 5000 by Friday", "call Bob",
   "expect 12,000 from Chandos". Claude does better; this is the fallback. */
export function parseSaying(text, today) {
  const t = String(text || "").trim();
  const amt = (t.match(/\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?\s?(k\b)?/i) || []);
  const amount = amt[1] ? Number(amt[1].replace(/,/g, "")) * (amt[2] ? 1000 : 1) : null;
  let kind = "todo", who = "";
  let m;
  if ((m = t.match(/^(?:put this on my list:?\s*)?(?:i\s+)?(?:promised to |need to |have to |must )?pay\s+(.+?)(?:\s+\$?\d|\s+by\b|$)/i))) { kind = "pay"; who = m[1]; }
  else if ((m = t.match(/(?:expect|expecting|waiting on|money from|payment from)\s+(?:\$?[\d,]+k?\s+from\s+)?(.+?)(?:\s+\$?\d|\s+by\b|$)/i))) { kind = "expect"; who = m[1]; }
  else if ((m = t.match(/^(?:put this on my list:?\s*)?(?:call|phone|ring)\s+(?:back\s+)?(.+?)(?:\s+about\b|\s+re\b|$)/i))) { kind = "call"; who = m[1]; }
  const days = { monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5 };
  let due = "";
  const dm = t.match(/\b(?:by|on|this)\s+(monday|tuesday|wednesday|thursday|friday|today|tomorrow)\b/i);
  if (dm) {
    const w = dm[1].toLowerCase(), base = Date.parse(today + "T12:00:00Z"), dow = new Date(base).getUTCDay();
    const add = w === "today" ? 0 : w === "tomorrow" ? 1 : ((days[w] - dow + 7) % 7);
    due = new Date(base + add * DAY).toISOString().slice(0, 10);
  }
  return { text: t.replace(/^put this on my list:?\s*/i, ""), kind, who: who.replace(/\s+(today|tomorrow|this week)$/i, "").trim(), amount, due };
}
