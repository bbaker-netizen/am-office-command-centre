/* Payroll as its own area, through the real /api/account and /api/payroll code,
   against a stand-in data store. Nothing real is called.
   Run: node --import ./test/support/use-fake-blobs.mjs test/payroll-area.test.mjs */
import { strict as assert } from "node:assert";

process.env.PW_ITER = "1000";
const { default: account } = await import("../netlify/functions/account.mjs");
const { default: payroll } = await import("../netlify/functions/payroll.mjs");
const { hashPassword, readAccounts, PRESETS } = await import("../netlify/functions/_accounts.mjs");
const { authStore } = await import("../netlify/functions/_auth.mjs");
const s = authStore();
let n = 0; const ok = m => { n++; console.log("ok", m); };

/* Three accounts from before the split: an admin and an office person who see
   Money, and an estimator who does not. No payrollSplit flag yet. */
const now = new Date().toISOString();
const pw = await hashPassword("a good long password");
const acct = (id, email, name, areas, level) => ({ id, email, name, areas, level, active: true, pw, pwv: now, mustChange: false, createdAt: now, lastSignIn: now });
await s.setJSON("app-accounts", { accounts: {
  "a-admin": acct("a-admin", "craig@amabatement.com", "Craig", ["office", "money", "field", "assistants"], "admin"),
  "a-brenda": acct("a-brenda", "brenda@amabatement.com", "Brenda Williams", ["office", "money", "assistants"], "edit"),
  "a-jen": acct("a-jen", "jen@amabatement.com", "Jen Garrison", ["office", "assistants"], "admin")
}, settings: { idleHours: 8 } });

const post = (body, tok) => account(new Request("https://x/api/account", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": "10.0.0.1", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }));
const pay = tok => payroll(new Request("https://x/api/payroll?action=settings", { headers: { authorization: "Bearer " + tok } }));
const j = async r => ({ status: r.status, b: await r.json() });
const signIn = async email => { const r = await j(await post({ action: "login", email, password: "a good long password" })); assert.equal(r.status, 200, email + " signs in"); return r.b.token; };

/* 1. Nobody loses payroll on the day it splits. */
let d = await readAccounts(s);
assert.deepEqual(d.accounts["a-admin"].areas, ["office", "money", "payroll", "field", "assistants"]);
assert.deepEqual(d.accounts["a-brenda"].areas, ["office", "money", "payroll", "assistants"]);
assert.deepEqual(d.accounts["a-jen"].areas, ["office", "assistants"]);
ok("everyone who saw Money is given Payroll; others are not");
assert.equal(PRESETS.office.areas.includes("payroll"), true);
assert.equal(PRESETS.estimating.areas.includes("payroll"), false);
ok("Whole company and Office include Payroll, Estimating does not");

const craig = await signIn("craig@amabatement.com");
const brenda = await signIn("brenda@amabatement.com");
let jen = await signIn("jen@amabatement.com");

/* 2. Payroll's door checks Payroll, not Money. */
assert.equal((await pay(brenda)).status, 200);
assert.equal((await pay(jen)).status, 403);
ok("Brenda (migrated) opens payroll, Jen without Payroll is refused");

/* 3. Give Jen Payroll without Money. */
let r = await j(await post({ action: "update", id: "a-jen", areas: ["office", "payroll", "assistants"] }, craig));
assert.equal(r.status, 200, JSON.stringify(r.b));
assert.deepEqual(r.b.account.areas, ["office", "payroll", "assistants"]);
assert.equal(r.b.account.responsibilityLabel, "Custom");
assert.equal((await pay(jen)).status, 200);
const me = await j(await post({ action: "me" }, jen));
assert.equal(me.b.account.areas.includes("money"), false);
ok("Jen gets Payroll without Money and payroll opens for her");

/* 4. The one-time grant does not come back. Take Payroll off Brenda, keep Money. */
r = await j(await post({ action: "update", id: "a-brenda", areas: ["office", "money", "assistants"] }, craig));
assert.equal(r.status, 200);
d = await readAccounts(s);
assert.equal(d.settings.payrollSplit, true);
assert.deepEqual(d.accounts["a-brenda"].areas, ["office", "money", "assistants"]);
assert.equal((await pay(await signIn("brenda@amabatement.com"))).status, 403);
ok("an admin can untick Payroll for a Money person and it stays unticked");

/* 5. Payroll on its own is not enough, same rule as the Assistants. */
r = await j(await post({ action: "update", id: "a-jen", areas: ["payroll"] }, craig));
assert.equal(r.status, 400);
ok("Payroll alone is refused: tick Office, Money or Field as well");

console.log(n + " checks passed");
