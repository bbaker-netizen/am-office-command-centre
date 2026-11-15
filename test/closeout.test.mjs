/* Closeout checks: the 7-day rule before Thursday billing.
   Run: node test/closeout.test.mjs */
import { strict as assert } from "node:assert";
import { closeoutCheck, thursdayOnOrAfter } from "../netlify/functions/_closeout.mjs";
let n = 0; const ok = m => { n++; console.log("ok", m); };

assert.equal(thursdayOnOrAfter("2026-11-16"), "2026-11-19"); assert.equal(thursdayOnOrAfter("2026-11-19"), "2026-11-19"); assert.equal(thursdayOnOrAfter("2026-11-20"), "2026-11-26");
ok("billing is the first Thursday on or after the 7-day deadline");

const farmers = closeoutCheck({ poStatus: "", docs: [{ type: "vendorBill", status: "approved", vendor: "Disposal Co" }, { type: "vendorBill", status: "draft", vendor: "Disposal Co" }, { type: "vendorBill", status: "draft", vendor: "Rentals Co" }], lastWork: "2026-11-02", today: "2026-11-15" });
assert.deepEqual(farmers.missing, ["Client PO status not set", "No quote in JobTread", "2 bills still in draft"]);
assert.equal(farmers.deadline, "2026-11-09"); assert.equal(farmers.billing, "2026-11-12"); assert.equal(farmers.late, true); assert.equal(farmers.daysSince, 13);
ok("a job like Farmers Market (bills only, two in draft, no quote or PO status): three things missing, past the 7 days");

const good = closeoutCheck({ poStatus: "Received", docs: [{ type: "customerOrder", status: "approved" }, { type: "vendorOrder", status: "approved", vendor: "Scaffold Co" }, { type: "vendorBill", status: "approved", vendor: "Scaffold Co" }], lastWork: "2026-11-12", today: "2026-11-15" });
assert.ok(good.ok); assert.equal(good.late, false); assert.equal(good.billing, "2026-11-19");
const sub = closeoutCheck({ poStatus: "Not Required", docs: [{ type: "customerOrder", status: "pending" }, { type: "vendorOrder", status: "approved", vendor: "Scaffold Co" }], lastWork: "2026-11-12", today: "2026-11-15" });
assert.deepEqual(sub.missing, ["Quote not approved in JobTread", "No invoice yet from Scaffold Co"]); assert.equal(sub.late, false);
ok("all paperwork in: ready for Thursday 19 Nov; a subcontractor with a PO and no invoice is named");

console.log(`\n${n} closeout checks pass`);
