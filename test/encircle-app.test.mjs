/* Checks the Encircle pieces inside the app: the webhook door, the morning
   check, the stored-key lookup and the Sites screen script. Nothing real is
   called. Run: node test/encircle-app.test.mjs */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
import vm from "node:vm";

process.env.ENCIRCLE_HOOK_KEY = "a-long-secret-key-for-tests-0123456789";
process.env.ENCIRCLE_MODE = "off";
const { loadSettings } = await import("../netlify/functions/_encircle.mjs");
const { default: hook, config } = await import("../netlify/functions/encircle-hook.mjs");
const { runSweep, config: sweepCfg } = await import("../netlify/functions/encircle-sweep.mjs");
let n = 0; const ok = m => { n++; console.log("ok", m); };

function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return { get: async (k) => m.has(k) ? m.get(k) : null, setJSON: async (k, v) => { m.set(k, v); }, m };
}

/* Webhook door */
const post = (key, body) => hook(new Request("https://x/api/encircle-hook" + (key ? "?key=" + key : ""), { method: "POST", body: JSON.stringify(body) }));
assert.equal(config.path, "/api/encircle-hook");
assert.equal((await post(null, {})).status, 403);
assert.equal((await post("wrong", {})).status, 403);
assert.equal((await hook(new Request("https://x/api/encircle-hook?key=" + process.env.ENCIRCLE_HOOK_KEY))).status, 405);
assert.equal((await (await post(process.env.ENCIRCLE_HOOK_KEY, { job: { id: "22PfLAwMzfAn" } })).json()).result, "off");
ok("webhook refuses a wrong key and does nothing while off");

/* The app's own JobTread key is used, env only overrides */
const st = fakeStore({ "jobtread-key": { grantKey: "stored-key", organizationId: "ORG9" } });
let s = await loadSettings(st, { ENCIRCLE_MODE: "test" });
assert.equal(s.jtKey, "stored-key"); assert.equal(s.jtOrg, "ORG9");
s = await loadSettings(st, { ENCIRCLE_MODE: "test", JOBTREAD_GRANT_KEY: "env-key" });
assert.equal(s.jtKey, "env-key");
ok("uses the key saved in Settings, JobTread");

/* Morning check: off */
const st2 = fakeStore();
let r = await runSweep(st2, { s: { mode: "off" } });
assert.equal(r.error, "ENCIRCLE_MODE is off.");
assert.ok(st2.m.get("encircle-last-sweep"));
ok("morning check saves a result even when off");

/* Morning check: counts photos on linked jobs and lists problems */
const env = { ENCIRCLE_MODE: "test", ENCIRCLE_TOKEN: "t", ENCIRCLE_ORG_ID: "O", ENCIRCLE_BRAND_ID: "208451", JOBTREAD_GRANT_KEY: "k" };
s = await loadSettings(null, env);
const jobs = {
  A: { id: "A", number: "99-00001", closed: false, createdOn: "2026-10-01", address: "x", client: "y", status: "Site work", pm: "", hasEncircleComment: true },
  B: { id: "B", number: "99-00001", closed: false, createdOn: "2026-10-01", address: "", client: "y", status: "Site work", pm: "", hasEncircleComment: false },
};
const jt = { awardedJobIds: async () => ["A"], getJob: async (id) => jobs[id], postComment: async () => {} };
const enc = { findByJobNumber: async () => [{ id: "C1", contractor_identifier: "99-00001" }], photoCount: async () => 7, create: async () => { throw new Error("should not create"); } };
r = await runSweep(fakeStore(), { s, jt, enc });
assert.equal(r.checked, 1); assert.equal(r.counts.linked, 1); assert.equal(r.photos["99-00001"], 7);
ok("morning check links and counts photos");

const enc2 = { ...enc, findByJobNumber: async () => [] };
r = await runSweep(fakeStore(), { s, jt: { ...jt, awardedJobIds: async () => ["B"] }, enc: enc2 });
assert.equal(r.needsAPerson.length, 1); assert.match(r.needsAPerson[0].why, /No site address/);
ok("morning check lists jobs that need a person");

r = await runSweep(fakeStore(), { s, jt: { ...jt, awardedJobIds: async () => { throw new Error("JobTread said 5 awarded jobs but only 1 came back."); } }, enc });
assert.match(r.error, /only 1 came back/);
ok("morning check records a failure instead of going quiet");
assert.equal(sweepCfg.schedule, "0 13 * * 1-5");

/* Sites screen script still parses */
const html = readFileSync(new URL("../public/command.html", import.meta.url), "utf8");
const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
for (const code of scripts) new vm.Script(code);
assert.ok(html.includes("function encircleCard()") && html.includes('api("encircle"'));
ok("command centre page script parses with the Encircle card");

console.log(`\nAll ${n} app checks passed.`);
