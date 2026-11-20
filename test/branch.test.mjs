/* Branch and estimating access (Craig, 2026-11-20): an Edmonton estimator
   does not see Calgary jobs, and estimators do not dispatch crews.
   Run: node --import ./test/support/use-fake-blobs.mjs test/branch.test.mjs */
import { strict as assert } from "node:assert";
process.env.PW_ITER = "1000";
const { branchOf, publicAccount, userOf, hashPassword, ACCOUNTS, accountToken } = await import("../netlify/functions/_accounts.mjs");
let n = 0; const ok = m => { n++; console.log("ok", m); };

assert.equal(branchOf({ title: "Estimator" }), "edmonton");
assert.equal(branchOf({ title: "Estimator and Project Manager, Calgary" }), "calgary");
assert.equal(branchOf({ title: "Owner", email: "craig@amabatement.com" }), "");
assert.equal(branchOf({ title: "Project Manager" }), "");
assert.equal(branchOf({ title: "Estimator", branch: "all" }), "");
assert.equal(branchOf({ title: "Owner", branch: "calgary" }), "calgary");
assert.equal(publicAccount({ id: "d", title: "Estimator", areas: [] }).branch, "edmonton");
assert.equal(userOf({ id: "g", title: "Estimator and Project Manager, Calgary", areas: ["office"] }).branch, "calgary");
ok("Dennis is Edmonton, George is Calgary, leaders see both; an admin's choice wins");

const { default: account } = await import("../netlify/functions/account.mjs");
const { default: command } = await import("../netlify/functions/command.mjs");
const { getStore } = await import("@netlify/blobs");
const s = getStore({ name: "am-inventory", consistency: "strong" });
const now = new Date().toISOString(), pw = await hashPassword("a good long password");
const acc = (id, name, title, level, extra = {}) => ({ id, email: name.split(" ")[0].toLowerCase() + "@amabatement.com", name, title, areas: ["office", "field", "assistants"], level, active: true, pw, pwv: now, mustChange: false, ...extra });
await s.setJSON(ACCOUNTS, { accounts: { c1: acc("c1", "Craig Williams", "Owner", "admin"), d1: acc("d1", "Dennis Vries", "Estimator", "edit") }, settings: { idleHours: 8 } });
const tok = async id => accountToken(s, (await s.get(ACCOUNTS, { type: "json" })).accounts[id]);
const me = async id => (await command(new Request("https://x/api/command?part=me", { headers: { authorization: "Bearer " + await tok(id) } }))).json();
assert.equal((await me("d1")).branch, "edmonton"); assert.equal((await me("c1")).branch, "");
ok("the command centre tells each person's screen their branch");

const post = async (id, body) => account(new Request("https://x/api/account", { method: "POST", headers: { authorization: "Bearer " + await tok(id), "content-type": "application/json" }, body: JSON.stringify(body) }));
let r = await post("c1", { action: "update", id: "d1", branch: "all" });
assert.equal(r.status, 200, await r.clone().text());
assert.equal((await me("d1")).branch, "");
r = await post("c1", { action: "update", id: "d1", branch: "edmonton" });
assert.equal((await me("d1")).branch, "edmonton");
r = await post("c1", { action: "update", id: "d1", branch: "toronto" });
assert.equal(r.status, 400);
ok("an admin sets the branch on People and access; anything but Edmonton, Calgary or both is refused");

await s.setJSON("jobtread-key", { grantKey: "k", organizationId: "O" });
r = await command(new Request("https://x/api/command", { method: "POST", headers: { authorization: "Bearer " + await tok("d1"), "content-type": "application/json" }, body: JSON.stringify({ crew: { jobId: "J1", members: [] } }) }));
assert.equal(r.status, 403); assert.match((await r.json()).message, /scheduled by dispatch/);
ok("an estimator cannot change a crew, even by going round the screen");

const html = (await import("node:fs")).readFileSync(new URL("../public/command.html", import.meta.url), "utf8");
const scope = new Function("ME", html.match(/function scopeJobs\(rows\)\{[\s\S]*?\n\}/)[0] + "; return scopeJobs;");
const jobs = [{ _number: "26-1", "Estimating branch": "Edmonton" }, { _number: "26-2", "Estimating branch": "Calgary" }, { _number: "26-3" }];
assert.deepEqual(scope({ branch: "edmonton" })(jobs).map(j => j._number), ["26-1", "26-3"]);
assert.deepEqual(scope({ branch: "calgary" })(jobs).map(j => j._number), ["26-2"]);
assert.equal(scope({ branch: "" })(jobs).length, 3);
assert.match(html, /\.filter\(t => !\(t === "dispatch" && me\.assistant === "estimator"\)\)/);
ok("the screen keeps Edmonton (and unset) jobs for Edmonton, Calgary jobs for Calgary, and drops Dispatch for estimators");

console.log(`\n${n} branch checks passed`);
