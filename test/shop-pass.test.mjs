/* Admins open the shop from the command centre as themselves, with no PIN,
   and can reach the shop's people and PIN screen (Craig, 2026-11-20).
   Run: node --import ./test/support/use-fake-blobs.mjs test/shop-pass.test.mjs */
import { strict as assert } from "node:assert";

process.env.PW_ITER = "1000";
process.env.OFFICE_USERS = "Jen Garrison";
const { default: account } = await import("../netlify/functions/account.mjs");
const { hashPassword, ACCOUNTS, accountGate } = await import("../netlify/functions/_accounts.mjs");
const { authStore, authGate, requireOffice, signToken, writeAuthIndex, SHOP_PASS, SHOP_PASS_HOURS, SHOP_PASS_ACCOUNTS_KEY } = await import("../netlify/functions/_auth.mjs");
const s = authStore();
let n = 0; const ok = m => { n++; console.log("ok", m); };

assert.equal(SHOP_PASS_ACCOUNTS_KEY, ACCOUNTS);
ok("the shop gate reads the same accounts record as the command centre");

const now = new Date().toISOString();
const pw = await hashPassword("a good long password");
const acc = (id, name, email, level) => ({ id, email, name, areas: ["office", "field"], level, active: true, pw, pwv: now, mustChange: false });
await s.setJSON(ACCOUNTS, { accounts: {
  c1: acc("c1", "Craig Williams", "craig@amabatement.com", "admin"),
  d1: acc("d1", "Dennis Vries", "dennis@amabatement.com", "edit")
}, settings: { idleHours: 8 } });
/* The shop is armed: Jen has a PIN, so nobody gets in without a token. */
const catalog = { users: [{ id: "u-jen", name: "Jen Garrison", active: true, pin: { salt: "x", hash: "y" }, pinSetAt: now }] };
await s.setJSON("catalog", catalog);
await writeAuthIndex(s, catalog);

const post = (body, tok, extra = {}) => account(new Request("https://x/api/account", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": "10.0.0.7", ...(tok ? { authorization: "Bearer " + tok } : {}), ...extra }, body: JSON.stringify(body) }));
const login = async email => (await (await post({ action: "login", email, password: "a good long password" })).json()).token;
const craig = await login("craig@amabatement.com"), dennis = await login("dennis@amabatement.com");
const shopReq = tok => new Request("https://x/api/sync?since=", { headers: tok ? { authorization: "Bearer " + tok } : {} });

let r = await post({ action: "shopPass" }, dennis);
assert.equal(r.status, 403);
assert.match((await r.json()).message, /Only an admin/);
ok("a non-admin cannot get a shop pass");

assert.equal((await post({ action: "shopPass" }, craig, { "x-am-view-as": "d1" })).status, 403);
ok("not while viewing as someone else");

r = await post({ action: "shopPass" }, craig);
assert.equal(r.status, 200);
const pass = await r.json();
assert.ok(pass.token); assert.equal(pass.user.name, "Craig Williams"); assert.equal(pass.user.office, true);
ok("an admin gets a shop pass in their own name");

let req = shopReq(pass.token);
assert.equal(await authGate(req, s), null);
assert.equal(req.amUser.name, "Craig Williams"); assert.equal(req.amUser.office, true); assert.equal(req.amUser.viaAccount, true);
assert.equal(requireOffice(req), null);
ok("the shop lets the admin in, with office rights, no PIN");

assert.equal((await authGate(shopReq(null), s)).status, 401);
assert.equal((await authGate(shopReq(craig), s)).status, 401);
ok("no token, or the command centre token itself, does not open the shop");

const g = new Request("https://x/api/command?part=me", { headers: { authorization: "Bearer " + pass.token } });
assert.equal((await accountGate(g, s)).status, 401);
ok("the shop pass does not open the command centre");

const forged = await signToken(s, { k: SHOP_PASS, a: "d1", v: now, t: Date.now() });
assert.equal((await authGate(shopReq(forged), s)).status, 401);
ok("a pass naming a non-admin is refused even if signed");

const old = await signToken(s, { k: SHOP_PASS, a: "c1", v: now, t: Date.now() - (SHOP_PASS_HOURS + 1) * 3600000 });
assert.equal((await authGate(shopReq(old), s)).status, 401);
ok(`a pass older than ${SHOP_PASS_HOURS} hours is refused`);

const doc = await s.get(ACCOUNTS, { type: "json" });
doc.accounts.c1.pwv = new Date(Date.now() + 1000).toISOString();
await s.setJSON(ACCOUNTS, doc);
assert.equal((await authGate(shopReq(pass.token), s)).status, 401);
ok("changing the password ends the pass");

doc.accounts.c1.pwv = now; doc.accounts.c1.level = "edit";
await s.setJSON(ACCOUNTS, doc);
assert.equal((await authGate(shopReq(pass.token), s)).status, 401);
doc.accounts.c1.level = "admin"; doc.accounts.c1.active = false;
await s.setJSON(ACCOUNTS, doc);
assert.equal((await authGate(shopReq(pass.token), s)).status, 401);
ok("no longer an admin, or switched off, ends the pass");

/* Crew PIN tokens still go through exactly as before. */
doc.accounts.c1.active = true; await s.setJSON(ACCOUNTS, doc);
const jen = await signToken(s, { u: "u-jen", p: now, t: Date.now() });
req = shopReq(jen);
assert.equal(await authGate(req, s), null);
assert.equal(req.amUser.name, "Jen Garrison"); assert.ok(!req.amUser.viaAccount);
ok("a PIN sign-in works as it always has");

console.log(`\n${n} shop pass checks passed`);
