/* An estimator's mail sort, end to end through /api/assistant: their own
   inbox plus the shared estimating inbox, bid mail picked out, and mail about
   an estimate someone else has taken kept out of Needs you.
   Stand-in Gmail and Claude; nothing real is called.
   Run: node --import ./test/support/use-fake-blobs.mjs test/estimator-mail.test.mjs */
import { strict as assert } from "node:assert";

const { default: handler } = await import("../netlify/functions/assistant.mjs");
const { ACCOUNTS } = await import("../netlify/functions/_accounts.mjs");
const { signToken } = await import("../netlify/functions/_auth.mjs");
const { getStore } = await import("@netlify/blobs");
const s = getStore({ name: "am-inventory", consistency: "strong" });
let n = 0; const ok = m => { n++; console.log("ok", m); };

const dennis = { id: "d1", name: "Dennis Vries", email: "dennis@example.test", title: "Estimator", areas: ["office", "assistants"], level: "edit", pwv: "1", assistant: "estimator" };
const amir = { id: "a1", name: "Amir Faiz", email: "amir@example.test", areas: ["office", "field", "assistants"], level: "admin", pwv: "1", assistant: "exec" };
await s.setJSON(ACCOUNTS, { accounts: { d1: dennis, a1: amir }, settings: { idleHours: 8 } });
const later = Date.now() + 3600000;
await s.setJSON("inbox-d1", { inboxes: [{ email: "dennis@example.test", refresh_token: "r", access_token: "owntok", expires_at: later }] });
await s.setJSON("inbox-a1", { inboxes: [{ email: "amir@example.test", refresh_token: "r", access_token: "amirtok", expires_at: later }] });
await s.setJSON("inbox-shared-estimating", { inboxes: [{ email: "estimating@example.test", refresh_token: "r", access_token: "sharedtok", expires_at: later }] });
await s.setJSON("cc-cache-claims", { at: Date.now(), data: { claims: { J1: { jobId: "J1", jobNumber: "26-00140", by: "Amir Faiz", byIds: ["m-amir"], at: "2026-11-20 13:30" } } } });
process.env.ANTHROPIC_API_KEY = "test";

let sortPrompt = "";
const mailFor = { owntok: ["m1"], sharedtok: ["m2", "m3"], amirtok: ["m1"] };
const subj = { m1: "Site walk Tuesday", m2: "Invitation to tender: Westmount School", m3: "Addendum 2 for 26-00140" };
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), j = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  const auth = String((opts.headers && (opts.headers.authorization || opts.headers.Authorization)) || "").replace("Bearer ", "");
  if (u.includes("api.anthropic.com")) {
    const body = JSON.parse(opts.body);
    if (/sort a person's email/.test(body.system)) {
      sortPrompt = body.system;
      return j({ content: [{ type: "text", text: JSON.stringify([
        { id: "m1", bucket: "needs_you", why: "Site walk", who: "Sam", action: "Confirm the site walk", draft: true, bid: { kind: "site_visit", job: "", project: "Northwind plant", closes: "2026-11-24" } },
        { id: "m2", bucket: "needs_you", why: "New tender", who: "PCL", action: "Price the asbestos scope", draft: false, bid: { kind: "invite", job: "", project: "Westmount School", closes: "2026-11-28" } },
        { id: "m3", bucket: "needs_you", why: "Addendum", who: "Stantec", action: "Read addendum 2", draft: true, bid: { kind: "addendum", job: "26-00140", project: "Lab reno", closes: "" } }
      ]) }] });
    }
    return j({ content: [{ type: "text", text: "Hi,\n\nThanks.\n\nDennis" }] });
  }
  if (u.includes("googleapis.com/calendar")) return j({ items: [] });
  if (u.includes("gmail.googleapis.com")) {
    if (u.includes("/threads/")) { const id = u.match(/threads\/t(m\d)/)[1]; return j({ messages: [{ id, payload: { headers: [{ name: "From", value: "Sam <sam@northwind.test>" }] } }] }); }
    if (/\/messages\?/.test(u) && u.includes("in%3Asent")) return j({ messages: [] });
    if (u.includes("/drafts")) return j({ id: "dr1", message: { id: "x", threadId: "t" } });
    if (/\/messages\?/.test(u)) return j({ messages: (mailFor[auth] || []).map(id => ({ id })) });
    const id = u.match(/messages\/(m\d)/)[1];
    return j({ id, threadId: "t" + id, snippet: "snippet " + id, labelIds: ["UNREAD"], payload: { headers: [{ name: "From", value: "Sam <sam@northwind.test>" }, { name: "To", value: "x@example.test" }, { name: "Subject", value: subj[id] }, { name: "Message-ID", value: "<" + id + "@x>" }], mimeType: "text/plain", body: { data: Buffer.from("Body " + id).toString("base64") } } });
  }
  if (u.includes("api.jobtread.com")) throw new Error("JobTread should not be called: claims come from the cache");
  throw new Error("unexpected " + u);
};
const tok = async a => signToken(s, { k: "acct", a, v: "1", t: Date.now(), m: 0 });
const call = async (who, body) => { const r = await handler(new Request("https://site/api/assistant", { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + await tok(who), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })); return { status: r.status, body: await r.json() }; };

let r = await call("d1");
assert.equal(r.status, 200); assert.equal(r.body.role, "estimator");
assert.deepEqual(r.body.inboxes.map(x => [x.email, x.shared]), [["dennis@example.test", false], ["estimating@example.test", true]]);
ok("Dennis's assistant is live straight away and shows his inbox and the shared estimating inbox");

r = await call("d1", { action: "triage" });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.count, 3);
assert.match(sortPrompt, /This person is an estimator/);
assert.match(sortPrompt, /26-00140: Amir Faiz/);
assert.match(sortPrompt, /estimating@example\.test/);
assert.doesNotMatch(sortPrompt, /not_yours: estimating mail/);
ok("the sort is told he is an estimator, which estimates are already taken, and reads both inboxes");

r = await call("d1");
const by = Object.fromEntries(r.body.triage.items.map(x => [x.id, x]));
assert.equal(by.m2.shared, true); assert.equal(by.m2.bid.kind, "invite"); assert.equal(by.m2.bucket, "needs_you");
assert.equal(by.m3.bucket, "not_yours"); assert.equal(by.m3.takenBy, "Amir Faiz"); assert.match(by.m3.why, /Amir Faiz has taken this estimate/);
assert.equal(by.m1.shared, false);
ok("the tender from the shared inbox needs him; Amir's addendum goes to Someone else has it");

const open = r.body.open.map(x => [x.text, x.due]);
assert.ok(open.some(([t, d]) => t === "Bid invite: PCL: Price the asbestos scope" && d === "2026-11-28"));
assert.ok(open.some(([t, d]) => t === "Site visit: Sam: Confirm the site walk" && d === "2026-11-24"));
assert.ok(!open.some(([t]) => /addendum/i.test(t)));
ok("the bid invite and the site walk are on his hit list, due on their dates; Amir's addendum is not");

r = await call("a1", { action: "triage" });
assert.equal(r.status, 200);
assert.doesNotMatch(sortPrompt, /This person is an estimator/);
assert.match(sortPrompt, /not_yours: estimating mail/);
assert.doesNotMatch(sortPrompt, /estimating@example\.test/);
ok("an executive's sort is unchanged and never reads the estimating inbox");

console.log(`\n${n} estimator mail checks passed`);
