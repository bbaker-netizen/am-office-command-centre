/* /api/cashflow end to end: sign-in gate, first read copies Craig's plan,
   QuickBooks reports read and placed, ticks and moves saved.
   QuickBooks is answered by a stand-in fetch.
   Run: node --import ./test/support/use-fake-blobs.mjs test/cashflow-api.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/cashflow.mjs";
import { SEED_ITEMS } from "../netlify/functions/_cfseed.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const s = getStore({ name: "am-inventory", consistency: "strong" });
const craig = { id: "c1", name: "Craig Williams", areas: ["office", "money", "payroll", "field", "assistants"], level: "admin", pwv: "1" };
const viewer = { id: "v1", name: "Brenda Williams", areas: ["office", "money"], level: "view", pwv: "1" };
const field = { id: "f1", name: "Zach Sikora", areas: ["field"], level: "edit", pwv: "1" };
await s.setJSON(ACCOUNTS, { accounts: { c1: craig, v1: viewer, f1: field }, settings: { idleHours: 8, payrollSplit: true } });
await s.setJSON("qbo-tokens", { access_token: "x", refresh_token: "y", realmId: "123", expires_at: Date.now() + 3600000 });
await s.setJSON("bank-actual", { current: null, history: [{ amount: -540000, date: "2026-11-15", by: "Craig Williams", at: "2026-11-15T18:00:00Z" }] });

const col = t => ({ ColTitle: t });
const report = (cols, rows) => ({ Columns: { Column: cols.map(col) }, Rows: { Row: rows.map(r => ({ type: "Data", ColData: r.map(v => ({ value: v })) })) } });
const calls = [];
globalThis.fetch = async (url) => {
  const u = String(url); calls.push(u);
  const j = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("AgedReceivableDetail")) return j(report(["Date", "Transaction Type", "Num", "Customer", "Due Date", "Amount", "Open Balance"], [
    ["2026-10-20", "Invoice", "PRO-26-00500", "Chandos Construction", "2026-11-19", "78606.00", "78606.00"],
    ["2026-08-01", "Invoice", "PRO-26-00320", "Bird Construction", "2026-08-31", "78568.71", "78568.71"]]));
  if (u.includes("AgedPayableDetail")) return j(report(["Date", "Transaction Type", "Num", "Vendor", "Due Date", "Amount", "Open Balance"], [
    ["2026-09-01", "Bill", "A1", "AP Solutions & Resources LTD.", "2026-10-01", "40000", "40000"]]));
  if (u.includes("BalanceSheet")) return j({ Rows: { Row: [] } });
  if (u.includes("/query")) return j({ QueryResponse: { Account: [{ Id: "35", Name: "BMO Business Chequing", CurrentBalance: -563087 }] } });
  if (u.includes("GeneralLedger")) return j({ Rows: { Row: [{ Header: { ColData: [{ value: "BMO Business Chequing" }] }, Rows: { Row: [{ ColData: [{ value: "2026-11-09" }] }] } }] } });
  throw new Error("unexpected fetch " + u);
};
const tok = async a => signToken(s, { k: "acct", a, v: "1", t: Date.now(), m: 0 });
const call = async (who, method = "GET", body) => {
  const r = await handler(new Request("https://site/api/cashflow", { method, headers: { authorization: "Bearer " + await tok(who), "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  return { status: r.status, body: await r.json() };
};

let r = await call("f1");
assert.equal(r.status, 403);
ok("a field account cannot see the cash flow");

r = await call("c1");
assert.equal(r.status, 200, JSON.stringify(r.body));
assert.equal(r.body.items.length, SEED_ITEMS.length);
assert.equal(r.body.roomNow, 210000);
assert.ok(r.body.weeks[0].in.find(x => x.name === "Chandos Construction"));
assert.ok(r.body.chase.find(x => x.name === "Bird Construction"));
assert.ok(r.body.lateBills.find(x => x.name.startsWith("AP Solutions")));
assert.ok(calls.some(c => c.includes("account=35")));
ok("first read copies Craig's 74 planned lines, reads QuickBooks, starts from Sunday's -$540,000");

r = await call("v1", "POST", { action: "done", key: r.body.weeks[0].in[0].key });
assert.equal(r.status, 403);
ok("a look-only account cannot tick anything");

const chandos = (await call("c1")).body.weeks[0].in.find(x => x.name === "Chandos Construction").key;
r = await call("c1", "POST", { action: "done", key: chandos, label: "Chandos" });
assert.equal(r.status, 200); assert.ok(!r.body.weeks[0].in.find(x => x.name === "Chandos Construction"));
const bird = (await call("c1")).body.chase[0].key;
r = await call("c1", "POST", { action: "place", key: bird, week: "2026-11-25" });
assert.ok(r.body.weeks.find(w => w.start === "2026-11-23").in.find(x => x.name === "Bird Construction"));
r = await call("c1", "POST", { action: "add", item: { name: "WCB", amount: "13,616", every: "once", start: "2026-11-25", cat: "wcb" } });
assert.ok(r.body.items.find(x => x.name === "WCB" && x.amount === 13616));
assert.ok(r.body.log[0].text.startsWith("Added WCB"));
r = await call("c1", "POST", { action: "add", item: { name: "", amount: "5" } });
assert.equal(r.status, 400);
ok("Craig ticks Chandos received, moves Bird to the week of 23 Nov, adds WCB; bad lines refused; each change logged with his name");

console.log(`\n${n} cash flow page checks pass`);
