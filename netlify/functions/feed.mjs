/* A&M Inventory - read-only summary for the command centre.

   GET /api/feed with the header  Authorization: Bearer <FEED_TOKEN>

   FEED_TOKEN is set in Netlify and is NOT a person's sign-in. It can read this
   summary and nothing else: no PINs, no people list, no keys, and it cannot
   write anything. If FEED_TOKEN is not set, this answers 404, so the feed does
   not exist until somebody deliberately turns it on. Rotate it by changing it
   in Netlify. */

import { getStore } from "@netlify/blobs";
import { buildFeed } from "./_derive.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function same(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (!x || x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export default async (req) => {
  const want = process.env.FEED_TOKEN || "";
  if (!want || want.length < 24) return json({ error: "Not found." }, 404);
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const h = req.headers.get("authorization") || "";
  const got = /^Bearer\s+/i.test(h) ? h.replace(/^Bearer\s+/i, "").trim() : "";
  if (!same(got, want)) return json({ error: "Not allowed." }, 401);

  const s = store();
  const catalog = await s.get("catalog", { type: "json" });
  const idx = (await s.get("ev-index", { type: "json" })) || { months: [] };
  const events = [];
  for (const m of [...idx.months].sort()) {
    const doc = await s.get(m, { type: "json" });
    if (doc && Array.isArray(doc.events)) events.push(...doc.events);
  }
  return json(buildFeed(catalog || {}, events));
};

export const config = { path: "/api/feed" };
