/* The master admin: one level above admin, named only in Netlify.
   Run: node --import ./test/support/use-fake-blobs.mjs test/master-admin.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { ACCOUNTS, isMaster, publicAccount } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/account.mjs";
let n = 0; const ok = m => { n++; console.log("ok", m); };

process.env.MASTER_ADMINS = " Master@Example.test ";
const mst = { id: "m1", name: "Max Master", email: "master@example.test", areas: ["office"], level: "admin", pwv: "1", lastSignIn: "x" };
const own = { id: "c1", name: "Owen Owner", email: "owner@example.test", areas: ["office"], level: "admin", pwv: "1", lastSignIn: "x" };
const sta = { id: "s1", name: "Sam Staff", email: "staff@example.test", areas: ["field"], level: "edit", pwv: "1" };
assert.equal(isMaster(mst), true); assert.equal(isMaster(own), false); assert.equal(isMaster({ ...mst, level: "edit" }), false); assert.equal(isMaster({ ...mst, active: false }), false);
assert.equal(publicAccount(mst).master, true);
ok("master admin is set only by MASTER_ADMINS in Netlify, must be an active admin");

const s = getStore({ name: "am-inventory", consistency: "strong" });
await s.setJSON(ACCOUNTS, { accounts: { m1: mst, c1: own, s1: sta }, settings: { idleHours: 8, payrollSplit: true } });
const tok = a => signToken(s, { k: "acct", a, v: "1", t: Date.now(), m: 0 });
const post = async (who, body) => { const r = await handler(new Request("https://site/api/account", { method: "POST", headers: { authorization: "Bearer " + await tok(who), "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };

for (const action of ["update", "reset", "invite", "cancelInvite", "remove"]) {
  const r = await post("c1", { action, id: "m1", level: "view", name: "x" });
  assert.equal(r.status, 403, action); assert.match(r.body.message, /master admin/);
}
ok("an admin cannot change, reset, invite, cancel or remove the master admin's account");

let r = await post("m1", { action: "update", id: "c1", title: "Owner and president" });
assert.equal(r.status, 200); assert.equal(r.body.account.title, "Owner and president");
r = await post("c1", { action: "update", id: "s1", title: "Site lead" });
assert.equal(r.status, 200);
ok("the master admin can change an admin's account; admins still manage everyone else");

console.log(`\n${n} master admin checks pass`);
