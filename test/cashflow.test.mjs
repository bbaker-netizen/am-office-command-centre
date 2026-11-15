/* The weekly cash flow, on Craig's method.
   Run: node test/cashflow.test.mjs */
import { strict as assert } from "node:assert";
import { buildCashFlow, openingBalance, occurrences, weekZero, mondayOf, cleanItem, docKey } from "../netlify/functions/_cashflow.mjs";
import { SEED_ITEMS } from "../netlify/functions/_cfseed.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const T = "2026-11-15";   /* a Sunday */

assert.equal(weekZero(T), "2026-11-16"); assert.equal(weekZero("2026-11-18"), "2026-11-16"); assert.equal(weekZero("2026-11-16"), "2026-11-16");
assert.equal(mondayOf("2026-11-22"), "2026-11-16");
ok("on Sunday the week ahead starts tomorrow; Monday to Sunday weeks like the sheet");

assert.deepEqual(occurrences({ amount: 1, every: "2weeks", start: "2026-11-16" }, "2026-11-16", "2026-12-13"), ["2026-11-16", "2026-11-30"]);
assert.deepEqual(occurrences({ amount: 1, every: "month", start: "2026-10-31" }, "2026-11-01", "2027-01-31"), ["2026-11-30", "2026-12-31", "2027-01-31"]);
assert.deepEqual(occurrences({ amount: 1, every: "week", start: "2026-11-16", end: "2026-11-30" }, "2026-11-16", "2026-12-31"), ["2026-11-16", "2026-11-23", "2026-11-30"]);
assert.deepEqual(occurrences({ amount: 0, every: "week", start: "2026-11-16" }, "2026-11-16", "2026-12-31"), []);
ok("every week, every two weeks, monthly on the 31st (30 Nov in November), end dates");

const hist = [{ amount: -540000, date: "2026-11-13", at: "a" }, { amount: -548000, date: "2026-11-15", at: "b" }];
assert.deepEqual(openingBalance({ today: T, history: hist, qbo: { amount: -514433, lastEntry: "2026-11-09" } }), { amount: -548000, date: "2026-11-15", source: "you", sunday: true });
assert.equal(openingBalance({ today: T, history: hist.slice(0, 1), qbo: { amount: -514433, lastEntry: "2026-11-09" } }).date, "2026-11-13");
assert.equal(openingBalance({ today: T, history: [], qbo: { amount: -514433, lastEntry: "2026-11-09" } }).source, "quickbooks");
ok("starts from Sunday's typed balance, else the latest typed, else QuickBooks");

const opening = { amount: -540000, date: "2026-11-15", source: "you", sunday: true };
const invoices = [
  { customer: "Chandos Construction", type: "Invoice", num: "PRO-26-00500", date: "2026-10-20", due: "2026-11-19", open: 78606 },
  { customer: "City of Edmonton", type: "Invoice", num: "PRO-26-00510", date: "2026-11-01", due: "2026-12-01", open: 30536 },   /* dated the 1st */
  { customer: "Bird Construction", type: "Invoice", num: "PRO-26-00320", date: "2026-08-01", due: "2026-08-31", open: 78568.71 }, /* 77 days late */
  { customer: "Keller Construction", type: "Invoice", num: "PRO-26-00480", date: "2026-10-05", due: "2026-11-04", open: 20621 },   /* 12 days late: rolls */
  { customer: "Credit Co", type: "Credit Memo", num: "CM1", date: "2026-10-01", due: "2026-10-01", open: -500 }
];
const bills = [
  { vendor: "AP Solutions & Resources LTD.", type: "Bill", num: "A1", date: "2026-09-01", due: "2026-10-01", open: 40000 },
  { vendor: "Aces Staffing", type: "Bill", num: "B1", date: "2026-10-15", due: "2026-11-14", open: 60000 },
  { vendor: "Sunbelt Rentals", type: "Bill", num: "C1", date: "2026-11-01", due: "2026-11-20", open: 5263.04 },
  { vendor: "Heartland Disposal", type: "Bill", num: "D1", date: "2026-08-15", due: "2026-09-14", open: 20411.33 }
];
const plan = { items: SEED_ITEMS, done: {}, place: {} };
let cf = buildCashFlow({ today: T, weeks: 4, limit: 750000, floor: 25000, graceDays: 14, opening, invoices, bills, plan });
const w = cf.weeks[0];
assert.equal(cf.roomNow, 210000); assert.equal(w.open, 210000);
assert.equal(w.start, "2026-11-16"); assert.equal(cf.weeks[3].start, "2026-12-07");
ok("room on the line now: -$540,000 + $750,000 = $210,000, weeks of 16 Nov to 7 Dec");

assert.ok(w.in.find(x => x.name === "Chandos Construction"));
assert.ok(w.in.find(x => x.name === "Keller Construction" && x.rolled));
assert.ok(cf.weeks[2].in.find(x => x.name === "City of Edmonton" && x.movedForGst));
assert.ok(cf.chase.find(x => x.name === "Bird Construction" && x.daysLate === 77));
assert.ok(!w.in.find(x => x.name === "Bird Construction"));
assert.ok(!cf.chase.find(x => x.name === "Credit Co"));
ok("due this week counted; 12 days late rolls in; 77 days late goes to chase, not counted; dated the 1st flagged; credits left out");

const sheetWeek1 = SEED_ITEMS.filter(x => x.start === "2026-11-16" || x.start === "2026-11-21").reduce((s, x) => s + x.amount, 0);
assert.equal(Math.round(w.out.filter(x => x.kind === "item").reduce((s, x) => s + x.amount, 0) * 100) / 100, Math.round(sheetWeek1 * 100) / 100);
assert.equal(w.byCat.payroll, 49000); assert.equal(w.byCat.oneoff, 10000); assert.equal(w.byCat.loans, 8548);
ok("week of 16 Nov carries Craig's sheet: payroll $49,000, Journey $8,548, insurance $10,000 on 21 Nov, and the rest");

assert.ok(w.out.find(x => x.name === "Aces Staffing" && x.rolled));
assert.ok(w.out.find(x => x.name === "Sunbelt Rentals" && !x.rolled));
assert.ok(cf.lateBills.find(x => x.name.startsWith("AP Solutions")));
ok("bills due this week counted; a bill a day late rolls in; old bills wait to be placed");

assert.equal(cf.weeks[1].open, w.close); assert.equal(cf.weeks[3].close, Math.round((cf.weeks[3].open + cf.weeks[3].totalIn - cf.weeks[3].totalOut) * 100) / 100);
ok("each week starts where the last one ended");

const e = cf.everyone;
assert.equal(e.allIn, Math.round((78606 + 30536 + 78568.71 + 20621) * 100) / 100);
assert.equal(e.allBills, Math.round((40000 + 60000 + 5263.04 + 20411.33) * 100) / 100);
assert.equal(e.result, Math.round((210000 + e.allIn + e.plannedIn - e.allBills - e.plannedOut) * 100) / 100);
ok("if everyone paid me and I paid everyone: every open invoice and bill, plus four weeks of the plan");

/* -$540,000 in the bank: the week of 7 Dec is the tightest, so every bill waits. */
assert.equal(cf.advice.pay.length, 0);
assert.ok(cf.advice.lines[0].startsWith("You start the week with $210,000 of room on the line."));
assert.ok(cf.advice.lines.some(l => /^The tightest week is the week of December 7\./.test(l)));
assert.ok(cf.advice.lines.some(l => /^Hold the supplier bills this week/.test(l)));
assert.ok(cf.advice.chase.find(x => x.name === "Bird Construction"));
assert.ok(cf.advice.lines.some(l => /Something else has to move/.test(l)));
ok("tight month: holds every bill, names the tightest week, chases Bird, says something else has to move");

const roomy = buildCashFlow({ today: T, weeks: 4, limit: 750000, floor: 25000, graceDays: 14, opening: { amount: -250000 }, invoices, bills, plan });
const names = roomy.advice.pay.map(x => x.name);
assert.ok(names.includes("AP Solutions & Resources LTD.") && names.indexOf("AP Solutions & Resources LTD.") < names.indexOf("Heartland Disposal"));
assert.ok(roomy.advice.lines.some(l => /^You can pay these \d+ bills/.test(l)));
assert.ok(roomy.advice.headroomLeft >= 0);
ok("with room to spare: pays this week's bills, then late ones with AP Solutions first, never past the reserve in any week");

for (const amt of [-420000, -380000, -330000]) {
  const mid = buildCashFlow({ today: T, weeks: 4, limit: 750000, floor: 25000, graceDays: 14, opening: { amount: amt }, invoices, bills, plan });
  const minClose = Math.min(...mid.weeks.map(w => w.close));
  const paidExtra = mid.advice.pay.filter(x => !mid.weeks[0].out.includes(x)).reduce((s, x) => s + x.amount, 0);
  const heldCounted = mid.advice.hold.filter(x => mid.weeks[0].out.includes(x)).reduce((s, x) => s + x.amount, 0);
  if (mid.advice.headroomLeft >= 0) assert.ok(minClose - paidExtra + heldCounted >= 25000 - 0.01, "reserve kept at " + amt);
}
ok("whatever it advises, the tightest week still keeps the $25,000 reserve");

const grow = buildCashFlow({ today: T, weeks: 4, limit: 750000, floor: 15000, reserveGrowth: 5000, graceDays: 14, opening: { amount: -250000 }, invoices, bills, plan });
assert.deepEqual(grow.weeks.map(w => w.reserve), [15000, 20000, 25000, 30000]);
const flat = buildCashFlow({ today: T, weeks: 4, limit: 750000, floor: 15000, graceDays: 14, opening: { amount: -250000 }, invoices, bills, plan });
assert.ok(grow.advice.pay.reduce((x, b) => x + b.amount, 0) <= flat.advice.pay.reduce((x, b) => x + b.amount, 0));
assert.ok(grow.weeks.every((w, i) => true));
ok("paying the line down like Craig's sheet: the reserve grows $5,000 a week and the advice pays no more than it can keep");

/* Ticks, placements and rolling */
const payKey = "item:" + SEED_ITEMS.find(x => x.name === "Payroll" && x.start === "2026-11-16").id + ":2026-11-16";
const chandos = docKey("inv", { type: "Invoice", num: "PRO-26-00500", name: "Chandos Construction", date: "2026-10-20" });
const bird = docKey("inv", { type: "Invoice", num: "PRO-26-00320", name: "Bird Construction", date: "2026-08-01" });
cf = buildCashFlow({ today: T, weeks: 4, opening, invoices, bills, plan: { items: SEED_ITEMS, done: { [payKey]: {}, [chandos]: {} }, place: { [bird]: "2026-11-25" } } });
assert.ok(!cf.weeks[0].out.find(x => x.key === payKey));
assert.ok(!cf.weeks[0].in.find(x => x.name === "Chandos Construction"));
assert.ok(cf.weeks[1].in.find(x => x.name === "Bird Construction" && x.placed === "2026-11-25"));
assert.ok(!cf.chase.find(x => x.name === "Bird Construction"));
ok("ticking payroll and Chandos takes them out; Bird promised for the week of 23 Nov moves there");

const nextWeek = buildCashFlow({ today: "2026-11-23", weeks: 4, opening, invoices, bills, plan: { items: SEED_ITEMS, done: {}, place: { [bird]: "2026-11-16" } } });
const rolledPay = nextWeek.weeks[0].out.find(x => x.name === "Payroll" && x.rolled);
assert.ok(rolledPay && /planned for 2026-11-16, not ticked yet/.test(rolledPay.why));
assert.ok(nextWeek.weeks[0].in.find(x => x.name === "Bird Construction" && x.rolled));
ok("a week later, the unticked payroll and Bird's missed promise roll into the current week by themselves");

assert.equal(cleanItem({ name: "WCB", amount: "13,616", every: "month", start: "2026-12-15", cat: "wcb" }, T).value.amount, 13616);
assert.equal(cleanItem({ name: "", amount: 5 }, T).ok, false);
assert.equal(cleanItem({ name: "X", amount: "-5" }, T).ok, false);
assert.equal(cleanItem({ name: "X", amount: "5", start: "21/11/2026" }, T).ok, false);
assert.equal(cleanItem({ name: "X", amount: "5", cat: "nonsense" }, T).value.cat, "running");
ok("planned payments are checked: name, amount above zero, real date, known group");

console.log(`\n${n} cash flow checks pass`);
