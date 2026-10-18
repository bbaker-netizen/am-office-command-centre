/* A&M - JobTread calls this the moment a job is created or changed.

   POST /api/encircle-hook?key=...
   The key in the address proves the call came from A&M's own webhook. The
   body is never trusted: the job is read again from JobTread every time. See
   _encircle.mjs for what happens next. Nothing happens while ENCIRCLE_MODE is
   off. */

import { timingSafeEqual } from "node:crypto";
import { getStore } from "@netlify/blobs";
import { STORE, loadSettings, encircleClient, jobtreadClient, syncJob, jobIdFromWebhook } from "./_encircle.mjs";

function sameKey(a, b) {
  const x = Buffer.from(String(a || ""));
  const y = Buffer.from(String(b || ""));
  return x.length > 0 && x.length === y.length && timingSafeEqual(x, y);
}

export default async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const key = new URL(req.url).searchParams.get("key");
  if (!sameKey(key, process.env.ENCIRCLE_HOOK_KEY)) return new Response("Not allowed", { status: 403 });

  let body = null;
  try { body = await req.json(); } catch (e) { body = null; }
  const jobId = jobIdFromWebhook(body);
  if (!jobId) {
    console.log("encircle-hook: no job id in webhook body", JSON.stringify(body).slice(0, 500));
    return Response.json({ result: "skip", why: "No job id in the webhook." });
  }

  let store = null;
  try { store = getStore({ name: STORE, consistency: "strong" }); } catch (e) {}
  const s = await loadSettings(store);
  try {
    const r = await syncJob(jobId, { s, jt: jobtreadClient(s), enc: encircleClient(s) });
    if (r.result !== "skip" && r.result !== "off") console.log("encircle-hook:", JSON.stringify(r));
    return Response.json(r);
  } catch (e) {
    console.error("encircle-hook error:", jobId, e.message);
    /* 200 so JobTread does not retry in a loop. The morning check picks it up. */
    return Response.json({ jobId, result: "problem", why: e.message });
  }
};

export const config = { path: "/api/encircle-hook" };
