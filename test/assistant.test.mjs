/* Personal assistants: the rules, then the page's server with stand-in
   Claude, Gmail and QuickBooks. Names and addresses here are made up.
   Run: node --import ./test/support/use-fake-blobs.mjs test/assistant.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { nextWorkingDay, learnNotMine, setVip, rulesText, afterThread, queueOf, inWorkingHours, mailToList, hoursLeft, checkinSlot, rank, buildCheckin, chaseStep, chaseStatus, chaseDraft, matchPayments, callContext, parseSaying, workingDaysBetween } from "../netlify/functions/_assist.mjs";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/assistant.mjs";
import { allowedAddress, readThread, markClashes, CAL_SCOPE } from "../netlify/functions/_gmail.mjs";
import { runFor } from "../netlify/functions/assistant.mjs";
import inboxHandler, { inboxCallback } from "../netlify/functions/inbox.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const T = "2026-11-16";
process.env.INBOX_DOMAINS = "example.test";
process.env.MAILBOX = "robots@example.test";
process.env.MASTER_ADMINS = "master@example.test";

assert.equal(hoursLeft("12:00"), 5.5); assert.equal(hoursLeft("06:30"), 10.5); assert.equal(hoursLeft("18:00"), 0);
assert.equal(checkinSlot({ weekday: "Mon", hour: 7 }), "morning"); assert.equal(checkinSlot({ weekday: "Tue", hour: 12 }), "noon"); assert.equal(checkinSlot({ weekday: "Wed", hour: 17 }), "end");
assert.equal(checkinSlot({ weekday: "Sat", hour: 7 }), null); assert.equal(checkinSlot({ weekday: "Mon", hour: 20 }), null);
ok("check-ins at 7:00, 12:00 and 5:00 on weekdays only; hours left run to 5:30");

const items = [
  { id: "1", text: "Expect Northwind", kind: "expect", createdAt: "2026-11-16T14:00:00Z" },
  { id: "2", text: "Pay Supplier One", kind: "pay", due: "2026-11-13", createdAt: "2026-11-10T14:00:00Z" },
  { id: "3", text: "Sign insurance", kind: "todo", due: T, createdAt: "2026-11-16T14:00:00Z" },
  { id: "4", text: "Walk-in from the estimator", kind: "ask", held: true, createdAt: "2026-11-16T15:00:00Z" },
  { id: "5", text: "Call bank", kind: "call", pinned: true, createdAt: "2026-11-16T14:00:00Z" },
  { id: "6", text: "Done thing", kind: "todo", done: true, doneAt: "2026-11-16T15:00:00Z", createdAt: "2026-11-15T14:00:00Z" }
];
assert.deepEqual(rank(items, T).map(x => x.id), ["5", "2", "3", "1"]);
ok("ranked: pinned first, then an overdue promise to pay, then due today; held and done items wait");

const doc = { items: items.map(x => ({ ...x })), checkins: [] };
const c = buildCheckin(doc, "noon", new Date("2026-11-16T18:00:00Z"));
assert.deepEqual(c.added, ["Walk-in from the estimator"]); assert.equal(c.done.length, 1); assert.equal(c.left.length, 5); assert.equal(c.hoursLeft, 5.5);
assert.ok(/Noon check-in\. Done today: 1\. Still on the list: 5\. About 5\.5 working hours left\./.test(c.text));
const e = buildCheckin(doc, "end", new Date("2026-11-16T23:00:00Z"));
assert.ok(e.rolls.includes("Pay Supplier One") && /Rolling to tomorrow/.test(e.text));
ok("noon: done, left, 5.5 hours left, and the walk-in logged this morning joins the list; end of day: what rolls to tomorrow");

const ch = { who: "Sam at Northwind", what: "the signed site safety plan", jobNumber: "26-00999", jobName: "Test Site", startedOn: "2026-11-16", drafts: [] };
assert.equal(chaseStep(ch, "2026-11-16").step, "draft");
ch.drafts.push({ date: "2026-11-16" }); assert.equal(chaseStep(ch, "2026-11-16").step, "wait");
assert.equal(chaseStep(ch, "2026-11-17").day, 2); ch.drafts.push({ date: "2026-11-17" });
ch.drafts.push({ date: "2026-11-18" }); assert.equal(chaseStep(ch, "2026-11-18").step, "call");
assert.equal(chaseStatus(ch, "2026-11-18"), "Day 3, no answer: call Sam at Northwind");
assert.equal(workingDaysBetween("2026-11-20", "2026-11-23"), 1);
const d3 = chaseDraft(ch, 3, "GM"); assert.ok(/third note/.test(d3.body) && /call me today/.test(d3.body) && d3.subject.startsWith("Job 26-00999"));
ok("chase: a draft a day for three working days, then a call on day three; the third note says so");

const pays = [{ kind: "in", name: "Northwind Builders Ltd.", amount: 78606, date: "2026-11-17", source: "QuickBooks" }, { kind: "out", name: "Supplier One", amount: 60000, date: "2026-11-17", source: "QuickBooks" }];
const m = matchPayments([{ id: "a", kind: "expect", who: "Northwind", amount: 78606, since: T }, { id: "b", kind: "pay", who: "SUPPLIER ONE", amount: null, since: T }, { id: "c", kind: "expect", who: "Southgate", amount: 5000, since: T }], pays);
assert.deepEqual(m.map(x => x.id), ["a", "b"]); assert.ok(/Received Northwind Builders Ltd\. \$78,606 on 2026-11-17/.test(m[0].reason));
const cc = callContext([{ id: "x", kind: "call", who: "Northwind", text: "Call Northwind about the holdback", createdAt: "2026-11-16T15:00:00Z" }], pays);
assert.ok(/You said you'd call Northwind about the holdback\. Since then Northwind Builders Ltd\. has paid \$78,606/.test(cc[0].text));
ok("a QuickBooks payment ticks the matching sticky note; 'You said you'd call X; since then X has paid'");

const p1 = parseSaying("Put this on my list: pay Supplier One 25,000 by Friday", T);
assert.deepEqual([p1.kind, p1.who, p1.amount, p1.due], ["pay", "Supplier One", 25000, "2026-11-20"]);
const p2 = parseSaying("call back Sam about the holdback", T); assert.deepEqual([p2.kind, p2.who], ["call", "Sam"]);
const p3 = parseSaying("expecting 12k from Northwind", T); assert.deepEqual([p3.kind, p3.amount], ["expect", 12000]);
ok("without Claude, plain sayings still work: pay ... by Friday; call back ...; expecting 12k from ...");

assert.ok(allowedAddress("owner@example.test")); assert.ok(!allowedAddress("robots@example.test")); assert.ok(!allowedAddress("someone@elsewhere.test"));
ok("only company inboxes can be connected, never the robots' mailbox");

process.env.INBOX_PERSONAL_USERS = "owner@example.test,gm@example.test";
assert.ok(allowedAddress("owen.personal@gmail.com", { email: "owner@example.test" }));
assert.ok(allowedAddress("gina.personal@gmail.com", { email: "GM@example.test" }));
assert.ok(!allowedAddress("eve.personal@gmail.com", { email: "est@example.test" }));
assert.ok(!allowedAddress("owen.personal@gmail.com", { email: "owner@example.test", active: false }));
assert.ok(!allowedAddress("owen.personal@gmail.com")); assert.ok(!allowedAddress("owen@outlook.test", { email: "owner@example.test" }));
assert.ok(!allowedAddress("robots@example.test", { email: "owner@example.test" }));
ok("a personal Gmail can be connected by the two owners only: not by staff, not by a switched-off account, and never any other outside address");

assert.ok(inWorkingHours({ weekday: "Tue", hour: 7, minute: 0 })); assert.ok(inWorkingHours({ weekday: "Tue", hour: 17, minute: 30 }));
assert.ok(!inWorkingHours({ weekday: "Tue", hour: 6, minute: 30 })); assert.ok(!inWorkingHours({ weekday: "Tue", hour: 18, minute: 0 })); assert.ok(!inWorkingHours({ weekday: "Sun", hour: 10, minute: 0 }));
const md = { items: [], triage: { items: [
  { id: "e1", threadId: "th1", bucket: "needs_you", who: "Sam", action: "Send the overdue invoice review", subject: "Follow-up", inbox: "owner@example.test" },
  { id: "e2", threadId: "th1", bucket: "needs_you", who: "Sam", action: "Second note in the same thread", subject: "Re: Follow-up" },
  { id: "e3", threadId: "th3", bucket: "fyi", who: "News" },
  { id: "e4", threadId: "th4", bucket: "needs_you", who: "Old", action: "Already dealt with", handled: "2026-11-16T15:00:00Z" },
  { id: "e5", bucket: "needs_you", address: "pat@site.test", subject: "Clearance letter" }] } };
const made = mailToList(md, T, "2026-11-16T15:00:00Z");
assert.deepEqual(made.map(x => x.text).sort(), ["Sam: Send the overdue invoice review", "pat@site.test: Clearance letter"]);
assert.ok(made.every(x => x.kind === "ask" && x.source === "email" && x.mailThread));
assert.equal(mailToList(md, T, "2026-11-16T15:30:00Z").length, 0);
md.items = md.items.filter(x => x.mailThread !== "th1");
assert.equal(mailToList(md, T, "2026-11-16T16:00:00Z").length, 0);
ok("mail that needs the person goes on the hit list: one line per thread, not for mail already dealt with, and a removed line never comes back");

/* The assistant's queue: what has happened in the conversation, what the person has taught it. */
const hdr = f => ({ headers: [{ name: "From", value: f }] });
const th = { messages: [{ id: "a", payload: hdr("Sam <sam@northwind.test>") }, { id: "b", labelIds: ["SENT"], payload: hdr("Owen <owner@example.test>") }, { id: "c", payload: hdr("Sam <sam@northwind.test>") }, { id: "d", payload: hdr('"Hana Help" <hana@example.test>') }] };
assert.equal(readThread(th, "a", ["owner@example.test"], ["example.test"]).repliedAfter, true);
assert.deepEqual(readThread(th, "c", ["owner@example.test"], ["example.test"]), { count: 4, repliedAfter: false, othersAfter: ["Hana Help"], newerFromSender: false });
assert.equal(readThread(th, "a", [], ["example.test"]).newerFromSender, true);
assert.equal(afterThread({ bucket: "needs_you", why: "x", wantsDraft: true }, { repliedAfter: true }).bucket, "fyi");
assert.equal(afterThread({ bucket: "needs_you" }, { repliedAfter: false, newerFromSender: true }).why, "They wrote again since: see their newer email");
assert.equal(afterThread({ bucket: "payment" }, { repliedAfter: true }).bucket, "payment");
ok("an email he has already answered, or that the sender has since replaced, is not raised as needing him");

assert.equal(nextWorkingDay("2026-11-20"), "2026-11-23"); assert.equal(nextWorkingDay("2026-11-17", 2), "2026-11-19");
const qd = { rules: { notMine: [], vip: [] }, triage: { items: [
  { id: "q1", bucket: "needs_you", address: "a@x.test", at: "2026-11-16T10:00:00Z" }, { id: "q2", bucket: "needs_you", address: "bank@bank.test", at: "2026-11-16T09:00:00Z" },
  { id: "q3", bucket: "needs_you", address: "c@x.test", at: "2026-11-16T11:00:00Z", snooze: "2026-11-17" }, { id: "q4", bucket: "needs_you", handled: "x" }, { id: "q5", bucket: "fyi" }] } };
assert.ok(setVip(qd, "Bank@bank.test", true)); assert.ok(!setVip(qd, "not an address", true));
assert.deepEqual(queueOf(qd, T).map(x => x.id), ["q2", "q1"]); assert.deepEqual(queueOf(qd, "2026-11-17").map(x => x.id), ["q2", "q3", "q1"]);
learnNotMine(qd, { address: "Hayley@jt.test", who: "Hayley", subject: "Re: Fwd: Invoicing" }, "n"); learnNotMine(qd, { address: "hayley@jt.test", who: "Hayley", subject: "Invoicing" }, "n2");
assert.equal(qd.rules.notMine.length, 1); assert.match(rulesText(qd), /NOT theirs[\s\S]*Hayley <hayley@jt\.test>, about "Invoicing"/); assert.match(rulesText(qd), /always matter[^\n]*bank@bank\.test/);
const cl = markClashes([{ start: "2026-11-17T09:00", end: "2026-11-17T10:00" }, { start: "2026-11-17T09:30", end: "2026-11-17T10:30" }, { start: "2026-11-17T11:00", end: "2026-11-17T12:00" }, { allDay: true, start: "2026-11-17", end: "2026-11-18" }]);
assert.deepEqual(cl.map(x => !!x.clash), [true, true, false, false]);
ok("the queue puts senders who always matter first and hides what was put off until tomorrow; 'not mine' is remembered once per sender and subject; meetings that overlap are marked");

/* ------------------------------------------------ through the server */
const s = getStore({ name: "am-inventory", consistency: "strong" });
const owner = { id: "c1", name: "Owen Owner", email: "owner@example.test", title: "Owner", areas: ["office", "money", "payroll", "field", "assistants"], level: "admin", pwv: "1", assistant: "exec" };
const gm = { id: "a1", name: "Gina Manager", email: "gm@example.test", title: "General Manager", areas: ["office", "field", "assistants"], level: "admin", pwv: "1", assistant: "exec" };
const pm = { id: "p1", name: "Paul Manager", email: "pm@example.test", areas: ["field"], level: "edit", pwv: "1", assistant: "project" };
const mst = { id: "m1", name: "Max Master", email: "master@example.test", areas: ["office", "money", "field"], level: "admin", pwv: "1" };
const est = { id: "d1", name: "Eve Estimator", email: "est@example.test", areas: ["office"], level: "edit", pwv: "1" };
await s.setJSON(ACCOUNTS, { accounts: { c1: owner, a1: gm, p1: pm, d1: est, m1: mst }, settings: { idleHours: 8, payrollSplit: true } });
await s.setJSON("cashflow-plan", { items: [], done: {}, place: {}, settings: {}, log: [] });
await s.setJSON("google-tokens", { refresh_token: "r", access_token: "robot", expires_at: Date.now() + 3600000 });
await s.setJSON("qbo-tokens", { access_token: "q", refresh_token: "q", realmId: "1", expires_at: Date.now() + 3600000 });
await s.setJSON("inbox-c1", { inboxes: [{ email: "owner@example.test", refresh_token: "r", access_token: "ownertok", expires_at: Date.now() + 3600000 }] });
process.env.ANTHROPIC_API_KEY = "test";
const sent = [], drafts = [], sentDrafts = [], edits = [], rsvps = []; let lastSort = "", lastDraftSystem = "";
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), j = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opts.body); const said = JSON.stringify(body.messages);
    if (/I just paid Supplier One/.test(said)) { const open = JSON.parse(body.system.split("Open items: ")[1]); const it = open.find(o => /Supplier One/.test(o.text)); return j({ content: [{ type: "text", text: JSON.stringify({ add: [], tick: [it.id], reply: "Ticked." }) }] }); }
    if (/sort a person's email/.test(body.system)) lastSort = body.system + "\n" + said;
    if (/draft a short email reply/.test(body.system)) lastDraftSystem = body.system;
    if (/sort a person's email/.test(body.system)) return j({ content: [{ type: "text", text: JSON.stringify([{ id: "m1", bucket: "needs_you", why: "Asks for a decision", who: "Sam", action: "Reply", draft: true }, { id: "m2", bucket: "payment", why: "E-transfer", who: "Bank", payment: { direction: "in", name: "Northwind", amount: 50000 } }, { id: "m3", bucket: "not_yours", why: "A bid for estimating", who: "Bids" }]) }] });
    if (/draft a short email reply/.test(body.system)) return j({ content: [{ type: "text", text: "Hi Sam,\n\nYes, Tuesday works. [confirm time]\n\nOwen" }] });
    return j({ content: [{ type: "text", text: JSON.stringify({ add: [{ text: "Pay Supplier One $25,000 by Friday", kind: "pay", who: "Supplier One", amount: 25000, due: "2026-11-20" }], tick: [], reply: "Added." }) }] });
  }
  if (u.includes("googleapis.com/calendar")) {
    const ev = { id: "ev1", summary: "Site walk with Northwind", start: { dateTime: new Date(Date.now() + 3600000).toISOString() }, end: { dateTime: new Date(Date.now() + 7200000).toISOString() }, organizer: { email: "sam@northwind.test" }, attendees: [{ email: "owner@example.test", self: true, responseStatus: rsvps.length ? rsvps.at(-1) : "needsAction" }, { email: "sam@northwind.test", responseStatus: "accepted" }] };
    if (opts.method === "PATCH") { rsvps.push(JSON.parse(opts.body).attendees.find(a => a.self).responseStatus); return j(ev); }
    return /events\?/.test(u) ? j({ items: [ev] }) : j(ev);
  }
  if (u.includes("gmail.googleapis.com")) {
    if (u.includes("/threads/")) { const id = u.match(/threads\/t(m\d)/)[1]; return j({ messages: [{ id, payload: { headers: [{ name: "From", value: "Sam <sam@northwind.test>" }] } }] }); }
    if (u.includes("/drafts/send")) { sentDrafts.push(JSON.parse(opts.body).id); return j({ id: "sent" + sentDrafts.length, threadId: "t" }); }
    if (opts.method === "PUT" && u.includes("/drafts/")) { edits.push(Buffer.from(JSON.parse(opts.body).message.raw, "base64").toString()); return j({ id: "dr" }); }
    if (/\/messages\?/.test(u) && u.includes("in%3Asent")) return j({ messages: [{ id: "m9" }] });
    if (u.includes("/messages/m9")) return j({ id: "m9", threadId: "tm9", payload: { headers: [], mimeType: "text/plain", body: { data: Buffer.from("Sounds good, thanks for the quick turnaround on this one. Talk Thursday.\n\nOwen").toString("base64") } } });
    if (u.includes("/drafts")) { drafts.push({ auth: opts.headers.authorization, body: JSON.parse(opts.body) }); return j({ id: "dr" + drafts.length }); }
    if (u.includes("/messages/send")) { sent.push(JSON.parse(opts.body)); return j({ id: "s1" }); }
    if (/\/messages\?/.test(u)) return u.includes("from%3A") ? j({}) : j({ messages: [{ id: "m1" }, { id: "m2" }, { id: "m3" }] });
    const id = u.match(/messages\/(m\d)/)[1];
    return j({ id, threadId: "t" + id, snippet: "snippet " + id, labelIds: ["UNREAD"], payload: { headers: [{ name: "From", value: "Sam <sam@northwind.test>" }, { name: "Subject", value: "Subject " + id }, { name: "Message-ID", value: "<" + id + "@x>" }], mimeType: "text/plain", body: { data: Buffer.from("Body " + id).toString("base64") } } });
  }
  if (u.includes("quickbooks") || u.includes("intuit")) return j({ QueryResponse: {} });
  throw new Error("unexpected " + u);
};
const tok = async a => signToken(s, { k: "acct", a, v: "1", t: Date.now(), m: 0 });
const call = async (who, body, hdr = {}) => { const r = await handler(new Request("https://site/api/assistant", { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + await tok(who), "content-type": "application/json", ...hdr }, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };

assert.equal((await call("d1")).status, 403);
const pmr = await call("p1"); assert.equal(pmr.status, 403); assert.match(pmr.body.message, /not switched on for staff yet/);
ok("the estimator has no assistant; the project manager's assistant is built but off for staff");

let r = await call("c1");
assert.equal(r.status, 200); assert.equal(r.body.role, "exec");
r = await call("c1", { action: "say", text: "Put this on my list: pay Supplier One 25,000 by Friday", voice: true });
assert.deepEqual(r.body.added, ["Pay Supplier One $25,000 by Friday"]);
let plan = await s.get("cashflow-plan", { type: "json" });
assert.equal(plan.items.length, 1); assert.equal(plan.items[0].amount, 25000); assert.equal(plan.items[0].cat, "oneoff"); assert.equal(plan.items[0].start, "2026-11-20");
ok("the owner says 'pay Supplier One 25,000 by Friday': it lands on his list and in the cash flow on that day");

r = await call("c1", { action: "say", text: "I just paid Supplier One" });
assert.deepEqual(r.body.ticked, ["Pay Supplier One $25,000 by Friday"]);
plan = await s.get("cashflow-plan", { type: "json" });
assert.equal(Object.keys(plan.done).length, 1);
ok("'I just paid Supplier One' ticks it on his list and in the cash flow");

await call("c1", { action: "log", text: "The estimator came by: wants the holdback numbers" });
r = await call("c1"); assert.equal(r.body.held.length, 1); assert.ok(!r.body.open.find(x => /came by/.test(x.text)));
r = await call("c1", { action: "checkin", slot: "noon" });
assert.ok(r.body.checkin.added.includes("The estimator came by: wants the holdback numbers"));
assert.equal(sent.length, 1);
ok("a walk-in logged mid-morning joins the list at the noon check-in, and the check-in is emailed to him");

r = await call("c1", { action: "triage" });
assert.equal(r.body.count, 3); assert.deepEqual(r.body.listed, ["Sam: Reply"]);
r = await call("c1");
const fromMail = r.body.open.find(x => x.source === "email");
assert.ok(fromMail && fromMail.kind === "ask" && fromMail.mailId === "m1" && fromMail.inbox === "owner@example.test");
await call("c1", { action: "tick", id: fromMail.id });
r = await call("c1"); assert.ok(!r.body.triage.items.find(x => x.id === "m1")); assert.ok(!r.body.open.find(x => x.source === "email"));
await call("c1", { action: "untick", id: fromMail.id });
await s.setJSON("assist-c1", { ...(await s.get("assist-c1", { type: "json" })), triage: { ...(await s.get("assist-c1", { type: "json" })).triage, items: (await s.get("assist-c1", { type: "json" })).triage.items.map(x => ({ ...x, handled: undefined })) } });
ok("an email that needs him lands on his hit list with a link back to it; ticking the line marks the email dealt with");
r = await call("c1");
assert.deepEqual(Object.fromEntries(r.body.triage.items.map(x => [x.id, x.bucket])), { m1: "needs_you", m2: "payment", m3: "not_yours" });
r = await call("c1", { action: "draft", id: "m1" });
assert.equal(r.status, 200); assert.equal(drafts.at(-1).auth, "Bearer ownertok");
assert.ok(Buffer.from(drafts.at(-1).body.message.raw, "base64").toString().includes("Re: Subject m1"));
ok("his inbox is sorted (needs you, payment, not yours for estimating); a reply is drafted into his own Gmail, never sent");

const viewTok = await tok("a1");
const asView = await (await handler(new Request("https://site/api/assistant", { headers: { authorization: "Bearer " + viewTok, "x-am-view-as": "c1" } }))).json();
assert.equal(asView.triage.hidden, true); assert.ok(!asView.triage.items); assert.ok(asView.open.length >= 0);
const mTok = await tok("m1");
const asMaster = await (await handler(new Request("https://site/api/assistant", { headers: { authorization: "Bearer " + mTok, "x-am-view-as": "c1" } }))).json();
assert.ok(!asMaster.triage.hidden); assert.equal(asMaster.triage.items.length, 3);
const blocked = await handler(new Request("https://site/api/assistant", { method: "POST", headers: { authorization: "Bearer " + mTok, "x-am-view-as": "c1", "content-type": "application/json" }, body: JSON.stringify({ action: "draft", id: "m1" }) }));
assert.equal(blocked.status, 403);
const intoMaster = await handler(new Request("https://site/api/assistant", { headers: { authorization: "Bearer " + viewTok, "x-am-view-as": "m1" } }));
assert.equal(intoMaster.status, 403);
ok("an admin viewing as the owner sees his list but not his mail; only the master admin sees mail, still look only; admins cannot view as the master admin");

await s.setJSON("inbox-a1", { inboxes: [{ email: "gm@example.test", refresh_token: "r", access_token: "gmtok", expires_at: Date.now() + 3600000 }] });
r = await call("a1", { action: "chase", jobNumber: "26-00999", jobName: "Test Site", who: "Sam at Northwind", email: "sam@northwind.test", what: "the signed site safety plan", from: "me" });
assert.equal(r.status, 200); assert.equal(drafts.at(-1).auth, "Bearer gmtok");
assert.ok(Buffer.from(drafts.at(-1).body.message.raw, "base64").toString().includes("signed site safety plan"));
r = await call("a1", { action: "chase", who: "Site super", email: "super@site.test", what: "the clearance letter", from: "robots" });
assert.equal(drafts.at(-1).auth, "Bearer robot");
assert.ok(Buffer.from(drafts.at(-1).body.message.raw, "base64").toString().includes("Reply-To: gm@example.test"));
r = await call("a1"); assert.equal(r.body.chases.length, 2); assert.ok(r.body.chases.every(c => c.status === "Chase 1 of 3 drafted"));
ok("the general manager starts a chase: day one is drafted in her own Gmail; from the robots' mailbox instead, replies still come to her");

/* The half-hour sort: mail only, no check-in and no email to the person. */
const sentBefore = sent.length, checkinsBefore = (await call("c1")).body.checkins.length;
const sortRun = await runFor(s, { id: "c1", name: "Owen Owner", email: "owner@example.test", assistant: "exec", areas: ["office", "money"] }, "sort", { heavy: true });
assert.equal(sortRun.slot, "sort"); assert.equal(sent.length, sentBefore); assert.equal((await call("c1")).body.checkins.length, checkinsBefore);
await call("c1", { action: "handled", id: "m1" });
r = await call("c1"); assert.ok(!r.body.open.find(x => x.mailId === "m1")); assert.ok(r.body.doneToday.find(x => x.mailId === "m1" && /inbox/.test(x.doneWhy)));
ok("the half-hour sort reads the mail without a check-in or an email; marking an email done in the inbox ticks its line on the list");

/* Connecting inboxes: the Google account chooser for a second inbox, and a personal Gmail for the owners only. */
process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "sec"; process.env.GOOGLE_REDIRECT_URI = "https://site/api/mail?action=callback";
const start = async (who, q) => (await (await inboxHandler(new Request("https://site/api/inbox?action=start" + q, { headers: { authorization: "Bearer " + await tok(who) } }))).json()).url;
const first = new URL(await start("c1", "")), more = new URL(await start("c1", "&another=1"));
assert.equal(first.searchParams.get("login_hint"), "owner@example.test"); assert.equal(first.searchParams.get("prompt"), "consent");
assert.equal(more.searchParams.get("login_hint"), null); assert.equal(more.searchParams.get("prompt"), "select_account consent");
const realFetch = globalThis.fetch; let googleSays = "";
globalThis.fetch = async (url, opts) => { const u = String(url);
  if (u.includes("oauth2.googleapis.com/token")) return new Response(JSON.stringify({ refresh_token: "pr", access_token: "pa", expires_in: 3600 }), { status: 200 });
  if (u.endsWith("/profile")) return new Response(JSON.stringify({ emailAddress: googleSays }), { status: 200 });
  return realFetch(url, opts); };
const comeBack = async (who, q, email) => { const st = new URL(await start(who, q)).searchParams.get("state"); googleSays = email; return (await inboxCallback(new URL("https://site/api/mail?action=callback&code=x&state=" + st))).text(); };
assert.match(await comeBack("c1", "&another=1", "owen.personal@gmail.com"), /owen\.personal@gmail\.com is connected/);
assert.deepEqual((await s.get("inbox-c1", { type: "json" })).inboxes.map(x => x.email), ["owner@example.test", "owen.personal@gmail.com"]);
await s.setJSON("inbox-d1", { inboxes: [] });
assert.match(await comeBack("d1", "&another=1", "eve.personal@gmail.com"), /cannot be connected here/);
assert.deepEqual((await s.get("inbox-d1", { type: "json" })).inboxes, []);
assert.match(await comeBack("c1", "&another=1", "robots@example.test"), /cannot be connected here/);
const mine = await (await inboxHandler(new Request("https://site/api/inbox", { headers: { authorization: "Bearer " + await tok("c1") } }))).json();
const hers = await (await inboxHandler(new Request("https://site/api/inbox", { headers: { authorization: "Bearer " + await tok("d1") } }))).json();
assert.equal(mine.personal, true); assert.equal(hers.personal, false);
globalThis.fetch = realFetch;
ok("Add another inbox shows Google's account chooser; an owner's personal Gmail connects, a staff member's is refused, and the robots' mailbox is always refused");

/* The queue's buttons, through the server. Start from a clean sort. */
const fresh = async () => { const d = await s.get("assist-c1", { type: "json" }); await s.setJSON("assist-c1", { ...d, triage: { at: null, seen: [], items: [] }, rules: { notMine: [], vip: [] } }); await call("c1", { action: "triage" }); };
await fresh();
assert.match(lastSort, /Conversation: first email\./); assert.match(lastSort, /Colleagues: [^\n]*Gina Manager \(General Manager\) <gm@example\.test>/);
r = await call("c1"); assert.deepEqual(r.body.queue.map(x => x.id), ["m1"]); assert.ok(r.body.staff.find(x => x.email === "gm@example.test") && !r.body.staff.find(x => x.email === "owner@example.test"));
r = await call("c1", { action: "send", id: "m1" }); assert.equal(r.status, 409); assert.equal(r.body.error, "nodraft");
await call("c1", { action: "draft", id: "m1" });
assert.match(lastDraftSystem, /Write the way Owen writes[\s\S]*Talk Thursday/);
r = await call("c1"); assert.match(r.body.queue[0].draft.body, /\[confirm time\]/);
r = await call("c1", { action: "send", id: "m1" }); assert.equal(r.status, 409); assert.equal(r.body.error, "brackets"); assert.equal(sentDrafts.length, 0);
r = await call("c1", { action: "send", id: "m1", body: "Hi Sam,\n\nYes, Tuesday at 10 works.\n\nOwen" });
assert.equal(r.status, 200); assert.equal(sentDrafts.length, 1); assert.match(edits.at(-1), /To: sam@northwind\.test/); assert.ok(Buffer.from(edits.at(-1).split("\r\n\r\n")[1], "base64").toString().includes("Tuesday at 10"));
r = await call("c1"); assert.equal(r.body.queue.length, 0); assert.ok(r.body.doneToday.find(x => x.mailId === "m1" && /approved the reply/.test(x.doneWhy)));
ok("Approve and send: nothing goes without a draft, a draft with a [blank] is stopped, the edited reply is sent from his own Gmail, and the item leaves the queue and his list; the draft is written in his own voice");

await call("c1", { action: "notMine", id: "m3", always: true });
r = await call("c1"); assert.equal(r.body.rules.notMine[0].address, "sam@northwind.test");
await fresh().catch(() => {}); const dd = await s.get("assist-c1", { type: "json" }); await s.setJSON("assist-c1", { ...dd, rules: { notMine: [{ address: "sam@northwind.test", name: "Bids", subject: "Subject m3" }], vip: [] }, triage: { at: null, seen: [], items: [] } });
await call("c1", { action: "triage" }); assert.match(lastSort, /NOT theirs[\s\S]*<sam@northwind\.test>, about "Subject m3"/);
r = await call("c1", { action: "later", id: "m1" }); assert.ok(r.body.until > T);
r = await call("c1"); assert.equal(r.body.queue.length, 0); assert.ok(!r.body.open.find(x => x.mailId === "m1"));
ok("Not mine, and others like it, is told to the next sort; Later takes an item off the queue and the list until the next working day");

const sentN = sent.length;
r = await call("c1", { action: "handoff", id: "m2", to: "nobody@elsewhere.test" }); assert.equal(r.status, 400);
r = await call("c1", { action: "handoff", id: "m2", to: "gm@example.test", note: "Please match this to the invoice." });
assert.equal(r.status, 200); assert.equal(r.body.to, "Gina Manager"); assert.equal(sent.length, sentN + 1);
const fwd = Buffer.from(sent.at(-1).raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString();
assert.match(fwd, /To: gm@example\.test/); assert.match(fwd, /Subject: Fwd: Subject m2/); assert.ok(Buffer.from(fwd.split("\r\n\r\n")[1], "base64").toString().includes("Please match this to the invoice."));
const after = await s.get("assist-c1", { type: "json" });
assert.equal(after.handoffs.length, 1); assert.ok(after.items.find(x => x.source === "handoff" && /Check Gina dealt with/.test(x.text) && x.due === r.body.check));
ok("Hand to: only to someone at the company; they get the email with his note from his own Gmail, and a check goes on his list two working days out");

r = await call("c1"); assert.equal(r.body.calendar.connected, false); assert.equal(r.body.calendar.needsReconnect, true);
r = await call("c1", { action: "rsvp", inbox: "owner@example.test", eventId: "ev1", answer: "accept" }); assert.equal(r.status, 409);
const ib1 = await s.get("inbox-c1", { type: "json" }); ib1.inboxes[0].scope = "openid " + CAL_SCOPE; await s.setJSON("inbox-c1", ib1);
r = await call("c1"); assert.equal(r.body.calendar.connected, true); assert.equal(r.body.calendar.today[0].title, "Site walk with Northwind"); assert.equal(r.body.calendar.invites.length, 1);
r = await call("c1", { action: "rsvp", inbox: "owner@example.test", eventId: "ev1", answer: "accept" });
assert.equal(r.status, 200); assert.deepEqual(rsvps, ["accepted"]); assert.equal(r.body.calendar.invites.length, 0);
const viewCal = await (await handler(new Request("https://site/api/assistant", { headers: { authorization: "Bearer " + viewTok, "x-am-view-as": "c1" } }))).json();
assert.equal(viewCal.calendar.hidden, true); assert.deepEqual(viewCal.queue, []);
const viewSend = await handler(new Request("https://site/api/assistant", { method: "POST", headers: { authorization: "Bearer " + mTok, "x-am-view-as": "c1", "content-type": "application/json" }, body: JSON.stringify({ action: "send", id: "m1" }) }));
assert.equal(viewSend.status, 403);
ok("the calendar shows once the inbox is connected with calendar permission; Accept answers the invite as him; an admin viewing as him sees neither queue nor calendar, and nobody can send as someone else");

console.log(`\n${n} assistant checks pass`);
