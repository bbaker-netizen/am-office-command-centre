/* A&M - the equipment sheet's check, every 15 minutes, 7:00 to 5:30 on
   weekdays (Mountain). New rows that pass go into the shop; the rest wait,
   with the reason, on the command centre's Equipment page. See _equipsheet.mjs. */
import { getStore } from "@netlify/blobs";
import { localNow, inWorkingHours } from "./_assist.mjs";
import { readCfg, checkNow } from "./equipment-sheet.mjs";

export default async () => {
  const s = getStore({ name: "am-inventory", consistency: "strong" });
  const L = localNow();
  if (!inWorkingHours(L)) return new Response("Outside working hours.");
  const cfg = await readCfg(s);
  if (!cfg.fileId || !cfg.auto) return new Response("No equipment sheet switched on.");
  try { const r = await checkNow(s, { apply: true, by: "Equipment sheet" }); return new Response("Added " + r.added.length + ", held " + r.held.length + "."); }
  catch (e) { return new Response("Check failed: " + e.message); }
};

export const config = { schedule: "*/15 12-23 * * 1-5" };
