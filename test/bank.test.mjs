/* Cash in the bank: QuickBooks or the balance Craig typed in.
   Run: node test/bank.test.mjs */
import { strict as assert } from "node:assert";
import { cleanActual, readBankAccounts, lastEntryDate, pickCash, addActual, clearActual } from "../netlify/functions/_bank.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const T = "2026-11-15";

assert.deepEqual(cleanActual({ amount: "-540,000", date: "2026-11-15" }, T).value, { amount: -540000, date: "2026-11-15", note: "" });
assert.equal(cleanActual({ amount: "(25,000.50)" }, T).value.amount, -25000.5);
assert.equal(cleanActual({ amount: "$12,345" }, T).value.date, T);
ok("balances typed with commas, dollar signs, minus or brackets are read right");

assert.equal(cleanActual({ amount: "abc" }, T).ok, false);
assert.equal(cleanActual({ amount: "" }, T).ok, false);
assert.equal(cleanActual({ amount: "100", date: "2026-11-16" }, T).ok, false);
assert.equal(cleanActual({ amount: "100", date: "2026-09-01" }, T).ok, false);
assert.equal(cleanActual({ amount: "100", date: "15/11/2026" }, T).ok, false);
assert.equal(cleanActual({ amount: "999999999" }, T).ok, false);
ok("no words, future dates, dates over 60 days old, wrong date shapes or silly amounts");

const acct = readBankAccounts({ QueryResponse: { Account: [
  { Id: "35", Name: "BMO Business Chequing", CurrentBalance: -563087.12, MetaData: { LastUpdatedTime: "2026-11-10T09:00:00-07:00" } },
  { Id: "36", Name: "Savings", CurrentBalance: 91304, Active: true },
  { Id: "37", Name: "Old ATB", CurrentBalance: 0, Active: false }
] } });
assert.deepEqual(acct.map(a => a.id), ["35", "36"]);
assert.equal(acct[0].balance, -563087.12);
ok("bank accounts from QuickBooks, closed ones left out");

const gl = { Rows: { Row: [
  { Header: { ColData: [{ value: "BMO Business Chequing" }] }, Rows: { Row: [
    { ColData: [{ value: "2026-11-02" }, { value: "Deposit" }] },
    { ColData: [{ value: "2026-11-09" }, { value: "Expense" }] }
  ] }, Summary: { ColData: [{ value: "Total for BMO Business Chequing" }] } },
  { Rows: { Row: [{ ColData: [{ value: "2026-11-06" }] }, { ColData: [{ value: "2026-12-01" }] }] } }
] } };
assert.equal(lastEntryDate(gl, T), "2026-11-09");
assert.equal(lastEntryDate({}, T), null);
const whole = { Rows: { Row: [
  { Header: { ColData: [{ value: "Accounts Receivable (A/R)" }] }, Rows: { Row: [{ ColData: [{ value: "2026-11-15" }] }] } },
  { Header: { ColData: [{ value: "BMO Business Chequing" }] }, Rows: { Row: [{ ColData: [{ value: "2026-11-09" }] }] } }
] } };
assert.equal(lastEntryDate(whole, T, ["BMO Business Chequing", "Savings"]), "2026-11-09");
assert.equal(lastEntryDate(whole, T, ["Parent:Savings"]), null);
ok("newest bank entry date in the ledger is 9 November (Danielle's import), future-dated cheques ignored");

const q = { amount: -514433, lastEntry: "2026-11-09" };
assert.deepEqual(pickCash({ qbo: q, actual: null, today: T }).source, "quickbooks");
const mine = pickCash({ qbo: q, actual: { amount: -540000, date: "2026-11-13", by: "Craig Williams" }, today: T });
assert.equal(mine.source, "you"); assert.equal(mine.amount, -540000); assert.equal(mine.gap, -25567); assert.equal(mine.stale, false);
ok("Craig's figure for 13 November leads while QuickBooks only reaches 9 November");

const caught = pickCash({ qbo: { amount: -538000, lastEntry: "2026-11-13" }, actual: { amount: -540000, date: "2026-11-13" }, today: T });
assert.equal(caught.source, "quickbooks"); assert.equal(caught.amount, -538000); assert.equal(caught.caughtUp, true);
ok("once the import reaches his date, QuickBooks leads again by itself");

const old = pickCash({ qbo: q, actual: { amount: -500000, date: "2026-11-05" }, today: T });
assert.equal(old.source, "quickbooks");
const stale = pickCash({ qbo: { amount: -514433, lastEntry: "2026-11-02" }, actual: { amount: -500000, date: "2026-11-05" }, today: T });
assert.equal(stale.source, "you"); assert.equal(stale.stale, true); assert.equal(stale.ageDays, 10);
const noDate = pickCash({ qbo: { amount: -514433, lastEntry: null }, actual: { amount: -500000, date: "2026-11-14" }, today: T });
assert.equal(noDate.source, "you");
ok("whichever is newer wins; a figure over a week old is flagged; unknown import date keeps his figure");

let doc = addActual(null, { amount: -540000, date: "2026-11-13", note: "" }, "Craig Williams", "2026-11-13T23:00:00Z");
doc = addActual(doc, { amount: -560000, date: "2026-11-08", note: "Sunday" }, "Craig Williams", "2026-11-15T17:00:00Z");
assert.equal(doc.current.date, "2026-11-13"); assert.equal(doc.history.length, 2);
doc = addActual(doc, { amount: -530000, date: "2026-11-15", note: "" }, "Craig Williams", "2026-11-15T18:00:00Z");
assert.equal(doc.current.amount, -530000);
const cleared = clearActual(doc); assert.equal(cleared.current, null); assert.equal(cleared.history.length, 3);
ok("a late entry for last Sunday does not replace a newer figure; clearing keeps the history for the cash flow");

console.log(`\n${n} bank checks pass`);
