/* A&M - one person's check-in, run in the background (up to 15 minutes).
   Started only by assistant-checkin.mjs, with the app's own run secret. */

import { getStore } from "@netlify/blobs";
import { readAccounts, userOf } from "./_accounts.mjs";
import { runFor } from "./assistant.mjs";
import { runSecret } from "./_runsecret.mjs";

export default async (req) => {
  const s = getStore({ name: "am-inventory", consistency: "strong" });
  if (req.headers.get("x-am-run") !== await runSecret(s)) return new Response("No.", { status: 403 });
  const b = await req.json().catch(() => ({}));
  const { accounts, settings } = await readAccounts(s);
  const a = accounts[b.userId]; if (!a || a.active === false) return new Response("No such person.", { status: 404 });
  await runFor(s, userOf(a, settings), ["morning", "noon", "end", "sort"].includes(b.slot) ? b.slot : "sort", { heavy: true });
  return new Response("ok");
};
