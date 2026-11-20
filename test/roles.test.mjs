/* One assistant per position (Craig, 2026-11-20). Every title on the
   organizational chart gets the right one, every role is complete, nobody is
   left without one, and the People and access list matches the server.
   Run: node --import ./test/support/use-fake-blobs.mjs test/roles.test.mjs */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";
const { ROLES, ROLE_KEYS, roleFromTitle, roleInfo } = await import("../netlify/functions/_roles.mjs");
const { assistantOf, userOf, ASSISTANTS } = await import("../netlify/functions/_accounts.mjs");
let n = 0; const ok = m => { n++; console.log("ok", m); };

const chart = {
  "Owner / Chairman": "exec", "General Manager / Director, Field Operations": "exec", "Director, Operations and Administration": "ops",
  "Estimator": "estimator", "Estimator & Project Manager - Calgary": "estimator", "Project Manager": "project",
  "Project Coordinator / Dispatcher": "dispatch", "Administrator": "admin", "Accounting & Payroll Clerk": "accounting",
  "Health & Safety Officer": "safety", "BD Manager": "sales", "Business Development Manager": "sales", "Sales Rep": "sales",
  "Shop / Logistics Lead": "shop", "Material / Salvage Lead": "shop", "Site Superintendent": "site", "Site Supervisor / Crew Chief": "site"
};
for (const [title, want] of Object.entries(chart)) assert.equal(roleFromTitle(title), want, title);
ok("every position on the organizational chart gets its own assistant");

for (const k of ROLE_KEYS) {
  const r = ROLES[k];
  assert.ok(r.label && r.short && r.words.length > 40 && r.focus.length > 20 && Array.isArray(r.pages) && r.pages.length, k);
  assert.ok(!/—/.test(r.label + r.words + r.focus + r.notMine), "no em dashes in " + k);
  assert.deepEqual(Object.keys(roleInfo(k)), ["key", "label", "short", "pages"]);
}
assert.ok(!ROLES.estimator.notMine);
assert.match(ROLES.exec.notMine, /estimating mail/);
ok("each role says who they are, what needs them, what is not theirs, and which pages are theirs");

assert.equal(assistantOf({ email: "x@amabatement.com", title: "", areas: ["field"] }), "project");
assert.equal(assistantOf({ email: "x@amabatement.com", title: "", areas: ["office", "payroll"] }), "accounting");
assert.equal(assistantOf({ email: "x@amabatement.com", title: "", areas: ["office"], assistant: "none" }), "admin");
assert.equal(assistantOf({ email: "craig@amabatement.com", title: "", areas: [] }), "exec");
assert.equal(assistantOf({ title: "Site Supervisor", assistant: "safety" }), "safety");
assert.ok(ASSISTANTS.includes("none"));
ok("nobody is left without one: an old 'None' or a blank title falls back to the job title, then to what they see; a choice an admin made stands");

assert.equal(userOf({ id: "b", name: "Brenda Williams", title: "Accounting and Payroll Clerk", areas: ["office", "money", "payroll"], level: "edit" }).assistant, "accounting");
ok("Brenda gets the accounting and payroll assistant without anyone setting it");

const html = readFileSync(new URL("../public/command.html", import.meta.url), "utf8");
const list = JSON.parse(html.match(/const ASSIST_ROLES = (\[[\s\S]*?\]\]);/)[1]);
assert.deepEqual(list.map(x => x[0]), ROLE_KEYS);
assert.deepEqual(list.map(x => x[1]), ROLE_KEYS.map(k => ROLES[k].label));
const pages = [...html.matchAll(/^  ([a-z]+):\s*\{ label:/gm)].map(m => m[1]);
for (const k of ROLE_KEYS) for (const t of ROLES[k].pages) assert.ok(pages.includes(t), k + " names page " + t);
ok("People and access offers exactly these positions, and every page a role names exists");

console.log(`\n${n} position checks passed`);
