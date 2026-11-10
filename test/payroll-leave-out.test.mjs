/* The payroll split leaves out salaried staff, subcontractors and agency temps.
   Run: node test/payroll-leave-out.test.mjs */
import { strict as assert } from "node:assert";
import { buildReport, withDefaults, leftOutReason, isAgencyName, periodFor } from "../netlify/functions/_payroll.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const job = (number, branch) => ({ number, name: "Job " + number, location: { city: "Edmonton" }, customFieldValues: { nodes: branch ? [{ value: branch }] : [] } });
const entry = (name, mins, code, j, type = "Regular") => ({ user: { id: name, name }, minutes: mins, type, isApproved: true, startedAt: "2026-10-01T14:00:00Z", endedAt: "2026-10-01T22:00:00Z", costItem: { costCode: { number: code, name: "x" } }, job: j });

const settings = withDefaults({});
assert.equal(settings.leaveOut["Ryan Mirandilla"], "Salaried");
assert.equal(settings.leaveOut["Maxim"], "Subcontractor");
ok("Ryan (salaried) and Maxim (subcontractor) are left out by default");

assert.equal(leftOutReason("ryan  mirandilla", settings), "Salaried");
assert.equal(leftOutReason("Ryan", settings), null);
ok("names match exactly, ignoring case and extra spaces, so another Ryan is not caught");

assert.ok(isAgencyName("Mo (Aces)")); assert.ok(isAgencyName("Peter Calma (ACES)")); assert.ok(!isAgencyName("Carlos"));
ok("agency temps are recognised by the agency in their JobTread name");

const p = periodFor("2026-10-01", settings);
const r = buildReport([
  entry("Carlos", 480, "53100", job("26-00662", "Edmonton")),
  entry("Ryan Mirandilla", 480, "53100", job("26-00662", "Edmonton")),
  entry("Maxim", 240, "0000", job("26-00000")),
  entry("Mo (Aces)", 480, "53100", job("26-00662", "Edmonton"))
], settings, p);
assert.deepEqual(r.employees.map(e => e.name), ["Carlos"]);
assert.equal(r.totals.hours, 8);
assert.deepEqual(r.leftOut.map(l => [l.name, l.reason, l.total]), [["Maxim", "Subcontractor", 4], ["Ryan Mirandilla", "Salaried", 8]]);
assert.equal(r.tempHours, 8);
ok("only hourly A&M payroll is split; left-out and temp hours are listed, not lost");

const r2 = buildReport([entry("Ryan Mirandilla", 480, "53100", job("26-00662", "Edmonton"))], withDefaults({ leaveOut: {} }), p);
assert.deepEqual(r2.employees.map(e => e.name), ["Ryan Mirandilla"]);
ok("an empty saved list puts everyone back in");

console.log(`\n${n} payroll leave-out checks passed`);
