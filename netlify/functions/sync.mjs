/* A&M Abatement Services - inventory sync.

   The phone is the source of truth at the moment of the action. Everything a
   crew member does is written to the phone first and queued. This endpoint
   drains that queue.

   Two rules make the whole thing safe:

   1. Movements are EVENTS, not edits. "Zach took NEG-44 to job 4021 at 07:14"
      and "Byron returned it at 16:30" are both true. They sequence, they do not
      collide, so two people working offline can never overwrite each other.
      Quantity on hand is always derived, never typed.

   2. Every event carries an id made on the phone. Replaying the queue after a
      dropped connection is therefore free: an id already stored is skipped.
      This is what stops a retry from double counting.

   The catalog (units, stock, jobs, users, settings) IS editable, so it uses a
   revision check instead. If someone else saved while your page was open, the
   save is refused rather than silently clobbering their work. */

import { getStore } from "@netlify/blobs";

const STORE = "am-inventory";
const CATALOG = "catalog";
const INDEX = "ev-index";

const store = () => getStore({ name: STORE, consistency: "strong" });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

const monthKey = iso => "ev-" + String(iso || new Date().toISOString()).slice(0, 7);

async function readIndex(s) {
  return (await s.get(INDEX, { type: "json" })) || { months: [] };
}

async function readMonth(s, key) {
  return (await s.get(key, { type: "json" })) || { key, events: [] };
}

/* Pull everything the phone has not seen. `since` is the timestamp of the last
   event the phone already holds. Months are read newest-first and stopped early
   once we are past the window, so a two-year log does not get shipped daily. */
async function eventsSince(s, since) {
  const idx = await readIndex(s);
  const months = [...idx.months].sort();
  const cutMonth = since ? String(since).slice(0, 7) : null;
  const out = [];
  for (const m of months) {
    if (cutMonth && m < "ev-" + cutMonth) continue;
    const doc = await readMonth(s, m);
    for (const e of doc.events) {
      if (!since || e.at > since) out.push(e);
    }
  }
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return out;
}

export default async (req) => {
  const s = store();
  const url = new URL(req.url);

  // ------------------------------------------------------------------ pull
  if (req.method === "GET") {
    const since = url.searchParams.get("since") || "";
    const wantCatalog = url.searchParams.get("catalog") !== "0";
    const catalog = wantCatalog ? await s.get(CATALOG, { type: "json" }) : undefined;
    const events = await eventsSince(s, since);
    return json({
      catalog: catalog || null,
      events,
      serverTime: new Date().toISOString()
    });
  }

  // ------------------------------------------------------------------ push
  if (req.method === "POST") {
    let body;
    try { body = await req.json(); }
    catch { return json({ error: "Body was not valid JSON." }, 400); }

    const incoming = Array.isArray(body.events) ? body.events : [];
    if (!incoming.length) return json({ accepted: [], duplicates: [], stored: 0 });

    // Group by month so each blob is written once, not once per event.
    const byMonth = new Map();
    for (const e of incoming) {
      if (!e || !e.id || !e.type) continue;
      if (!e.at) e.at = new Date().toISOString();
      const k = monthKey(e.at);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(e);
    }

    const accepted = [];
    const duplicates = [];
    const idx = await readIndex(s);
    const months = new Set(idx.months);

    for (const [k, list] of byMonth) {
      const doc = await readMonth(s, k);
      const have = new Set(doc.events.map(e => e.id));
      let changed = false;
      for (const e of list) {
        if (have.has(e.id)) { duplicates.push(e.id); continue; }
        have.add(e.id);
        doc.events.push({ ...e, receivedAt: new Date().toISOString() });
        accepted.push(e.id);
        changed = true;
      }
      if (changed) {
        doc.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
        await s.setJSON(k, doc);
        months.add(k);
      }
    }

    if (months.size !== idx.months.length) {
      await s.setJSON(INDEX, { months: [...months].sort() });
    }

    return json({
      accepted, duplicates,
      stored: accepted.length,
      serverTime: new Date().toISOString()
    });
  }

  // --------------------------------------------------------------- catalog
  if (req.method === "PUT") {
    let incoming;
    try { incoming = await req.json(); }
    catch { return json({ error: "Body was not valid JSON." }, 400); }

    const existing = await s.get(CATALOG, { type: "json" });
    const currentRev = existing?.meta?.rev ?? 0;
    const basedOn = incoming?.meta?.basedOnRev;

    if (existing && typeof basedOn === "number" && basedOn !== currentRev) {
      return json({
        conflict: true,
        serverRev: currentRev,
        message: "Someone else saved a change while this page was open. Reload to pick up their version, then reapply your edit."
      }, 409);
    }

    const doc = {
      ...incoming,
      meta: {
        ...(incoming.meta || {}),
        rev: currentRev + 1,
        savedAt: new Date().toISOString(),
        basedOnRev: undefined
      }
    };
    await s.setJSON(CATALOG, doc);
    return json({ ok: true, rev: doc.meta.rev, savedAt: doc.meta.savedAt });
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/sync" };
