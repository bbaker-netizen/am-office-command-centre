/* My day arranged each person's way, kept on their own account (Craig, 2026-11-20).
   Run: node --import ./test/support/use-fake-blobs.mjs test/layout.test.mjs */
import { strict as assert } from "node:assert";

process.env.PW_ITER = "1000";
const { default: account } = await import("../netlify/functions/account.mjs");
const { default: command } = await import("../netlify/functions/command.mjs");
const { hashPassword, ACCOUNTS, userOf, toursOf } = await import("../netlify/functions/_accounts.mjs");
const { authStore } = await import("../netlify/functions/_auth.mjs");
const s = authStore();
let n = 0; const ok = m => { n++; console.log("ok", m); };

const now = new Date().toISOString();
const pw = await hashPassword("a good long password");
await s.setJSON(ACCOUNTS, { accounts: {
  c1: { id: "c1", email: "craig@amabatement.com", name: "Craig Williams", areas: ["office", "money", "field", "assistants"], level: "admin", active: true, pw, pwv: now, mustChange: false },
  a1: { id: "a1", email: "amir@amabatement.com", name: "Amir Faiz", areas: ["office", "field", "assistants"], level: "admin", active: true, pw, pwv: now, mustChange: false }
}, settings: { idleHours: 8 } });

const post = (body, tok, extra = {}) => account(new Request("https://x/api/account", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": "10.0.0.9", ...(tok ? { authorization: "Bearer " + tok } : {}), ...extra }, body: JSON.stringify(body) }));
const login = async email => (await (await post({ action: "login", email, password: "a good long password" })).json()).token;
const amir = await login("amir@amabatement.com"), craig = await login("craig@amabatement.com");
const me = async tok => (await command(new Request("https://x/api/command?part=me", { headers: { authorization: "Bearer " + tok } }))).json();


assert.deepEqual((await me(amir)).layouts, {});
ok("a new person has My day as it comes");

assert.equal((await post({ action: "layout", page: "myday", layout: { order: ["list"] } })).status, 401);
ok("nobody signed out can save one");

let r = await post({ action: "layout", page: "myday", layout: { order: ["talk", "list", "inbox", "list", "BAD KEY!"], hidden: ["notes"], size: { list: "full", inbox: "narrow", talk: "huge" } } }, amir);
assert.equal(r.status, 200);
const l = (await r.json()).layouts.myday;
assert.deepEqual(l.order, ["talk", "list", "inbox"]);
assert.deepEqual(l.hidden, ["notes"]);
assert.deepEqual(l.size, { list: "full", inbox: "narrow" });
ok("order, hidden cards and widths are kept, with repeats and bad values dropped");

assert.deepEqual((await me(amir)).layouts.myday, l);
ok("every browser gets it back with the account");

assert.deepEqual((await me(craig)).layouts, {});
ok("Craig's My day is his own");

assert.equal((await post({ action: "layout", page: "payroll", layout: { order: [] } }, amir)).status, 400);
ok("only My day can be arranged");

r = await post({ action: "layout", page: "myday", layout: null }, amir);
assert.equal(r.status, 200); assert.deepEqual((await r.json()).layouts, {});
ok("Reset puts it back as it came");

console.log(n + " checks passed");
