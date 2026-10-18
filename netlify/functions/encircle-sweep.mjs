/* A&M - Encircle morning check, weekdays before the crews start.

   Webhooks can be missed. This walks every open awarded job, fixes what the
   webhook did not catch, and counts the photos on each linked Encircle job.
   The result is saved so the Sites screen can show it, because a check that
   fails quietly looks the same as one with nothing to do. */

import { getStore } from "@netlify/blobs";
import { STORE, SWEEP_KEY, loadSettings, encircleClient, jobtreadClient, syncJob } from "./_encircle.mjs";

export async function runSweep(store, deps = {}) {
  const s = deps.s || await loadSettings(store);
  const summary = { started: new Date().toISOString(), mode: s.mode, checked: 0, counts: {}, needsAPerson: [], photos: {}, error: null };
  if (s.mode === "off") summary.error = "ENCIRCLE_MODE is off.";
  else {
    try {
      const jt = deps.jt || jobtreadClient(s);
      const enc = deps.enc || encircleClient(s);
      const ids = await jt.awardedJobIds();
      summary.checked = ids.length;
      for (const id of ids) {
        let r;
        try { r = await syncJob(id, { s, jt, enc }); } catch (e) { r = { jobId: id, result: "problem", why: e.message }; }
        summary.counts[r.result] = (summary.counts[r.result] || 0) + 1;
        if (r.result === "problem" || r.result === "match-by-hand") summary.needsAPerson.push(r);
        if (r.claimId && r.number) {
          try { summary.photos[r.number] = await enc.photoCount(r.claimId); } catch (e) { summary.photos[r.number] = null; }
        }
      }
    } catch (e) {
      summary.error = e.message;
    }
  }
  summary.finished = new Date().toISOString();
  try { await store.setJSON(SWEEP_KEY, summary); } catch (e) { console.error("encircle-sweep: could not save:", e.message); }
  return summary;
}

export default async () => {
  const store = getStore({ name: STORE, consistency: "strong" });
  const summary = await runSweep(store);
  console.log("encircle-sweep:", JSON.stringify({ ...summary, photos: Object.keys(summary.photos).length }));
};

/* 13:00 UTC is 6:00 am Mountain in winter and 7:00 am in summer. */
export const config = { schedule: "0 13 * * 1-5" };
