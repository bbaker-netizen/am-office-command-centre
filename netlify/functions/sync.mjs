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
import { authGate, stripSecrets, mergeSecrets, writeAuthIndex, requireOffice } from "./_auth.mjs";
import { withLock } from "./_lock.mjs";

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

/* WHY THE CURSOR IS A COUNTER AND NOT A CLOCK OF ANY KIND
   This used to hand back everything with `at` later than the last `at` the
   phone held. `at` is when the work happened, written by the phone, and the
   whole point of this app is that the work happens hours before it is sent.

   So: Zach loads a van in a basement at 07:14 and has no signal until noon.
   Meanwhile the office phone has already pulled at 09:00 and moved its marker
   to 09:00. When Zach's 07:14 movement finally lands, every phone whose marker
   is past 07:14 asks for "everything after 09:00" and is told, correctly and
   uselessly, that there is nothing. That movement is never delivered to them
   again. The office had it, the shop did not, and the two screens disagreed for
   good. That is what put thirteen machines on jobs the shop could not see.

   Using the server's own clock instead fixes the offline case but not the whole
   problem: two phones syncing in the same millisecond get the same stamp, and a
   cursor sitting exactly on that millisecond excludes the second one forever.
   A millisecond is a long time with eleven people on a shift change.

   So the cursor is a plain counter. Every movement gets the next number as it
   is stored, and a phone asks for everything above the highest number it holds.
   Numbers cannot collide, cannot run backwards, and do not care what any phone
   thinks the time is. `at` is still what the movements are sorted and reasoned
   about by, because that is when the work actually happened; it is simply no
   longer used to decide what has been delivered. */
async function eventsSince(s, since) {
  const idx = await readIndex(s);
  const months = [...idx.months].sort();
  const monthMax = idx.monthMax || {};
  /* A number is a cursor from this version. Anything else is a phone that has
     not been updated yet, or a first run, and both are answered with the whole
     log: it is one pull, it is correct, and the phone drops the duplicates by
     id without counting anything twice. */
  const sinceSeq = /^\d+$/.test(String(since || '')) ? Number(since) : 0;
  const out = [];
  for (const m of months) {
    // A month whose highest number is already held cannot be hiding anything.
    if (sinceSeq && monthMax[m] != null && monthMax[m] <= sinceSeq) continue;
    const doc = await readMonth(s, m);
    for (const e of doc.events) {
      // No number means it predates this scheme. Send it and let the phone
      // decide; a duplicate is free, a missing movement is not.
      if (e.seq == null || e.seq > sinceSeq) out.push(e);
    }
  }
  // Sorted by when the work happened, which is what the counts are built from.
  out.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  return { events: out, cursor: String(idx.seq || 0) };
}

export default async (req) => {
  const s = store();
  const denied = await authGate(req, s);
  if (denied) return denied;
  const url = new URL(req.url);

  // ------------------------------------------------------------------ pull
  if (req.method === "GET") {
    const since = url.searchParams.get("since") || "";
    const wantCatalog = url.searchParams.get("catalog") !== "0";
    const raw = wantCatalog ? await s.get(CATALOG, { type: "json" }) : undefined;
    /* The PIN salts and hashes come off here, and this is the only door the
       catalog leaves by. See the note in _auth.mjs about four digits being ten
       thousand guesses. */
    const catalog = raw ? stripSecrets(raw) : raw;
    /* events=0 asks for the people and stock list only. Used when a save has
       to be retried, which used to drag the whole movement history down with it. */
    const wantEvents = url.searchParams.get("events") !== "0";
    const { events, cursor } = wantEvents ? await eventsSince(s, since) : { events: [], cursor: since };
    return json({
      catalog: catalog || null,
      events,
      cursor,                       // hand this straight back on the next pull
      you: req.amUser ? { name: req.amUser.name, role: req.amUser.role || "crew" } : null,
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

    /* Bucketed by when it ARRIVED, not by when it happened, which is what lets
       a pull skip whole months safely: a blob that closed before your cursor
       cannot be holding anything you have not seen. A movement made in August
       and sent in September lands in September's blob, where the September
       readers will actually look for it. */
    const receivedAt = new Date().toISOString();
    const byMonth = new Map();
    for (const e of incoming) {
      if (!e || !e.id || !e.type) continue;
      if (!e.at) e.at = receivedAt;
      const k = monthKey(receivedAt);
      if (!byMonth.has(k)) byMonth.set(k, []);
      byMonth.get(k).push(e);
    }

    const by = req.amUser ? req.amUser.name : "";
    let out;
    try {
      out = await withLock(s, "events", async () => {
    const accepted = [];
    const duplicates = [];
    const idx = await readIndex(s);
    const months = new Set(idx.months);
    const monthMax = { ...(idx.monthMax || {}) };
    let seq = idx.seq || 0;

    /* A movement already stored anywhere is a replay of a dropped connection,
       not a second movement. Ids are made on the phone precisely so this is
       free, but the check has to look across every month, not only the one
       being written, or a retry that crosses a month boundary is counted twice. */
    const stored = new Set();
    for (const m of months) {
      const doc = await readMonth(s, m);
      for (const e of doc.events) stored.add(e.id);
    }

    for (const [k, list] of byMonth) {
      const doc = await readMonth(s, k);
      const have = new Set(doc.events.map(e => e.id));
      let changed = false;
      for (const e of list) {
        if (have.has(e.id) || stored.has(e.id)) { duplicates.push(e.id); continue; }
        have.add(e.id);
        stored.add(e.id);
        /* The name the phone wrote is kept, because that is who did the work.
           Who was signed in when it arrived is added by the server, which a
           phone cannot change. */
        doc.events.push({ ...e, receivedAt, seq: ++seq, ...(by ? { sentBy: by } : {}) });
        accepted.push(e.id);
        changed = true;
      }
      if (changed) {
        doc.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
        await s.setJSON(k, doc);
        months.add(k);
        monthMax[k] = doc.events.reduce((m, e) => (e.seq > m ? e.seq : m), 0);
      }
    }

    /* The counter and the per-month high-water marks go up together with the
       months themselves, because a pull uses the marks to decide which months it
       can skip. Written whenever anything was stored, not only when a new month
       appeared, which is what the old check did. */
    if (accepted.length || months.size !== idx.months.length) {
      await s.setJSON(INDEX, { months: [...months].sort(), seq, monthMax });
    }
    return { accepted, duplicates, seq };
      });
    } catch (e) {
      /* Nothing was stored, so the phone keeps its queue and tries again. */
      return json({ error: "busy", message: e.message || "The office is busy. Trying again shortly." }, 503);
    }
    const { accepted, duplicates, seq } = out;

    return json({
      accepted, duplicates,
      stored: accepted.length,
      cursor: String(seq),
      serverTime: new Date().toISOString()
    });
  }

  // --------------------------------------------------------------- catalog
  if (req.method === "PUT") {
    let incoming;
    try { incoming = await req.json(); }
    catch { return json({ error: "Body was not valid JSON." }, 400); }

    const got = await s.getWithMetadata(CATALOG, { type: "json" });
    const existing = got ? got.data : null;
    const currentRev = existing?.meta?.rev ?? 0;
    const basedOn = incoming?.meta?.basedOnRev;

    if (existing && typeof basedOn === "number" && basedOn !== currentRev) {
      return json({
        conflict: true,
        serverRev: currentRev,
        message: "Someone else saved a change while this page was open. Reload to pick up their version, then reapply your edit."
      }, 409);
    }

    /* The phone was never given anybody's PIN, so the catalog coming back
       cannot be allowed to say what the PINs are. Without this line the first
       save from any screen would blank all eight and shut the shop out of its
       own app. Freshly issued ones arrive complete and are kept. */
    const office = !req.amUser || !!req.amUser.office;
    const merged = mergeSecrets(incoming, existing, { office });

    const doc = {
      ...merged,
      meta: {
        ...(merged.meta || {}),
        rev: currentRev + 1,
        savedAt: new Date().toISOString(),
        basedOnRev: undefined
      }
    };
    /* Written only if nobody else saved since it was read, so two saves in the
       same second cannot both pass the revision check and lose one of them. */
    const w = got
      ? await s.setJSON(CATALOG, doc, { onlyIfMatch: got.etag })
      : await s.setJSON(CATALOG, doc, { onlyIfNew: true });
    if (!w || !w.modified) {
      return json({
        conflict: true,
        serverRev: currentRev,
        message: "Someone else saved a change at the same moment. Trying again."
      }, 409);
    }
    /* Who may sign in has just changed, possibly. Rebuilt here so that
       switching somebody off, or resetting their PIN, reaches the gate on the
       very next request rather than whenever something else happens to run. */
    try { await writeAuthIndex(s, doc); } catch (e) {}
    return json({ ok: true, rev: doc.meta.rev, savedAt: doc.meta.savedAt });
  }

  /* ----------------------------------------------------------------- purge
     Starting the shop over for real: the movement log is emptied, not merely
     ignored. Every phone already learns to let go of the old life from the
     stamp on the catalog, so this is the tidying up behind that, and it exists
     so "we cleared it out" means the rows are actually gone rather than
     quietly filtered on eleven screens.

     It will only run when the caller quotes the reset stamp currently on the
     catalog, which means the catalog has to have been stamped first, on
     purpose, by somebody who knew they were doing it. That is a deliberate
     two-step: it cannot be reached by a stray request, and it cannot be
     repeated afterwards without stamping again. */
  if (req.method === "DELETE") {
    const notOffice = requireOffice(req);
    if (notOffice) return notOffice;
    let body;
    try { body = await req.json(); }
    catch { return json({ error: "Body was not valid JSON." }, 400); }

    const cat = await s.get(CATALOG, { type: "json" });
    const stamp = cat?.settings?.dataResetAt;
    if (!stamp) {
      return json({ error: "Nothing has been marked for a reset. Stamp the catalog first." }, 409);
    }
    if (body.dataResetAt !== stamp) {
      return json({ error: "That does not match the reset on the catalog." }, 403);
    }

    const idx = await readIndex(s);
    let removed = 0, kept = 0;
    for (const m of idx.months) {
      const doc = await readMonth(s, m);
      const keep = doc.events.filter(e => String(e.at) >= String(stamp));
      removed += doc.events.length - keep.length;
      kept += keep.length;
      await s.setJSON(m, { ...doc, events: keep });
    }
    // The counter is deliberately left where it is. Numbers are never reused,
    // so a phone holding an old cursor is simply told there is nothing new
    // rather than being handed somebody else's movements under an old number.
    return json({ ok: true, removed, kept, dataResetAt: stamp });
  }

  return json({ error: "Method not allowed." }, 405);
};

export const config = { path: "/api/sync" };
