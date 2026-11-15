/* A&M - the assistants' three check-ins a day, in the cloud.

   Runs at the top of every hour from 6 am to 5 pm Mountain on weekdays (the
   UTC hours cover both standard and daylight time) and acts only at 7:00
   (morning), 12:00 (noon) and 17:00 (end of day), Edmonton time. Nothing
   runs outside A&M's working hours (Monday to Friday, 7:00 to 5:30).

   Each person's check-in can take longer than a scheduled function's 30
   seconds (sorting mail with Claude, drafting replies), so this hands each
   person to assistant-run-background, which may run for up to 15 minutes. If
   the site cannot run background functions, it does a light check-in here
   instead (the list, the chase, the email) without sorting mail. */

import { getStore } from "@netlify/blobs";
import { localNow, checkinSlot } from "./_assist.mjs";
import { assistantPeople, runFor } from "./assistant.mjs";
import { runSecret } from "./_runsecret.mjs";

export default async () => {
  const s = getStore({ name: "am-inventory", consistency: "strong" });
  const L = localNow(), slot = checkinSlot(L);
  if (!slot) return new Response("Not a check-in hour (" + L.weekday + " " + L.time + ").");
  /* Once per slot per day, even if the schedule fires twice. */
  const mark = "assist-ran-" + L.date + "-" + slot;
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
    if (!handed) { try { await runFor(s, u, slot, { heavy: false }); } catch (e) {} }
    done.push(u.name + (handed ? " (background)" : " (light)"));
  }
  return new Response(slot + ": " + done.join(", "));
};

export const config = { schedule: "0 12-23 * * 1-5" };
