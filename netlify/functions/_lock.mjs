/* A&M Inventory - one writer at a time.

   Netlify runs several copies of a function at once. Before 2026-10 two phones
   pushing in the same second could each read the month's movements, each add
   their own, and each write the file back, and the second write threw away the
   first phone's movements. Both phones were told "accepted" and emptied their
   queues, so those movements were gone for good.

   This takes a short lease in the store before anything is read, using the
   store's own only-if-new and only-if-unchanged writes, so the read, the add
   and the write happen for one phone at a time. A lease left behind by a copy
   that crashed runs out by itself after a few seconds.

   Needs @netlify/blobs 10 or later for conditional writes. */

const wait = ms => new Promise(r => setTimeout(r, ms));

export async function withLock(s, name, fn, { ttlMs = 15000, maxWaitMs = 9000 } = {}) {
  const key = "lock-" + name;
  const me = crypto.randomUUID();
  const started = Date.now();
  let delay = 60;
  for (;;) {
    const lease = { holder: me, until: Date.now() + ttlMs };
    const made = await s.setJSON(key, lease, { onlyIfNew: true });
    if (made && made.modified) break;
    /* Somebody holds it. If their lease has run out, take it over, but only if
       nobody else got there first. */
    const cur = await s.getWithMetadata(key, { type: "json" });
    if (!cur) continue;
    if (!cur.data || Number(cur.data.until) < Date.now()) {
      const took = await s.setJSON(key, lease, { onlyIfMatch: cur.etag });
      if (took && took.modified) break;
    }
    if (Date.now() - started > maxWaitMs) {
      const e = new Error("The office is busy saving. Try again in a moment.");
      e.code = "BUSY";
      throw e;
    }
    await wait(delay + Math.random() * 60);
    delay = Math.min(delay * 2, 600);
  }
  try {
    return await fn();
  } finally {
    try {
      const cur = await s.getWithMetadata(key, { type: "json" });
      if (cur && cur.data && cur.data.holder === me) await s.delete(key);
    } catch (e) { /* the lease runs out by itself */ }
  }
}

/* Read, change and write one small record without losing a write that landed
   in between. Used for the wrong-PIN counters. */
export async function update(s, key, change, tries = 6) {
  for (let i = 0; i < tries; i++) {
    const cur = await s.getWithMetadata(key, { type: "json" });
    const next = change(cur ? cur.data : null);
    const res = cur
      ? await s.setJSON(key, next, { onlyIfMatch: cur.etag })
      : await s.setJSON(key, next, { onlyIfNew: true });
    if (res && res.modified) return next;
    await wait(30 + Math.random() * 70);
  }
  throw new Error("Could not record that. Try again.");
}
