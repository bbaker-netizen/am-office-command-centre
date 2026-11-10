/* Which task holds a job's crew, and asking JobTread in batches.
   Uses McCurdy's real task list from JobTread (26-00662, read 2026-11-10).
   Run: node test/crew.test.mjs */
import { strict as assert } from "node:assert";
import { pickTask, isFieldTask, chunk, readInBatches } from "../netlify/functions/_crew.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const m = (...names) => ({ nodes: names.map(x => ({ id: x, user: { name: x } })) });

const mccurdy = [
  { id: "t1", name: "Site Work for change order", startDate: "2026-09-21", endDate: "2026-09-21", assignedMemberships: m("Carlos") },
  { id: "t2", name: "Book air monitoring", startDate: "2026-09-30", endDate: "2026-10-02", assignedMemberships: m("Jen Garrison") },
  { id: "t3", name: "File NOP", startDate: "2026-09-30", endDate: "2026-10-02", assignedMemberships: m("Zach") },
  { id: "t4", name: "Inform client", startDate: "2026-09-30", endDate: "2026-10-02", assignedMemberships: m("Jen Garrison") },
  { id: "t5", name: "Abatement start", startDate: "2026-10-13", endDate: "2026-10-24", assignedMemberships: m("Norman Nidua") },
  { id: "t6", name: "Abatement Clean up", startDate: "2026-10-31", endDate: "2026-11-01", assignedMemberships: m("Carlos", "Richard Woniala", "Eric Carpio", "Zach") },
  { id: "t7", name: "Ceiling and Duct clean", startDate: "2026-11-04", endDate: "2026-11-04", assignedMemberships: m("Carlos") },
  { id: "t8", name: "Main Floor Clean", startDate: "2026-11-05", endDate: "2026-11-06", assignedMemberships: m("Carlos") },
  { id: "t9", name: "Main Floor Clean", startDate: null, endDate: null, assignedMemberships: m() }
];

assert.equal(isFieldTask(mccurdy[2]), false); assert.equal(isFieldTask(mccurdy[1]), false); assert.equal(isFieldTask(mccurdy[3]), false);
ok("office tasks (File NOP, Book air monitoring, Inform client) are never the crew");

assert.equal(pickTask(mccurdy, "2026-10-31").id, "t6");
ok("on 31 October McCurdy's crew is the four on Abatement Clean up");

assert.equal(pickTask(mccurdy, "2026-11-10").id, "t8");
ok("today McCurdy shows its latest field task, not September's change order");

assert.equal(pickTask(mccurdy, "2026-10-01").id, "t5");
ok("before abatement starts it shows the next field task coming up");

assert.equal(pickTask([{ id: "s", name: "Site Work", startDate: null, assignedMemberships: m() }], "2026-11-10").id, "s");
ok("an empty Site Work task is still found, so Dispatch writes the crew there");

assert.equal(pickTask([{ id: "x", name: "File NOP", startDate: "2026-11-10", assignedMemberships: m("Zach") }], "2026-11-10"), null);
ok("a job with only office tasks has no crew task");

assert.deepEqual(chunk([1, 2, 3, 4, 5, 6, 7], 3), [[1, 2, 3], [4, 5, 6], [7]]);
ok("ids are split into small batches");

{
  const calls = [];
  const ask = async g => { calls.push(g.length); if (g.length > 2) throw new Error("JobTread refused the request: Request Entity Too Large"); if (g.includes("bad")) throw new Error("Request Entity Too Large"); return Object.fromEntries(g.map(x => [x, { ok: true }])); };
  const { found, failed } = await readInBatches(["a", "b", "c", "d", "bad", "e"], ask, 6);
  assert.deepEqual(Object.keys(found).sort(), ["a", "b", "c", "d", "e"]);
  assert.deepEqual(failed, ["bad"]);
  ok("a refused batch is split in half until it fits, and one heavy job is named instead of failing the board");
}
{
  const ask = async () => { throw new Error("JobTread refused the request: bad grant key"); };
  await assert.rejects(() => readInBatches(["a", "b"], ask), /bad grant key/);
  ok("other errors still come through, so a real fault is not hidden");
}

console.log(`\n${n} crew checks passed`);
