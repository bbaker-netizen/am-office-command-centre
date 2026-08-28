/* A&M Abatement Services - Inventory.
   Core: storage, the offline queue, sync, derived counts, shell and scanner.

   THE ONE IDEA THIS APP IS BUILT ON
   Movements are events, not edits. Nobody ever types a quantity on hand.
   "Zach took NEG-44 to the Park Washrooms job at 07:14" is a fact that stays
   true forever. What is on the shelf is worked out by adding the facts up. Two
   people can both be underground with no signal and neither can overwrite the
   other, because neither of them is writing over anything.

   WHY THE CAMERA OPENS FIRST
   Every tracking product on the market lets you finish the same transaction by
   picking off a list. Within weeks nobody scans, and the moment nobody scans
   the record stops matching the shop. The pick list still exists here, because
   the two-man flow at the shelf genuinely needs it, but it sits one tap behind
   the camera and everything added that way is marked. Unscanned lines show up
   on the reconcile report by name. The point is not to stop anyone. It is to
   make sure the shortcut is visible instead of silent.

   Words this app does not use anywhere the crew can see them: SKU, asset
   register, transaction, reconciliation, utilisation, custody. */

'use strict';

const AM = (window.AM = {});

/* ------------------------------------------------------------------ helpers */
const $ = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => (crypto.randomUUID ? crypto.randomUUID() : 'x' + Date.now() + Math.random().toString(36).slice(2));
const nowISO = () => new Date().toISOString();
const money = n => (n < 0 ? '-' : '') + '$' + Math.abs(Math.round((n || 0) * 100) / 100).toLocaleString('en-CA', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qty = n => {
  const v = Math.round((n || 0) * 100) / 100;
  return Number.isInteger(v) ? String(v) : String(v);
};
const dayISO = d => (d ? new Date(d) : new Date()).toISOString().slice(0, 10);
const daysBetween = (a, b) => Math.round((new Date(b) - new Date(a)) / 86400000);

function fmtWhen(iso) {
  if (!iso) return '';
  const d = new Date(iso), n = new Date();
  const same = d.toDateString() === n.toDateString();
  const t = d.toLocaleTimeString('en-CA', { hour: 'numeric', minute: '2-digit' });
  if (same) return t;
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric' }) + ' ' + t;
}

AM.esc = esc; AM.$ = $; AM.$$ = $$; AM.uid = uid; AM.qty = qty;
AM.money = money; AM.fmtWhen = fmtWhen; AM.nowISO = nowISO; AM.dayISO = dayISO;
AM.daysBetween = daysBetween;

/* ------------------------------------------------------------- local storage
   IndexedDB, wrapped as thinly as possible. Three stores:
   kv       - catalog, sync marker, who is signed in on this phone
   events   - every movement this phone knows about, ours and everyone else's
   outbox   - the ones this phone made that the server has not confirmed yet */

const DB_NAME = 'am-inventory';
const DB_VER = 1;
let _db = null;

function db() {
  if (_db) return Promise.resolve(_db);
  return new Promise((res, rej) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
      if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
    };
    req.onsuccess = () => { _db = req.result; res(_db); };
    req.onerror = () => rej(req.error);
  });
}

/* Note for whoever maintains this: an IndexedDB request that finds nothing
   still completes successfully, it just has no result. Handing the request
   object back instead of nothing is the kind of mistake that makes a phone
   think it already has the master list when it has never seen one. */
function tx(store, mode, fn) {
  return db().then(d => new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let req;
    try { req = fn(s); } catch (e) { rej(e); return; }
    const isRequest = req && typeof req === 'object' && 'result' in req && 'readyState' in req;
    t.oncomplete = () => res(isRequest ? req.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  }));
}

const kvGet = k => tx('kv', 'readonly', s => s.get(k));
const kvSet = (k, v) => tx('kv', 'readwrite', s => s.put(v, k));
const allOf = store => tx(store, 'readonly', s => s.getAll());
const putIn = (store, v) => tx(store, 'readwrite', s => s.put(v));
const delFrom = (store, id) => tx(store, 'readwrite', s => s.delete(id));

/* --------------------------------------------------------------------- state */

const S = AM.state = {
  catalog: null,        // units, stock, locations, jobs, users, kits, settings
  events: [],           // everything known, oldest first
  outbox: [],           // not yet confirmed by the server
  me: null,             // the name on this phone
  online: navigator.onLine,
  syncing: false,
  lastSync: null,
  lastEventAt: '',
  route: '#/',
  derived: null,
  storagePersisted: null,
  installed: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
  conn: { jobtread: false, qbo: false, checked: false },
  meId: null,           // which person, not just the name on the screen
  locked: false,        // true while the app is asking for a PIN
  version: null,        // which build of the app this phone is actually running
  newVersion: null,
  reloading: false
};

/* Whether the other systems are hooked up. Only used to decide whether to put
   a "finish setting this up" card in front of somebody, and to stop nagging
   once they have. */
async function checkConnections() {
  try {
    const [jt, qb] = await Promise.all([
      fetch('/api/jobtread').then(r => r.json()).catch(() => null),
      fetch('/api/qbo?action=status').then(r => r.json()).catch(() => null)
    ]);
    S.conn = { jobtread: !!(jt && jt.connected), qbo: !!(qb && qb.connected), checked: true };
  } catch (e) { S.conn.checked = true; }
}
AM.checkConnections = checkConnections;

/* ------------------------------------------------------------------- derived
   Rebuilt from the event log every time it changes. Nothing here is stored, so
   it can never drift away from what actually happened. */

function derive() {
  const cat = S.catalog || { units: [], stock: [], jobs: [] };
  const unitById = new Map(cat.units.map(u => [u.id, u]));
  const stockById = new Map(cat.stock.map(s => [s.id, s]));

  const onHand = new Map();        // stock id -> number on the shelf
  const unitAt = new Map();        // unit id -> { where, jobId, at, by }
  const jobLoad = new Map();       // job id -> Map(itemId -> {out, back, unscanned})
  const dop = new Map();           // unit id -> latest compliance record
  const repairLog = new Map();     // unit id -> what went wrong, and what was done
  const lost = new Map();          // unit id -> the chase list, until it turns up
  const waste = new Map();         // job id -> { bags, trailers }
  const received = new Map();      // stock id -> last unit cost seen
  const requests = [];             // what the crews asked for, for tomorrow

  const ensureJob = j => {
    if (!jobLoad.has(j)) jobLoad.set(j, new Map());
    return jobLoad.get(j);
  };
  const line = (j, id) => {
    const m = ensureJob(j);
    if (!m.has(id)) m.set(id, { id, out: 0, back: 0, consumed: 0, unscanned: 0, lastAt: '' });
    return m.get(id);
  };

  for (const e of S.events) {
    switch (e.type) {

      case 'ISSUE': {
        const l = line(e.jobId, e.itemId);
        l.out += e.qty || 0;
        l.lastAt = e.at;
        if (!e.scanned) l.unscanned += e.qty || 0;
        if (unitById.has(e.itemId)) unitAt.set(e.itemId, { where: 'job', jobId: e.jobId, at: e.at, by: e.by });
        else onHand.set(e.itemId, (onHand.get(e.itemId) || 0) - (e.qty || 0));
        break;
      }

      case 'RETURN': {
        const l = line(e.jobId, e.itemId);
        l.back += e.qty || 0;
        l.lastAt = e.at;
        if (unitById.has(e.itemId)) unitAt.set(e.itemId, { where: 'shop', jobId: null, at: e.at, by: e.by });
        else onHand.set(e.itemId, (onHand.get(e.itemId) || 0) + (e.qty || 0));
        break;
      }

      /* Below half a roll does not come back to the shelf. It goes in the scrap
         box, which sits outside the count on purpose, and the job wears it. */
      case 'CONSUME': {
        const l = line(e.jobId, e.itemId);
        l.consumed += e.qty || 0;
        l.lastAt = e.at;
        break;
      }

      /* A machine going straight from one site to the next is normal work, not
         an exception. It is one movement, not a return followed by an issue,
         and cost picks up on the receiving job from this moment. */
      case 'TRANSFER': {
        const from = line(e.fromJobId, e.itemId);
        from.back += e.qty || 0;
        from.lastAt = e.at;
        const to = line(e.toJobId, e.itemId);
        to.out += e.qty || 0;
        to.lastAt = e.at;
        if (!e.scanned) to.unscanned += e.qty || 0;
        if (unitById.has(e.itemId)) unitAt.set(e.itemId, { where: 'job', jobId: e.toJobId, at: e.at, by: e.by });
        break;
      }

      case 'RECEIVE':
        onHand.set(e.itemId, (onHand.get(e.itemId) || 0) + (e.qty || 0));
        if (e.unitCost) received.set(e.itemId, e.unitCost);
        break;

      case 'COUNT':   // somebody stood in front of the shelf and counted it
        onHand.set(e.itemId, e.qty || 0);
        break;

      case 'ADJUST':
        onHand.set(e.itemId, (onHand.get(e.itemId) || 0) + (e.qty || 0));
        break;

      /* Clean demolition and asbestos leave the same site on the same day and
         are charged nothing like each other, so they are counted apart. Anything
         logged before this split is read as asbestos, which is the safe way to
         be wrong. */
      case 'WASTE': {
        const w = waste.get(e.jobId) || {
          bags: 0, trailers: 0,
          clean: { bags: 0, trailers: 0 },
          asbestos: { bags: 0, trailers: 0 }
        };
        const stream = e.stream === 'clean' ? 'clean' : 'asbestos';
        w.bags += e.bags || 0;
        w.trailers += e.trailers || 0;
        w[stream].bags += e.bags || 0;
        w[stream].trailers += e.trailers || 0;
        waste.set(e.jobId, w);
        break;
      }

      case 'DOP':
      case 'FILTER': {
        const prev = dop.get(e.itemId) || {};
        dop.set(e.itemId, { ...prev, ...e, last: e.at });
        break;
      }

      /* Cannot find it. The job settles, because holding a job open does not
         make a machine turn up; somebody chasing it does. It goes on the lost
         list instead, with the job it was last on and the man who last had it,
         and it stays there until it is found or written off. */
      case 'MISSING': {
        if (e.jobId) {
          const l = line(e.jobId, e.itemId);
          l.back += e.qty || 1;
          l.lastAt = e.at;
        }
        if (unitById.has(e.itemId)) {
          unitAt.set(e.itemId, { where: 'missing', jobId: e.jobId || null, at: e.at, by: e.by, note: e.note || '' });
          lost.set(e.itemId, {
            itemId: e.itemId, since: e.at, by: e.by, jobId: e.jobId || null,
            note: e.note || '', chase: [], state: 'lost'
          });
        }
        break;
      }

      case 'LOST_NOTE': {
        const r = lost.get(e.itemId);
        if (r) r.chase.push({ at: e.at, by: e.by, note: e.note || '' });
        break;
      }

      case 'FOUND': {
        if (unitById.has(e.itemId)) {
          unitAt.set(e.itemId, e.jobId
            ? { where: 'job', jobId: e.jobId, at: e.at, by: e.by }
            : { where: 'shop', jobId: null, at: e.at, by: e.by });
        }
        lost.delete(e.itemId);
        break;
      }

      /* Written off is an answer, not a shrug. It comes off the lost list, off
         the shop count, and it is the number that goes to the insurer. */
      case 'WRITEOFF': {
        if (unitById.has(e.itemId)) unitAt.set(e.itemId, { where: 'writeoff', jobId: null, at: e.at, by: e.by, note: e.note || '' });
        const r = lost.get(e.itemId);
        if (r) { r.state = 'writeoff'; r.closedAt = e.at; r.closedNote = e.note || ''; }
        break;
      }

      /* Broken gear does not go back on the shelf. It goes out of service with
         a note saying what is wrong, and it stays there until somebody says it
         is fixed, so nobody loads it on a van at six in the morning. Coming off
         a job it still settles the job's line, because the machine is off the
         site either way and the job should not sit open waiting for a repair. */
      case 'REPAIR': {
        if (e.jobId) {
          const l = line(e.jobId, e.itemId);
          l.back += e.qty || 1;
          l.lastAt = e.at;
        }
        if (unitById.has(e.itemId)) {
          unitAt.set(e.itemId, { where: 'repair', jobId: null, at: e.at, by: e.by, note: e.note || '' });
          repairLog.set(e.itemId, [...(repairLog.get(e.itemId) || []), { kind: 'out', at: e.at, by: e.by, note: e.note || '' }]);
        }
        break;
      }

      case 'REPAIR_NOTE':
        repairLog.set(e.itemId, [...(repairLog.get(e.itemId) || []), { kind: 'note', at: e.at, by: e.by, note: e.note || '' }]);
        break;

      case 'FIXED':
        if (unitById.has(e.itemId)) {
          unitAt.set(e.itemId, { where: 'shop', jobId: null, at: e.at, by: e.by });
          repairLog.set(e.itemId, [...(repairLog.get(e.itemId) || []), { kind: 'back', at: e.at, by: e.by, note: e.note || '' }]);
        }
        break;

      /* "Material requisitions for next day submitted by 2:00 PM." The SOP's
         own deadline, and the reason the shop's three o'clock list is worth
         walking: everything the crews asked for is already in by then. */
      case 'REQUEST':
        requests.push(e);
        break;

      case 'REQUEST_FILLED': {
        const r = requests.find(x => x.id === e.requestId);
        if (r) r.filled = { at: e.at, by: e.by };
        break;
      }
    }
  }

  // Seed the shelf counts from whatever the shop wrote on the master list, so
  // the app is not empty on day one before the first count happens.
  for (const s of cat.stock) {
    if (!onHand.has(s.id) && s.onHand != null) onHand.set(s.id, s.onHand);
  }

  // Everything still out, per job, with nothing returned against it.
  const outstanding = new Map();
  for (const [jobId, m] of jobLoad) {
    const rows = [];
    for (const l of m.values()) {
      const still = (l.out - l.back - l.consumed);
      if (still > 0.001) rows.push({ ...l, still });
    }
    if (rows.length) outstanding.set(jobId, rows);
  }

  // Anything signed out with a date on it that has come and gone, and is still
  // not back. Absent is normal. Overdue is a phone call.
  const overdue = [];
  const today = new Date().toISOString().slice(0, 10);
  for (const e of S.events) {
    if (e.type !== 'ISSUE' || !e.dueBack || !unitById.has(e.itemId)) continue;
    const at = unitAt.get(e.itemId);
    if (at && at.where === 'job' && e.dueBack < today) {
      if (!overdue.some(o => o.itemId === e.itemId)) {
        overdue.push({ itemId: e.itemId, jobId: at.jobId, dueBack: e.dueBack, since: at.at, by: at.by });
      }
    }
  }

  S.derived = { onHand, unitAt, jobLoad, outstanding, dop, repairLog, lost, waste, received, requests, overdue, unitById, stockById };
  return S.derived;
}
AM.derive = derive;

/* -------------------------------------------------------------- the outbox
   Every action goes here first. It reaches the server when it reaches the
   server. On iPhone that means the next time somebody opens the app, because
   Apple does not run background sync in a web app at all. That is why the
   pending count sits on every screen and why the app has to be installed to
   the home screen rather than left as a Safari tab. */

async function record(evt) {
  const e = {
    id: uid(),
    at: nowISO(),
    by: S.me || 'unknown',
    byId: S.meId || null,
    device: navigator.userAgent.slice(0, 60),
    ...evt
  };
  S.events.push(e);
  S.outbox.push(e);
  await putIn('events', e);
  await putIn('outbox', e);
  derive();
  render();
  syncSoon();
  return e;
}
AM.record = record;

/* Records several movements as one batch, so a whole pile going out to a job
   is one round trip rather than twenty. */
async function recordMany(list) {
  const out = [];
  for (const evt of list) {
    const e = { id: uid(), at: nowISO(), by: S.me || 'unknown', byId: S.meId || null, ...evt };
    S.events.push(e);
    S.outbox.push(e);
    await putIn('events', e);
    await putIn('outbox', e);
    out.push(e);
  }
  derive();
  render();
  syncSoon();
  return out;
}
AM.recordMany = recordMany;

/* ---------------------------------------------------------------------- sync */

let syncTimer = null;
function syncSoon(ms = 800) {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => sync().catch(() => {}), ms);
}

async function sync(opts = {}) {
  if (S.syncing) return;
  if (!navigator.onLine) { S.online = false; render(); return; }
  S.syncing = true; S.online = true; render();

  try {
    // Push first, so what this phone did is never lost to a pull that lands on
    // top of it.
    if (S.outbox.length) {
      const batch = S.outbox.slice(0, 200);
      const r = await fetch('/api/sync', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ events: batch })
      });
      if (r.ok) {
        const res = await r.json();
        const done = new Set([...(res.accepted || []), ...(res.duplicates || [])]);
        for (const e of batch) {
          if (done.has(e.id)) { await delFrom('outbox', e.id); }
        }
        S.outbox = S.outbox.filter(e => !done.has(e.id));
      }
    }

    // Pull anything anyone else did.
    const since = S.lastEventAt ? `?since=${encodeURIComponent(S.lastEventAt)}` : '?since=';
    const r2 = await fetch('/api/sync' + since);
    if (r2.ok) {
      const res = await r2.json();
      if (res.catalog) {
        S.catalog = res.catalog;
        await kvSet('catalog', res.catalog);
      }
      let added = 0;
      const have = new Set(S.events.map(e => e.id));
      for (const e of (res.events || [])) {
        if (have.has(e.id)) continue;
        S.events.push(e);
        await putIn('events', e);
        added++;
        if (e.at > S.lastEventAt) S.lastEventAt = e.at;
      }
      if (added) S.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      await kvSet('lastEventAt', S.lastEventAt);
      S.lastSync = res.serverTime;
      await kvSet('lastSync', S.lastSync);
      derive();
    }
  } catch (e) {
    S.online = false;
  } finally {
    S.syncing = false;
    render();
  }
}
AM.sync = sync;

/* Catalog edits are real edits, so they use a revision check rather than the
   event log. If somebody else saved while this page was open the save is
   refused instead of quietly overwriting them. */
async function saveCatalog() {
  const body = { ...S.catalog, meta: { ...(S.catalog.meta || {}), basedOnRev: S.catalog.meta?.rev ?? 0 } };

  // Keep it on the phone first. A catalog edit made in a basement must not be
  // lost, and it must not throw either: several screens call this and none of
  // them should fall over because there is no signal.
  try { await kvSet('catalog', S.catalog); } catch (e) {}

  let r, res;
  try {
    r = await fetch('/api/sync', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    res = await r.json().catch(() => ({}));
  } catch (e) {
    toast('Saved on this phone. It reaches the office when you have signal.', 'warn');
    return false;
  }
  if (r.status === 409) { toast(res.message || 'Somebody else saved first. Reload and try again.', 'bad'); return false; }
  if (!r.ok) { toast(res.error || 'That did not save.', 'bad'); return false; }
  S.catalog.meta = { ...(S.catalog.meta || {}), rev: res.rev, savedAt: res.savedAt };
  await kvSet('catalog', S.catalog);
  toast('Saved');
  return true;
}
AM.saveCatalog = saveCatalog;

/* ------------------------------------------------------------------- toast */

let toastTimer = null;
function toast(msg, kind) {
  const el = $('#toast');
  el.className = 'toast ' + (kind || 'ok');
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}
AM.toast = toast;

function buzz(ms = 30) { try { navigator.vibrate && navigator.vibrate(ms); } catch (e) {} }
AM.buzz = buzz;

/* A short click on a good scan. Gloves and ear defenders mean the eyes are the
   last thing to confirm anything, so the phone has to say it another way. */
let audioCtx = null;
function beep(ok = true) {
  try {
    audioCtx = audioCtx || new (window.AudioContext || window.webkitAudioContext)();
    const o = audioCtx.createOscillator(), g = audioCtx.createGain();
    o.frequency.value = ok ? 880 : 220;
    g.gain.value = 0.06;
    o.connect(g); g.connect(audioCtx.destination);
    o.start(); o.stop(audioCtx.currentTime + (ok ? 0.08 : 0.22));
  } catch (e) {}
}
AM.beep = beep;

/* -------------------------------------------------------------------- modal */

function modal(html, onOpen) {
  const el = $('#modal');
  el.innerHTML = `<div class="modal-back"></div><div class="modal-card">${html}</div>`;
  el.hidden = false;
  $('.modal-back', el).onclick = closeModal;
  if (onOpen) onOpen(el);
}
function closeModal() { const el = $('#modal'); el.hidden = true; el.innerHTML = ''; }
AM.modal = modal; AM.closeModal = closeModal;

/* ----------------------------------------------------------------- why ----
   The reasoning behind a screen is worth keeping and it is worth having. It
   is not worth making somebody read a hundred words of it before they can
   reach the first button. This folds it away behind one line. Anybody who
   wants to know why opens it; anybody who came here to do the work never has
   to scroll past it. */
function why(text, label) {
  return `<details class="why-fold">
    <summary>${esc(label || 'Why this screen exists')}</summary>
    <p>${esc(text)}</p>
  </details>`;
}
AM.why = why;

/* ----------------------------------------------------------- long lists ---
   Anything past a screenful is grouped and arrives shut, with the count on
   the heading so the shape of it can be read without opening anything.
   Below the threshold it just renders, because a fold in front of five rows
   is a lid on an empty box.

   `flag` is optional and returns a short word for a row worth counting on the
   heading, "not counted" or "no serial", which is usually the reason somebody
   opened the list at all. */
const FOLD_OVER = 15;

function groupFolds(rows, keyOf, rowOf, flag, forceOpen) {
  if (!rows.length) return '';
  if (rows.length <= FOLD_OVER || forceOpen) return rows.map(rowOf).join('');
  const groups = [];
  const byKey = new Map();
  for (const r of rows) {
    const k = keyOf(r) || 'Everything else';
    if (!byKey.has(k)) { byKey.set(k, []); groups.push(k); }
    byKey.get(k).push(r);
  }
  return groups.map(k => {
    const inG = byKey.get(k);
    const flagged = flag ? inG.map(flag).filter(Boolean) : [];
    const word = flagged.length ? flagged[0] : '';
    return `<details class="grp-fold">
      <summary><span class="grp">${esc(k)}</span>
        <span class="grp-tally">${inG.length}${flagged.length ? ' · <b class="warn-text">' + flagged.length + ' ' + esc(word) + '</b>' : ''}</span>
      </summary>
      ${inG.map(rowOf).join('')}
    </details>`;
  }).join('');
}
AM.groupFolds = groupFolds;

/* ------------------------------------------------------------------ scanner
   html5-qrcode is bundled with the app rather than loaded from the internet,
   because a phone in a basement cannot fetch a scanner library. Safari has no
   built-in barcode reader, so the decoding happens in JavaScript. It is not as
   quick as a native scanner, which is worth knowing before anyone promises the
   crew it will be instant. Test it on the oldest phone on site. */

let scanner = null;
async function openScanner(onCode, opts = {}) {
  const layer = $('#scanlayer');
  layer.hidden = false;
  layer.innerHTML = `
    <div class="scan-wrap">
      <div class="scan-head">
        <div class="scan-title">${esc(opts.title || 'Scan')}</div>
        <button class="scan-close" id="scanClose">Done</button>
      </div>
      <div id="reader" class="scan-reader"></div>
      <div class="scan-foot">
        <div class="scan-hint" id="scanHint">${esc(opts.hint || 'Point the camera at the code')}</div>
        ${opts.altLabel ? `<button class="btn-alt" id="scanAlt">${esc(opts.altLabel)}</button>` : ''}
      </div>
      <div class="scan-list" id="scanList"></div>
    </div>`;

  $('#scanClose').onclick = () => closeScanner(opts.onClose);
  if (opts.altLabel) $('#scanAlt').onclick = () => { closeScanner(); opts.onAlt && opts.onAlt(); };

  const Html5Qrcode = window.Html5Qrcode || (window.__Html5QrcodeLibrary__ && window.__Html5QrcodeLibrary__.Html5Qrcode);
  if (!Html5Qrcode) { toast('The scanner did not load. Use the list instead.', 'bad'); return; }

  scanner = new Html5Qrcode('reader', { verbose: false });
  const config = { fps: 12, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };

  let lastCode = '', lastAt = 0;
  const handle = text => {
    const t = Date.now();
    if (text === lastCode && t - lastAt < 1400) return;   // one code, one hit
    lastCode = text; lastAt = t;
    onCode(String(text).trim());
  };

  try {
    await scanner.start({ facingMode: 'environment' }, config, handle, () => {});
  } catch (e) {
    toast('The camera would not open. Check the permission, or use the list.', 'bad');
  }
}

async function closeScanner(after) {
  try { if (scanner) { await scanner.stop(); scanner.clear(); } } catch (e) {}
  scanner = null;
  const layer = $('#scanlayer');
  layer.hidden = true; layer.innerHTML = '';
  if (after) after();
}
AM.openScanner = openScanner; AM.closeScanner = closeScanner;

function scanFeed(html) {
  const el = $('#scanList');
  if (el) el.insertAdjacentHTML('afterbegin', html);
}
AM.scanFeed = scanFeed;

/* -------------------------------------------------------------------- codes
   A code carries the tag and nothing else. Short payloads keep the pattern
   coarse, and a coarse pattern is what survives glue, grit and a scratched
   overlaminate. Anything longer, a web address in particular, forces a denser
   code that a phone gives up on. */

function makeQR(text, cell = 4) {
  const q = window.qrcode(0, 'H');      // highest error correction: 30% of the
  q.addData(String(text));              // code can be destroyed and still read
  q.make();
  // Four modules of clear space all the way round. A code crowded to its own
  // edge fails now and then, which is worse than failing outright.
  return q.createSvgTag(cell, cell * 4);
}
AM.makeQR = makeQR;

/* A new version is ready. Reload only when the screen is not in the middle of
   something: no scanner open, no modal, nothing half-loaded onto a van. */
function reloadWhenSafe() {
  if (S.reloading) return;
  const busy = () => {
    const m = $('#modal');
    if (m && !m.hidden) return true;
    if (document.querySelector('.scan-wrap, #scanner')) return true;
    return false;
  };
  const go = () => {
    if (busy()) return;
    S.reloading = true;
    location.reload();
  };
  go();
  if (!S.reloading) {
    toast('A new version is ready. It will load as soon as you are not mid-scan.', 'warn');
    const t = setInterval(() => { go(); if (S.reloading) clearInterval(t); }, 4000);
  }
}
AM.reloadWhenSafe = reloadWhenSafe;

/* --------------------------------------------------------------------- shell */

/* Five buttons, never more. Thirteen tabs across the top is the fastest way to
   make somebody decide the app is not for them. The office screens are real but
   they are not the crew's job, so they sit behind one switch. */
const CREW_TABS = [
  ['#/', 'Shop'],
  ['#/out', 'Mobilize'],
  ['#/back', 'Tear down'],
  ['#/move', 'Transfer'],
  ['#/find', 'Find']
];
/* The tab bar is the work: what the shop does every day, in the order a job
   moves through it. Everything that is set once and then left alone lives
   behind Settings, off on its own on the right, because a bar where the daily
   work and the plumbing sit side by side reads as eight equal things to do. */
const OFFICE_TABS = [
  ['#/dash', 'Today'],
  ['#/jobs', 'Jobs'],
  ['#/shelf', 'Shelf'],
  ['#/gear', 'Equipment'],
  ['#/order', 'Order'],
  ['#/dop', 'Certificates']
];

// Reachable, and part of the office, but never on the bar.
const SETTINGS_ROUTES = ['#/setup', '#/labels', '#/link', '#/add', '#/sheet'];

const OFFICE_ROUTES = new Set([...OFFICE_TABS.map(t => t[0]), ...SETTINGS_ROUTES]);
AM.isOffice = r => OFFICE_ROUTES.has(r);
AM.isSettings = r => SETTINGS_ROUTES.includes(r);

function renderTabs() {
  const office = AM.isOffice(S.route);
  const tabs = office ? OFFICE_TABS : CREW_TABS;
  /* "Back to the shop" is 135 pixels of a 375 pixel phone, and every one of
     them is a pixel of tab nobody can read. It says the short thing on a phone
     and the whole thing where there is room. */
  const narrow = window.matchMedia('(max-width: 700px)').matches;
  const swap = office
    ? `<button class="tab-swap" data-h="#/">${narrow ? 'The shop' : 'Back to the shop'}</button>`
    : `<button class="tab-swap" data-h="#/dash" data-tour="office">Office</button>`;
  /* Settings sits in the same place on both sides, always.
     It used to appear only on the office side, on the theory that the crew have
     no business in it. Nothing in there is protected, so hiding it protected
     nothing, and what it actually did was send anybody standing on the shop
     screen looking for Settings round in circles. A control that exists on some
     screens and not others reads as broken, not as tidy. */
  const settings =
    `<button class="tab-set" data-h="#/setup" ${AM.isSettings(S.route) ? 'aria-current="true"' : ''}>Settings</button>`;
  /* On a phone these used to wrap onto four lines and eat a third of the
     screen before any of the work showed. The tabs now scroll sideways in one
     line, and Settings and the door to the other side are pinned outside the
     scroller, so the two controls people hunt for are always where they were
     left. */
  $('#tabs').innerHTML =
    `<div class="tab-scroll">` +
      tabs.map(([h, label]) =>
        `<button data-h="${h}" ${S.route === h ? 'aria-current="true"' : ''}>${esc(label)}</button>`
      ).join('') +
    `</div><div class="tab-fixed">` + settings + swap + `</div>`;
  $$('#tabs button').forEach(b => b.onclick = () => go(b.dataset.h));
  // Keep the tab you are on in view when the bar is scrolled.
  const cur = $('#tabs .tab-scroll button[aria-current="true"]');
  if (cur && cur.scrollIntoView) cur.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderStatus() {
  const pending = S.outbox.length;
  const bits = [];
  bits.push(`<button class="who" id="whoBtn" data-tour="who">${esc(S.me || 'Who are you?')}</button>`);
  if (pending) bits.push(`<span class="pill warn" title="Waiting to reach the office">${pending} waiting</span>`);
  bits.push(S.online
    ? `<span class="pill ${S.syncing ? 'busy' : 'good'}">${S.syncing ? 'Syncing' : 'Online'}</span>`
    : `<span class="pill off">No signal, still working</span>`);
  $('#statusbar').innerHTML = bits.join('');
  const w = $('#whoBtn'); if (w) w.onclick = () => (anyPins() ? whoModal() : pickMe());
}

// A screen is named by the part before the question mark. Anything after it is
// a detail for that screen, such as which job is being torn down.
const routeOf = h => String(h || '#/').split('?')[0] || '#/';

function go(hash) {
  if (location.hash === hash) { S.route = routeOf(hash); render(); }
  else location.hash = hash;
}
AM.go = go;
AM.routeOf = routeOf;

/* ------------------------------------------------------------ wide tables ---
   The office tables have up to nine columns. On a desk that is fine. On a phone
   a nine column table either crushes every column into a sliver or shoves the
   whole page sideways, and the second one is what was happening.

   Rather than remembering a wrapper at fifteen call sites, and forgetting it on
   the sixteenth, every table gets one here after the screen is drawn. The table
   scrolls sideways inside its own box and the page does not move. Done once, in
   one place, so a table added later is handled without anybody thinking about
   it. */
function wrapTables(view) {
  for (const t of $$('table.tbl', view)) {
    if (t.parentElement && t.parentElement.classList.contains('tbl-scroll')) continue;
    const box = document.createElement('div');
    box.className = 'tbl-scroll';
    t.parentNode.insertBefore(box, t);
    box.appendChild(t);
  }
}
AM.wrapTables = wrapTables;

function render() {
  if (!S.catalog) return;
  if (S.locked) { renderLock(); return; }
  document.body.classList.remove('locked');
  renderTabs();
  renderStatus();
  const view = $('#view');
  const r = S.route || '#/';
  const fn = AM.screens[r] || AM.screens['#/'];
  try {
    view.innerHTML = fn();
    wrapTables(view);
    const after = AM.after[r];
    if (after) after();
  } catch (e) {
    view.innerHTML = `<div class="panel"><h2>Something went wrong on this screen</h2><p class="muted">${esc(e.message)}</p></div>`;
    console.error(e);
  }
  $('#foot').innerHTML = `<span>A&amp;M Abatement Services</span><span class="sep">·</span>` +
    `<span>${S.catalog.units.length} machines, ${S.catalog.stock.length} shelf items</span>` +
    (S.lastSync ? `<span class="sep">·</span><span>last talked to the office ${esc(fmtWhen(S.lastSync))}</span>` : '') +
    (S.installed ? '' : `<span class="sep">·</span><span class="warn-text">Add this to your home screen. In a browser tab the phone throws away anything waiting after a week.</span>`);
}
AM.render = render;
AM.screens = {};
AM.after = {};

/* ---------------------------------------------------------------- sign in ---
   A name picked off a list is only as good as everybody's honesty at six in the
   morning. So: four digits, because gloves. The phone's own fingerprint or face
   after the first time, because four digits twenty times a day gets shared over
   a tailgate. And all of it works with no signal, because most of this work
   happens in a basement, which is why an emailed code was never an option.

   Until the office issues the first PIN the app behaves exactly as it did, so
   nobody is locked out of their own shop on the morning this lands. */

const LOCK_MIN_DEFAULT = 60;

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');

async function sha256(text) {
  const out = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return hex(out);
}
function newSalt() { return hex(crypto.getRandomValues(new Uint8Array(8))); }
async function pinHash(pin, salt) { return sha256(salt + ':' + String(pin)); }
AM.pinHash = pinHash;
AM.newSalt = newSalt;

const activeUsers = () => (S.catalog.users || []).filter(u => u.active !== false);
const anyPins = () => (S.catalog.users || []).some(u => u.pin && u.pin.hash);
AM.anyPins = anyPins;
const lockMinutes = () => (S.catalog.settings && S.catalog.settings.lockMinutes) || LOCK_MIN_DEFAULT;

async function signIn(u) {
  S.me = u.name;
  S.meId = u.id || null;
  await kvSet('session', { name: u.name, id: u.id || null, at: nowISO(), lastSeen: nowISO() });
  await kvSet('me', u.name);
  S.locked = false;
}

/* The phone stays awake as long as somebody is using it, and locks itself when
   it has been face down on a bench for an hour. A van door is not a desk. */
let _touchAt = 0;
async function touchSession() {
  const now = Date.now();
  if (now - _touchAt < 20000) return;
  _touchAt = now;
  const s = await kvGet('session');
  if (!s) return;
  s.lastSeen = nowISO();
  await kvSet('session', s);
}
AM.touchSession = touchSession;

async function checkLock() {
  if (!anyPins()) { S.locked = false; return; }
  const s = await kvGet('session');
  if (!s) { S.locked = true; return; }
  /* Access taken away in the office has to reach the phone in somebody's
     pocket. It does, the next time that phone syncs the list. */
  const still = activeUsers().find(u => (s.id && u.id === s.id) || u.name === s.name);
  if (!still) { S.locked = true; return; }
  S.me = still.name; S.meId = still.id || null;
  const idle = (Date.now() - new Date(s.lastSeen || s.at).getTime()) / 60000;
  S.locked = idle > lockMinutes();
}
AM.checkLock = checkLock;

async function signOut(forget) {
  await kvSet('session', null);
  if (forget) await kvSet('bio', null);
  S.locked = true;
  render();
}
AM.signOut = signOut;

/* The fingerprint or face the phone already trusts, used as an unlock gesture
   and nothing else. Nothing leaves the phone, so it works underground. */
async function bioAvailable() {
  try {
    return !!(window.PublicKeyCredential &&
      await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable());
  } catch (e) { return false; }
}
AM.bioAvailable = bioAvailable;

async function bioEnrol(u) {
  if (!(await bioAvailable())) return false;
  try {
    const cred = await navigator.credentials.create({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        rp: { name: 'A&M Inventory' },
        user: { id: crypto.getRandomValues(new Uint8Array(16)), name: u.name, displayName: u.name },
        pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
        authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' },
        timeout: 60000, attestation: 'none'
      }
    });
    if (!cred) return false;
    await kvSet('bio', { userId: u.id || null, name: u.name, credId: hex(cred.rawId), pinSetAt: u.pinSetAt || '' });
    return true;
  } catch (e) { return false; }
}
AM.bioEnrol = bioEnrol;

async function bioUnlock() {
  const b = await kvGet('bio');
  if (!b || !b.credId) return null;
  try {
    const id = new Uint8Array(b.credId.match(/../g).map(h => parseInt(h, 16)));
    const got = await navigator.credentials.get({
      publicKey: {
        challenge: crypto.getRandomValues(new Uint8Array(32)),
        allowCredentials: [{ type: 'public-key', id }],
        userVerification: 'required', timeout: 60000
      }
    });
    return got ? b : null;
  } catch (e) { return null; }
}

/* Wrong four digits happens with cold hands. Five wrong in a row is somebody
   guessing, and that waits a minute. The wait is written to the phone so
   closing the app does not clear it. */
async function failState() { return (await kvGet('pinFail')) || { n: 0, until: 0 }; }

async function renderLock() {
  document.body.classList.add('locked');
  const tabs = $('#tabs'); if (tabs) tabs.innerHTML = '';
  const sb = $('#statusbar');
  if (sb) sb.innerHTML = `<span class="pill ${S.online ? 'good' : 'off'}">${S.online ? 'Online' : 'No signal, still working'}</span>` +
    (S.outbox.length ? `<span class="pill warn">${S.outbox.length} waiting</span>` : '');

  const view = $('#view');
  const bio = await kvGet('bio');
  const hasBio = !!(bio && bio.credId) && await bioAvailable();
  let picked = null;

  const drawPick = () => {
    view.innerHTML = `
      <div class="lock">
        <div class="lock-card">
          <h2>Sign in</h2>
          <p class="muted">Every movement carries your name, so the shop can put a mistake right instead of arguing about it. Four digits, and this phone remembers you until it has sat idle for an hour.</p>
          ${hasBio ? `<button class="btn big" id="bioGo">Unlock as ${esc(bio.name)}</button>
            <button class="btn-ghost" id="bioAlt">Somebody else, or use a PIN</button>` : ''}
          <div class="who-list ${hasBio ? 'tucked' : ''}" id="whoList">
            ${activeUsers().map(u => `<button class="who-pick" data-n="${esc(u.name)}">${esc(u.name)}</button>`).join('')
              || '<p class="muted">Nobody has been added yet. The office adds people on the settings screen.</p>'}
          </div>
        </div>
      </div>`;

    const bg = $('#bioGo');
    if (bg) bg.onclick = async () => {
      bg.disabled = true; bg.textContent = 'Waiting for the phone…';
      const ok = await bioUnlock();
      bg.disabled = false; bg.textContent = `Unlock as ${bio.name}`;
      if (!ok) { toast('That did not match. Use your PIN.', 'warn'); return; }
      const u = activeUsers().find(x => (bio.userId && x.id === bio.userId) || x.name === bio.name);
      if (!u) { toast('That person is no longer on the list. Use a PIN.', 'bad'); return; }
      if ((u.pinSetAt || '') > (bio.pinSetAt || '')) {
        await kvSet('bio', null);
        toast('Your PIN was reset in the office. Sign in with the new one.', 'warn');
        drawPick(); return;
      }
      await signIn(u); afterUnlock();
    };
    const ba = $('#bioAlt');
    if (ba) ba.onclick = () => { $('#whoList').classList.remove('tucked'); };

    $$('.who-pick').forEach(b => b.onclick = () => {
      picked = activeUsers().find(u => u.name === b.dataset.n);
      if (!picked) return;
      if (!(picked.pin && picked.pin.hash)) {
        toast('The office has not issued you a PIN yet.', 'warn');
        return;
      }
      drawPin();
    });
  };

  const drawPin = () => {
    let entry = '';
    view.innerHTML = `
      <div class="lock">
        <div class="lock-card">
          <h2>${esc(picked.name)}</h2>
          <p class="muted" id="pinMsg">Your four digits.</p>
          <div class="pin-dots" id="pinDots">${'<span></span>'.repeat(4)}</div>
          <div class="pin-pad">
            ${[1,2,3,4,5,6,7,8,9].map(n => `<button class="pin-k" data-k="${n}">${n}</button>`).join('')}
            <button class="pin-k ghost" id="pinBack">Back</button>
            <button class="pin-k" data-k="0">0</button>
            <button class="pin-k ghost" id="pinClr">Clear</button>
          </div>
        </div>
      </div>`;

    const dots = () => {
      $$('#pinDots span').forEach((s, i) => s.classList.toggle('on', i < entry.length));
    };
    const msg = (t, cls) => { const m = $('#pinMsg'); m.textContent = t; m.className = 'muted ' + (cls || ''); };

    const submit = async () => {
      const f = await failState();
      if (f.until && Date.now() < f.until) {
        msg('Too many wrong. Wait a minute.', 'bad'); entry = ''; dots(); return;
      }
      const h = await pinHash(entry, picked.pin.salt);
      if (h !== picked.pin.hash) {
        const n = (f.n || 0) + 1;
        await kvSet('pinFail', { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        entry = ''; dots();
        msg(n >= 5 ? 'Too many wrong. Wait a minute.' : 'That is not it. Try again.', 'bad');
        beep(false);
        return;
      }
      await kvSet('pinFail', { n: 0, until: 0 });
      await signIn(picked);
      beep(true);
      /* Offered once, on this phone, right after the first PIN goes in. Nobody
         wants to be asked this every morning. */
      const b = await kvGet('bio');
      if (!b && await bioAvailable()) {
        modal(`
          <h3>Use your fingerprint next time?</h3>
          <p class="muted small">This phone unlocks the app with the fingerprint or face it already trusts, so you do not type four digits twenty times a day. Nothing about you leaves the phone.</p>
          <div class="row"><button class="btn big" id="bioYes">Set it up</button>
          <button class="btn-ghost" id="bioNo">Not now</button></div>
        `, el => {
          $('#bioYes', el).onclick = async () => {
            const ok = await bioEnrol(picked);
            closeModal();
            toast(ok ? 'Set. Your fingerprint opens it from now on.' : 'The phone would not set that up. Your PIN still works.', ok ? 'ok' : 'warn');
            afterUnlock();
          };
          $('#bioNo', el).onclick = () => { closeModal(); afterUnlock(); };
        });
        return;
      }
      afterUnlock();
    };

    $$('.pin-k[data-k]').forEach(b => b.onclick = () => {
      if (entry.length >= 4) return;
      entry += b.dataset.k;
      dots();
      if (entry.length === 4) setTimeout(submit, 80);
    });
    $('#pinBack').onclick = () => { entry = entry.slice(0, -1); dots(); };
    $('#pinClr').onclick = () => { picked = null; drawPick(); };
  };

  const afterUnlock = () => {
    document.body.classList.remove('locked');
    render();
    if (window.TOUR) TOUR.ready();
  };

  drawPick();
}

/* Tapping your own name. Lock it if you are putting the phone down for a
   minute, sign out if somebody else is taking it for the day. */
function whoModal() {
  modal(`
    <h3>Signed in as ${esc(S.me || 'nobody')}</h3>
    <p class="muted small">Everything you do carries your name until you sign out. It locks itself after an hour idle either way.</p>
    <div class="row"><button class="btn" id="soLock">Lock it</button>
    <button class="btn-ghost" id="soOut">Sign out, somebody else is taking this phone</button></div>
  `, el => {
    $('#soLock', el).onclick = async () => { closeModal(); await kvSet('session', null); S.locked = true; render(); };
    $('#soOut', el).onclick = async () => { closeModal(); await signOut(true); };
  });
}
AM.whoModal = whoModal;

/* Who is holding the phone, before the office has issued anybody a PIN. Once
   PINs exist this is never reached: signing in is the only way in. */
function pickMe() {
  const users = (S.catalog.users || []).filter(u => u.active !== false);
  modal(`
    <h3>Who is on this phone?</h3>
    <div class="who-list">
      ${users.map(u => `<button class="who-pick" data-n="${esc(u.name)}">${esc(u.name)}</button>`).join('')}
    </div>
    <div class="who-add">
      <input id="whoNew" placeholder="Or type a name" autocomplete="off">
      <button class="btn" id="whoAdd">Add</button>
    </div>
    <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
  `, el => {
    $$('.who-pick', el).forEach(b => b.onclick = async () => {
      S.me = b.dataset.n; await kvSet('me', S.me); closeModal(); render();
      if (window.TOUR) TOUR.ready();   // first run: the tour waits for a name
    });
    $('#whoAdd', el).onclick = async () => {
      const n = $('#whoNew', el).value.trim();
      if (!n) return;
      S.catalog.users = S.catalog.users || [];
      if (!S.catalog.users.some(u => u.name === n)) S.catalog.users.push({ name: n, active: true });
      S.me = n; await kvSet('me', S.me); await saveCatalog(); closeModal(); render();
    };
  });
}
AM.pickMe = pickMe;

/* --------------------------------------------------------------------- boot */

AM.boot = async function boot() {
  // Ask the phone to keep our data rather than clearing it to free space.
  try {
    if (navigator.storage && navigator.storage.persist) {
      S.storagePersisted = await navigator.storage.persist();
    }
  } catch (e) {}

  try {
    S.catalog = (await kvGet('catalog')) || null;
    S.me = (await kvGet('me')) || null;
    S.lastEventAt = (await kvGet('lastEventAt')) || '';
    S.lastSync = (await kvGet('lastSync')) || null;
    S.events = (await allOf('events')) || [];
    S.outbox = (await allOf('outbox')) || [];
    S.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  } catch (e) { console.error(e); }

  // First run: take the master list off the server, or off the file that ships
  // with the app if there is no signal at all.
  let serverHadCatalog = false;
  if (!S.catalog) {
    try {
      const r = await fetch('/api/sync?since=');
      const res = await r.json();
      if (res.catalog) { S.catalog = res.catalog; serverHadCatalog = true; }
    } catch (e) {}
  }
  if (!S.catalog) {
    try { S.catalog = await (await fetch('seed.json')).json(); } catch (e) {}
  }
  // Last resort, and the one that works when the app is opened straight off the
  // disk with nothing serving it.
  if (!S.catalog && window.AM_SEED) {
    S.catalog = JSON.parse(JSON.stringify(window.AM_SEED));
  }

  // Very first run for the whole company: nobody has put the master list on the
  // server yet, so the copy that shipped with the app becomes it.
  if (S.catalog && !serverHadCatalog && navigator.onLine) {
    try {
      const r = await fetch('/api/sync?since=&catalog=1');
      const res = await r.json();
      if (!res.catalog) await saveCatalog();
    } catch (e) {}
  }
  if (!S.catalog) {
    $('#view').innerHTML = `<div class="panel"><h2>Nothing to open yet</h2>
      <p>This phone has never had a signal and the master list is not on it. Get one bar, then open the app again.</p></div>`;
    return;
  }

  S.route = routeOf(location.hash);
  window.addEventListener('hashchange', () => { S.route = routeOf(location.hash); render(); window.scrollTo(0, 0); });
  window.addEventListener('online', () => { S.online = true; sync(); });
  window.addEventListener('offline', () => { S.online = false; render(); });
  window.addEventListener('resize', () => renderTabs());

  // On iPhone the queue cannot drain in the background, so it drains here:
  // every time the app comes back to the front.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) sync(); });
  setInterval(() => { if (!document.hidden && navigator.onLine) sync(); }, 60000);

  derive();
  await checkLock();
  render();
  if (!S.locked && !S.me) pickMe();

  /* Locks itself after an hour face down on a bench, and every time the app
     comes back to the front after that long away. */
  ['click', 'keydown', 'touchstart'].forEach(ev =>
    document.addEventListener(ev, () => { if (!S.locked) touchSession(); }, { passive: true }));
  setInterval(async () => {
    if (S.locked) return;
    const was = S.locked;
    await checkLock();
    if (S.locked !== was) render();
  }, 60000);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden || S.locked) return;
    await checkLock();
    if (S.locked) render();
  });

  /* A deploy landing while somebody is holding the phone. The new version is
     never mixed into the running one: the app reloads itself whole, and it
     waits for a moment when nobody is mid-scan to do it, because yanking the
     screen out from under a man at a van door is worse than being a version
     behind for ninety seconds. */
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', ev => {
      if (ev.data && ev.data.type === 'version' && ev.data.version !== S.version) {
        if (!S.version) { S.version = ev.data.version; return; }   // first answer, nothing to do
        S.newVersion = ev.data.version;
        reloadWhenSafe();
      }
    });
    if (navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage({ type: 'version?' });
    }
  }

  sync();
  checkConnections().then(render);

  /* The walkthrough decides which chapters are live by asking the screen what
     exists right now, so it must not start until everything it depends on has
     resolved. Never a timer: long enough here is too short on a cold
     connection, and the failure is silent, whole chapters simply missing. */
  if (window.TOUR && !S.locked) TOUR.ready();
};
