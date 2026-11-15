/* Personal assistants: the rules, then the page's server with stand-in
   Claude, Gmail and QuickBooks. Names and addresses here are made up.
   Run: node --import ./test/support/use-fake-blobs.mjs test/assistant.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { hoursLeft, checkinSlot, rank, buildCheckin, chaseStep, chaseStatus, chaseDraft, matchPayments, callContext, parseSaying, workingDaysBetween } from "../netlify/functions/_assist.mjs";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/assistant.mjs";
import { allowedAddress } from "../netlify/functions/_gmail.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const T = "2026-11-16";
process.env.INBOX_DOMAINS = "example.test";
process.env.MAILBOX = "robots@example.test";

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

/* ------------------------------------------------ through the server */
const s = getStore({ name: "am-inventory", consistency: "strong" });
const owner = { id: "c1", name: "Owen Owner", email: "owner@example.test", title: "Owner", areas: ["office", "money", "payroll", "field", "assistants"], level: "admin", pwv: "1", assistant: "exec" };
const gm = { id: "a1", name: "Gina Manager", email: "gm@example.test", title: "General Manager", areas: ["office", "field", "assistants"], level: "admin", pwv: "1", assistant: "exec" };
const pm = { id: "p1", name: "Paul Manager", email: "pm@example.test", areas: ["field"], level: "edit", pwv: "1", assistant: "project" };
const est = { id: "d1", name: "Eve Estimator", email: "est@example.test", areas: ["office"], level: "edit", pwv: "1" };
await s.setJSON(ACCOUNTS, { accounts: { c1: owner, a1: gm, p1: pm, d1: est }, settings: { idleHours: 8, payrollSplit: true } });
await s.setJSON("cashflow-plan", { items: [], done: {}, place: {}, settings: {}, log: [] });
await s.setJSON("google-tokens", { refresh_token: "r", access_token: "robot", expires_at: Date.now() + 3600000 });
await s.setJSON("qbo-tokens", { access_token: "q", refresh_token: "q", realmId: "1", expires_at: Date.now() + 3600000 });
await s.setJSON("inbox-c1", { inboxes: [{ email: "owner@example.test", refresh_token: "r", access_token: "ownertok", expires_at: Date.now() + 3600000 }] });
process.env.ANTHROPIC_API_KEY = "test";
const sent = [], drafts = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), j = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opts.body); const said = JSON.stringify(body.messages);
    if (/I just paid Supplier One/.test(said)) { const open = JSON.parse(body.system.split("Open items: ")[1]); const it = open.find(o => /Supplier One/.test(o.text)); return j({ content: [{ type: "text", text: JSON.stringify({ add: [], tick: [it.id], reply: "Ticked." }) }] }); }
    if (/sort a person's email/.test(body.system)) return j({ content: [{ type: "text", text: JSON.stringify([{ id: "m1", bucket: "needs_you", why: "Asks for a decision", who: "Sam", action: "Reply", draft: true }, { id: "m2", bucket: "payment", why: "E-transfer", who: "Bank", payment: { direction: "in", name: "Northwind", amount: 50000 } }, { id: "m3", bucket: "not_yours", why: "A bid for estimating", who: "Bids" }]) }] });
    if (/draft a short email reply/.test(body.system)) return j({ content: [{ type: "text", text: "Hi Sam,\n\nYes, Tuesday works. [confirm time]\n\nOwen" }] });
    return j({ content: [{ type: "text", text: JSON.stringify({ add: [{ text: "Pay Supplier One $25,000 by Friday", kind: "pay", who: "Supplier One", amount: 25000, due: "2026-11-20" }], tick: [], reply: "Added." }) }] });
  }
  if (u.includes("gmail.googleapis.com")) {
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
assert.equal(r.body.count, 3);
r = await call("c1");
assert.deepEqual(Object.fromEntries(r.body.triage.items.map(x => [x.id, x.bucket])), { m1: "needs_you", m2: "payment", m3: "not_yours" });
r = await call("c1", { action: "draft", id: "m1" });
assert.equal(r.status, 200); assert.equal(drafts.at(-1).auth, "Bearer ownertok");
assert.ok(Buffer.from(drafts.at(-1).body.message.raw, "base64").toString().includes("Re: Subject m1"));
ok("his inbox is sorted (needs you, payment, not yours for estimating); a reply is drafted into his own Gmail, never sent");

const viewTok = await tok("a1");
const asView = await (await handler(new Request("https://site/api/assistant", { headers: { authorization: "Bearer " + viewTok, "x-am-view-as": "c1" } }))).json();
assert.ok(!asView.triage.hidden); assert.equal(asView.triage.items.length, 3);
const blocked = await handler(new Request("https://site/api/assistant", { method: "POST", headers: { authorization: "Bearer " + viewTok, "x-am-view-as": "c1", "content-type": "application/json" }, body: JSON.stringify({ action: "draft", id: "m1" }) }));
assert.equal(blocked.status, 403);
ok("an admin viewing as the owner sees his list and his mail (Craig's call), but cannot draft, tick or send anything");

await s.setJSON("inbox-a1", { inboxes: [{ email: "gm@example.test", refresh_token: "r", access_token: "gmtok", expires_at: Date.now() + 3600000 }] });
r = await call("a1", { action: "chase", jobNumber: "26-00999", jobName: "Test Site", who: "Sam at Northwind", email: "sam@northwind.test", what: "the signed site safety plan", from: "me" });
assert.equal(r.status, 200); assert.equal(drafts.at(-1).auth, "Bearer gmtok");
assert.ok(Buffer.from(drafts.at(-1).body.message.raw, "base64").toString().includes("signed site safety plan"));
r = await call("a1", { action: "chase", who: "Site super", email: "super@site.test", what: "the clearance letter", from: "robots" });
assert.equal(drafts.at(-1).auth, "Bearer robot");
assert.ok(Buffer.from(drafts.at(-1).body.message.raw, "base64").toString().includes("Reply-To: gm@example.test"));
r = await call("a1"); assert.equal(r.body.chases.length, 2); assert.ok(r.body.chases.every(c => c.status === "Chase 1 of 3 drafted"));
ok("the general manager starts a chase: day one is drafted in her own Gmail; from the robots' mailbox instead, replies still come to her");

console.log(`\n${n} assistant checks pass`);
