/* Danielle's "Journal hours by cost code" rules in the payroll split.
   Run: node --import ./test/support/use-fake-blobs.mjs test/payroll-journal.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { withDefaults, periodFor, buildReport, buildJournal, lineOfJob, POSTED_ELSEWHERE } from "../netlify/functions/_payroll.mjs";
import { divisionOfJob } from "../netlify/functions/_expenses.mjs";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/payroll.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const job = (number, type, branch, city) => ({ id: "j" + number, number, name: "Job " + number, location: { city: city || "" },
  customFieldValues: { nodes: [type ? { value: type, customField: { name: "Job Type" } } : null, branch ? { value: branch, customField: { name: "Estimating branch" } } : null].filter(Boolean) } });
const te = (who, j, code, mins, type = "Regular") => ({ id: Math.random().toString(36), minutes: mins, type, isApproved: true, startedAt: "2026-11-03T14:00:00Z", endedAt: "2026-11-03T22:00:00Z", user: { id: who, name: who }, costItem: { costCode: { number: code, name: "" } }, job: j });

const S = withDefaults({});
assert.equal(S.anchor, "2026-09-19");
assert.deepEqual([periodFor("2026-10-02", S).start, periodFor("2026-10-03", S).start, periodFor("2026-11-13", S).start, periodFor("2026-11-15", S).start], ["2026-09-19", "2026-10-03", "2026-10-31", "2026-11-14"]);
assert.equal(periodFor("2026-11-13", S).end, "2026-11-13");
ok("pay periods match Craig's workbook: 19 Sep to 2 Oct, 3 Oct, 17 Oct, 31 Oct to 13 Nov, then 14 Nov");

const moved = withDefaults({ anchor: "2026-09-28" });
assert.equal(moved.anchor, "2026-09-19"); assert.equal(moved.anchorMoved, true);
assert.equal(withDefaults({ anchor: "2026-09-28", anchorConfirmed: true }).anchor, "2026-09-28");
ok("the old 28 September start moves to 19 September once, unless someone chose it on purpose");

assert.equal(lineOfJob(job("26-1", "Mitigation"), "Asbestos"), "Restoration");
assert.equal(lineOfJob(job("26-2", ["Mitigation", "Asbestos Abatement"]), "Asbestos"), "Asbestos");
assert.equal(lineOfJob(job("26-3", null), "Asbestos"), null);
ok("job type decides: asbestos work on a mitigation job stays Restoration (Mitigation)");

const P = periodFor("2026-11-03", S);
const entries = [
  te("Richard Woniala", job("26-00700", "Mitigation", "Edmonton"), "53100", 480),
  te("Richard Woniala", job("26-00701", null, "Edmonton"), "55100", 120),
  te("Zach", job("26-20080", "Asbestos Abatement", "Calgary"), "53100", 600),
  te("Zach", job("26-00000", null, null), "53100", 60),
  te("Ryan Mirandilla", job("26-00700", "Mitigation", "Edmonton"), "53100", 300),
  te("Peter Calma (Aces)", job("26-00700", "Mitigation", "Edmonton"), "53100", 600, "Standard temp rate")
];
let r = buildReport(entries, S, P);
const rich = r.employees.find(e => e.name === "Richard Woniala");
assert.equal(rich.byBucket["Restoration Edmonton"].total, 8);
assert.equal(rich.byBucket["Mould Edmonton"].total, 2);
assert.deepEqual(r.noJobType.map(j => j.job), ["26-00701"]);
const zach = r.employees.find(e => e.name === "Zach");
assert.equal(zach.byBucket["Asbestos Calgary"].total, 10);
assert.equal(zach.byBucket["Shop (overhead)"].total, 1);
assert.deepEqual(r.crewOnCalgary.map(c => [c.person, c.job, c.hours, c.countedAs]), [["Zach", "26-20080", 10, "Calgary"]]);
assert.ok(!r.employees.find(e => e.name === "Ryan Mirandilla")); assert.equal(r.leftOut[0].name, "Ryan Mirandilla");
assert.equal(r.tempHours, 10);
ok("Richard's 8 hours on a mitigation job are Restoration; a job with no type falls back to its cost code and is listed; shop stays overhead; Ryan and the Aces temp are out");

r = buildReport(entries, withDefaults({ crewRule: "crew" }), P);
assert.equal(r.employees.find(e => e.name === "Zach").byBucket["Asbestos Edmonton"].total, 10);
assert.equal(r.crewOnCalgary[0].countedAs, "Edmonton");
r = buildReport(entries, withDefaults({ crewRule: "crew", calgaryCrew: ["zach"] }), P);
assert.equal(r.employees.find(e => e.name === "Zach").byBucket["Asbestos Calgary"].total, 10);
assert.equal(r.crewOnCalgary.length, 0);
ok("Calgary jobs by the Edmonton crew: Calgary by default, Edmonton when switched to Craig's rule, and Calgary-based people stay Calgary");

assert.equal(Math.round(POSTED_ELSEWHERE.reduce((s, p) => s + p.moved, 0) * 100) / 100, 75495.91);
ok("the three periods Danielle posted add up to the $75,495.91 in Craig's workbook");

assert.equal(divisionOfJob({ number: "26-00700", jobType: "Mitigation" }), "Restoration");
assert.equal(divisionOfJob({ number: "26-00000" }), "Shop and office");
assert.equal(divisionOfJob({ number: "26-00702", jobType: "" }), "No type");
ok("expenses, km and supplies use the same job type rule");

/* Through the server: periods since 19 September, and no posting twice */
const s = getStore({ name: "am-inventory", consistency: "strong" });
await s.setJSON(ACCOUNTS, { accounts: { c1: { id: "c1", name: "Craig Williams", areas: ["office", "money", "payroll", "field"], level: "admin", pwv: "1" } }, settings: { idleHours: 8, payrollSplit: true } });
await s.setJSON("jobtread-key", { grantKey: "k", organizationId: "o" });
globalThis.fetch = async () => new Response(JSON.stringify({ organization: { timeEntries: { nodes: entries, nextPage: null } } }), { status: 200, headers: { "content-type": "application/json" } });
const tok = await signToken(s, { k: "acct", a: "c1", v: "1", t: Date.now(), m: 0 });
const call = async (q, body) => { const res = await handler(new Request("https://site/api/payroll" + q, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined })); return { status: res.status, body: await res.json() }; };
let res = await call("?action=report&start=2026-10-31");
assert.equal(res.status, 200, JSON.stringify(res.body));
const per = res.body.periods;
assert.deepEqual(per.slice(0, 4).map(p => [p.start, !!p.posted, p.paid]), [["2026-09-19", true, "2026-10-09"], ["2026-10-03", true, "2026-10-23"], ["2026-10-17", true, "2026-11-06"], ["2026-10-31", false, "2026-11-20"]]);
assert.ok(per[0].posted.outside);
res = await call("", { action: "journal", start: "2026-10-03", costs: { "Richard Woniala": 1000, Zach: 900 }, post: true });
assert.equal(res.status, 409); assert.equal(res.body.error, "already_posted");
ok("catch-up list: the first three periods are marked posted by Danielle (paid 9 Oct, 23 Oct, 6 Nov); 31 Oct to 13 Nov is next; posting an October period again is refused");

console.log(`\n${n} payroll journal checks pass`);
