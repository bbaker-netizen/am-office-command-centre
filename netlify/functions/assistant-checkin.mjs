/* A&M - the assistants' three check-ins a day, and the mail sort between
   them, in the cloud.

   Runs on the hour and the half hour from 6 am to 5:30 pm Mountain on
   weekdays (the UTC hours cover both standard and daylight time).
   - At 7:00 (morning), 12:00 (noon) and 17:00 (end of day), Edmonton time:
     the check-in, once per slot per day.
   - Every other half hour from 7:00 to 5:30: the mail sort only, so what
     needs a person reaches their hit list within about half an hour instead
     of waiting for the next check-in (2026-11-17). No email is sent for it.
   Nothing runs outside A&M's working hours (Monday to Friday, 7:00 to 5:30).

   Each person's run can take longer than a scheduled function's 30 seconds
   (sorting mail with Claude, drafting replies), so this hands each person to
   assistant-run-background, which may run for up to 15 minutes. If the site
   cannot run background functions, a check-in is done light here instead
   (the list, the chase, the email) without sorting mail, and the half-hour
   sorts are skipped. */

import { getStore } from "@netlify/blobs";
import { localNow, checkinSlot, inWorkingHours } from "./_assist.mjs";
import { assistantPeople, runFor } from "./assistant.mjs";
import { runSecret } from "./_runsecret.mjs";

export default async () => {
  const s = getStore({ name: "am-inventory", consistency: "strong" });
  const L = localNow();
  if (!inWorkingHours(L)) return new Response("Outside working hours (" + L.weekday + " " + L.time + ").");
  const half = L.minute >= 30 ? "30" : "00";
  const slot = (half === "00" && checkinSlot(L)) || "sort";
  /* Once per slot per day (or per half hour for the sort), even if the schedule fires twice. */
  const mark = slot === "sort" ? "assist-sort-" + L.date + "-" + String(L.hour).padStart(2, "0") + half : "assist-ran-" + L.date + "-" + slot;
  if (await s.get(mark)) return new Response("Already ran.");
  await s.set(mark, new Date().toISOString());
  const people = await assistantPeople(s);
  const site = process.env.URL || "";
  const secret = await runSecret(s);
  const done = [];
  for (const u of people) {
    let handed = false;
    if (site) {
      try {
        const r = await fetch(site + "/.netlify/functions/assistant-run-background", { method: "POST", headers: { "content-type": "application/json", "x-am-run": secret }, body: JSON.stringify({ userId: u.id, slot }) });
        handed = r.status === 202 || r.ok;
      } catch (e) {}
    }
    if (!handed && slot !== "sort") { try { await runFor(s, u, slot, { heavy: false }); } catch (e) {} }
    done.push(u.name + (handed ? " (background)" : slot === "sort" ? " (skipped)" : " (light)"));
  }
  return new Response(slot + ": " + done.join(", "));
};

export const config = { schedule: "0,30 12-23 * * 1-5" };
