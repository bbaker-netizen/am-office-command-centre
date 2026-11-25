/* To send (Jen, 2026-11-25): the snippet shows "A&M", not "A&amp;M"; which
   kinds of robot email are held back is one setting for everyone, with who
   changed it; and an Ask Claude answer with no words says why.
   Run: node --import ./test/support/use-fake-blobs.mjs test/to-send.test.mjs */
import { strict as assert } from "node:assert";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { authStore, signToken } from "../netlify/functions/_auth.mjs";
import { getStore } from "@netlify/blobs";

process.env.AUTH_SECRET = process.env.AUTH_SECRET || "a-test-secret-that-is-long-enough-0123456789";
const { default: mail, unescapeSnippet, readKinds, DEFAULT_HOLD } = await import("../netlify/functions/mail.mjs");
const { emptyAnswer } = await import("../netlify/functions/claude.mjs");

let n = 0; const ok = m => { n++; console.log("ok", m); };

assert.equal(unescapeSnippet("Hi Darwin, We are updating our subcontractor files at A&amp;M Abatement and we&#39;re &quot;current&quot;"),
  'Hi Darwin, We are updating our subcontractor files at A&M Abatement and we\'re "current"');
assert.equal(unescapeSnippet(""), "");
ok("Gmail's escaped snippet is turned back into plain words, so the list says A&M");

const s = getStore({ name: "am-inventory", consistency: "strong" });
assert.deepEqual((await readKinds(s)).hold, DEFAULT_HOLD);
assert.deepEqual(DEFAULT_HOLD, ["po"]);
ok("purchase order and contract chasers start held back, until signed POs are normal");

const a = authStore();
const jen = { id: "j1", name: "Jen Garrison", email: "jen@amabatement.com", title: "Director of Operations", areas: ["office", "field", "assistants"], level: "edit", pwv: "1" };
const look = { id: "l1", name: "Look Only", email: "look@amabatement.com", areas: ["office", "assistants"], level: "view", pwv: "1" };
const field = { id: "f1", name: "Field Lead", email: "field@amabatement.com", areas: ["field"], level: "edit", pwv: "1" };
await a.setJSON(ACCOUNTS, { accounts: { j1: jen, l1: look, f1: field }, settings: { idleHours: 8 } });
const tokFor = id => signToken(a, { k: "acct", a: id, v: "1", t: Date.now(), m: 0 });
const call = async (id, body, q = "") => { const r = await mail(new Request("https://site/api/mail" + q, body ? { method: "POST", headers: { authorization: "Bearer " + await tokFor(id), "content-type": "application/json" }, body: JSON.stringify(body) } : { headers: { authorization: "Bearer " + await tokFor(id) } })); return { status: r.status, body: await r.json() }; };

let r = await call("j1", null, "?action=kinds");
assert.equal(r.status, 200); assert.deepEqual(r.body.hold, ["po"]);
r = await call("j1", { action: "setKinds", hold: ["po", "coi", "nonsense", "po"] });
assert.equal(r.status, 200); assert.deepEqual(r.body.hold, ["po", "coi"]); assert.equal(r.body.by, "Jen Garrison"); assert.ok(r.body.at);
r = await call("l1", null, "?action=kinds");
assert.deepEqual(r.body.hold, ["po", "coi"]);
ok("Jen holds a kind back for everyone, junk names are dropped, and who changed it is kept");

r = await call("l1", { action: "setKinds", hold: [] });
assert.equal(r.status, 403);
r = await call("f1", null, "?action=kinds");
assert.equal(r.status, 403);
r = await call("j1", { action: "setKinds", hold: [] });
assert.deepEqual(r.body.hold, []);
ok("a look-only account cannot change it, someone without the Assistants area cannot see it, and everything can be shown again");

assert.match(emptyAnswer("max_tokens"), /used up its room/);
assert.match(emptyAnswer("refusal"), /would not answer/);
assert.match(emptyAnswer("end_turn"), /no words.*end_turn/);
assert.match(emptyAnswer(""), /^Claude sent back no words\. Ask again/);
ok("an Ask Claude answer with no words says why, instead of only \"I did not get an answer back\"");

console.log(`\n${n} To send checks passed`);
