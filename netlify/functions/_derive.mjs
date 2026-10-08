/* A&M Inventory - the shop worked out on the server.

   The same arithmetic as derive() and settled() in public/app.js, cut down to
   what a read-only summary needs: what is on the shelf, where each machine is,
   and what is still out on each job. If one changes, change the other. */

const settled = l => {
  const out = (l && l.out) || 0, back = (l && l.back) || 0, raw = (l && l.consumed) || 0;
  const room = Math.round(Math.max(0, out - back) * 10000) / 10000;
  const used = Math.min(raw, room);
  return { out, back, used, still: Math.round(Math.max(0, out - back - used) * 10000) / 10000 };
};

/* Calendar day in Edmonton, not in London. */
export function localDay(d = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

export function deriveShop(catalog, eventsIn) {
  const cat = catalog || { units: [], stock: [], jobs: [] };
  const units = cat.units || [], stock = cat.stock || [];
  const unitById = new Map(units.map(u => [u.id, u]));
  const resetAt = (cat.settings && cat.settings.dataResetAt) || "";
  const events = (eventsIn || []).filter(e => !resetAt || String(e.at) >= String(resetAt))
    .sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));

  const onHand = new Map(), unitAt = new Map(), jobLoad = new Map(), lost = new Map(), received = new Map();
  const line = (j, id) => {
    if (!jobLoad.has(j)) jobLoad.set(j, new Map());
    const m = jobLoad.get(j);
    if (!m.has(id)) m.set(id, { id, out: 0, back: 0, consumed: 0, lastAt: "" });
    return m.get(id);
  };
  const settleUnit = (e, n) => {
    const at = unitAt.get(e.itemId);
    if (!at || at.where !== "job" || !at.jobId) return;
    const l = line(at.jobId, e.itemId); l.back += n; l.lastAt = e.at;
  };
  const add = (id, n) => onHand.set(id, (onHand.get(id) || 0) + n);

  for (const e of events) {
    const isUnit = unitById.has(e.itemId);
    switch (e.type) {
      case "ISSUE": {
        const l = line(e.jobId, e.itemId); l.out += e.qty || 0; l.lastAt = e.at;
        if (isUnit) unitAt.set(e.itemId, { where: "job", jobId: e.jobId, at: e.at, by: e.by, dueBack: e.dueBack || "" });
        else add(e.itemId, -(e.qty || 0));
        break;
      }
      case "RETURN":
        if (isUnit) { settleUnit(e, e.qty || 1); unitAt.set(e.itemId, { where: "shop", jobId: null, at: e.at, by: e.by }); }
        else { const l = line(e.jobId, e.itemId); l.back += e.qty || 0; l.lastAt = e.at; add(e.itemId, e.qty || 0); }
        break;
      case "CONSUME": { const l = line(e.jobId, e.itemId); l.consumed += e.qty || 0; l.lastAt = e.at; break; }
      case "TRANSFER": {
        if (isUnit) settleUnit(e, e.qty || 1);
        else { const f = line(e.fromJobId, e.itemId); f.back += e.qty || 0; f.lastAt = e.at; }
        const t = line(e.toJobId, e.itemId); t.out += e.qty || 0; t.lastAt = e.at;
        if (isUnit) unitAt.set(e.itemId, { where: "job", jobId: e.toJobId, at: e.at, by: e.by });
        break;
      }
      case "RECEIVE": add(e.itemId, e.qty || 0); if (e.unitCost) received.set(e.itemId, e.unitCost); break;
      case "COUNT": onHand.set(e.itemId, e.qty || 0); break;
      case "ADJUST": add(e.itemId, e.qty || 0); break;
      case "MISSING":
        if (isUnit) {
          settleUnit(e, e.qty || 1);
          unitAt.set(e.itemId, { where: "missing", jobId: e.jobId || null, at: e.at, by: e.by });
          lost.set(e.itemId, { itemId: e.itemId, since: e.at, by: e.by, jobId: e.jobId || null });
        } else if (e.jobId) { const l = line(e.jobId, e.itemId); l.back += e.qty || 1; l.lastAt = e.at; }
        break;
      case "FOUND":
        if (isUnit) unitAt.set(e.itemId, e.jobId ? { where: "job", jobId: e.jobId, at: e.at, by: e.by } : { where: "shop", jobId: null, at: e.at, by: e.by });
        lost.delete(e.itemId);
        break;
      case "WRITEOFF":
        if (isUnit) unitAt.set(e.itemId, { where: "writeoff", jobId: null, at: e.at, by: e.by });
        lost.delete(e.itemId);
        break;
      case "REPAIR":
        if (isUnit) { settleUnit(e, e.qty || 1); unitAt.set(e.itemId, { where: "repair", jobId: null, at: e.at, by: e.by }); }
        else if (e.jobId) { const l = line(e.jobId, e.itemId); l.back += e.qty || 1; l.lastAt = e.at; }
        break;
      case "FIXED":
        if (isUnit) unitAt.set(e.itemId, { where: "shop", jobId: null, at: e.at, by: e.by });
        break;
    }
  }

  /* A shelf line is a number only once somebody has counted it, received it,
     or written it on the master list. Until then it is "not counted". */
  for (const s of stock) if (!onHand.has(s.id) && s.onHand != null) onHand.set(s.id, s.onHand);
  const established = new Set(stock.filter(s => s.onHand != null).map(s => s.id));
  for (const e of events) if (e.type === "COUNT" || e.type === "RECEIVE") established.add(e.itemId);
  for (const id of [...onHand.keys()]) if (!established.has(id)) onHand.delete(id);

  return { onHand, unitAt, jobLoad, lost, received, unitById, settled };
}

/* The summary the command centre shows. Names and numbers only: no people's
   PINs, no prices per person, nothing that changes anything. */
export function buildFeed(catalog, events) {
  const d = deriveShop(catalog, events);
  const cat = catalog || {};
  const stock = cat.stock || [], units = cat.units || [], jobs = cat.jobs || [];
  const stockById = new Map(stock.map(s => [s.id, s]));
  const today = localDay();
  const nameOf = id => (d.unitById.get(id) || stockById.get(id) || {}).name || String(id);
  const priceOf = id => {
    if (d.received.has(id)) return Number(d.received.get(id)) || 0;
    const s = stockById.get(id); return s && s.price != null ? Number(s.price) || 0 : 0;
  };

  const where = { shop: 0, job: 0, repair: 0, missing: 0, writeoff: 0 };
  for (const u of units) { const at = d.unitAt.get(u.id); where[at ? at.where : "shop"] = (where[at ? at.where : "shop"] || 0) + 1; }

  const low = [];
  let notCounted = 0;
  for (const s of stock) {
    const n = d.onHand.get(s.id);
    if (n == null) { notCounted++; continue; }
    if (s.min != null && n <= s.min) {
      const unit = d.received.has(s.id) ? Number(d.received.get(s.id)) : (s.price != null ? Number(s.price) : null);
      const want = Math.max(0, (s.max != null ? s.max : s.min * 2) - n);
      low.push({ id: s.id, name: s.name, onHand: n, min: s.min, max: s.max ?? null, uom: s.uom || "",
        vendor: s.vendor || "", price: unit, order: want, orderCost: unit != null ? Math.round(unit * want * 100) / 100 : null });
    }
  }
  low.sort((a, b) => (a.onHand / (a.min || 1)) - (b.onHand / (b.min || 1)));

  const jobOut = [];
  for (const j of jobs) {
    const m = d.jobLoad.get(j.id);
    const machines = units.filter(u => { const at = d.unitAt.get(u.id); return at && at.where === "job" && at.jobId === j.id; })
      .map(u => ({ id: u.id, name: u.name, since: (d.unitAt.get(u.id) || {}).at || "", dueBack: (d.unitAt.get(u.id) || {}).dueBack || "" }));
    let materialUsed = 0;
    const shelfOut = [];
    if (m) for (const l of m.values()) {
      if (d.unitById.has(l.id)) continue;
      const s = d.settled(l);
      materialUsed += s.used * priceOf(l.id);
      if (s.still > 0.001) shelfOut.push({ id: l.id, name: nameOf(l.id), still: s.still });
    }
    if (!machines.length && !shelfOut.length && !materialUsed && j.closed) continue;
    jobOut.push({
      id: j.id, name: j.name || "", jobtreadId: j.jobtreadId || "", jobtreadNumber: j.jobtreadNumber || j.number || "",
      closed: !!j.closed, mobDate: j.mobDate || "", expectedReturn: j.expectedReturn || "",
      machinesOut: machines.length, machines, shelfLinesOut: shelfOut.length, shelfOut,
      materialUsedCost: Math.round(materialUsed * 100) / 100,
      overdueReturn: !!(j.expectedReturn && j.expectedReturn < today && (machines.length || shelfOut.length))
    });
  }

  return {
    generatedAt: new Date().toISOString(),
    catalogRev: (cat.meta && cat.meta.rev) || 0,
    machines: { total: units.length, ...where },
    shelf: { items: stock.length, counted: stock.length - notCounted, notCounted, low },
    jobs: jobOut,
    gearOnClosedJobs: jobOut.filter(j => j.closed && (j.machinesOut || j.shelfLinesOut)).map(j => j.id),
    lost: [...d.lost.values()].map(x => ({ id: x.itemId, name: nameOf(x.itemId), since: x.since, jobId: x.jobId, by: x.by || "" }))
  };
}
