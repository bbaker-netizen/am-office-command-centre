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
/* THE DAY IT IS HERE, NOT THE DAY IT IS IN GREENWICH
   This was toISOString().slice(0,10), which is the UTC date. Edmonton is six or
   seven hours behind UTC, so from six in the evening onwards that returned
   tomorrow's date. Every screen that says "today" or "tomorrow" was an evening
   away from being wrong, and the mobilization dates it compares against come
   off an <input type="date">, which is always local. So the day is worked out
   locally, the same way the date box wrote it. */
const dayISO = d => {
  const t = d ? new Date(d) : new Date();
  return t.getFullYear() + '-' + String(t.getMonth() + 1).padStart(2, '0') + '-' + String(t.getDate()).padStart(2, '0');
};
/* Whole days between two moments, counted in calendar days here rather than in
   24-hour blocks, because "two days" on a schedule means two dates. It takes a
   plain 2026-09-08, a full timestamp or a Date, and it reads each of them as the
   day it was locally: a timestamp written at nine in the evening Edmonton time
   carries tomorrow's UTC date, and counting that as a day out by itself is how
   a job booked for Tuesday reads as Monday. */
const localDay = x => {
  if (x instanceof Date) return isNaN(x) ? null : new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const str = String(x == null ? '' : x);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str.trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);   // a date box wrote this, it is already local
  const t = new Date(str);
  return isNaN(t) ? null : new Date(t.getFullYear(), t.getMonth(), t.getDate());
};
const daysBetween = (a, b) => {
  const da = localDay(a), db = localDay(b);
  if (!da || !db) return 0;
  return Math.round((db - da) / 86400000);
};

/* A date on a job, said the way somebody reads it off a screen: the weekday
   first, because that is what anybody planning a week actually thinks in. The
   locale's comma after the weekday comes out, because these sit inside phrases
   that already have one — "next out tomorrow, Tuesday, Sep 8" reads like a
   stutter, and "tomorrow, Tuesday Sep 8" reads like a person saying it. */
const dayName = (iso, weekday) => {
  if (!iso) return '';
  const t = new Date(String(iso) + 'T00:00:00');
  if (isNaN(t)) return String(iso);
  return t.toLocaleDateString('en-CA', { weekday, month: 'short', day: 'numeric' }).replace(/,/g, '');
};
const dayWords = iso => dayName(iso, 'long');
const dayShort = iso => dayName(iso, 'short');

/* ------------------------------------------------------------ what a one is
   The master list is written in purchasing's shorthand: EA, PR, BX, CS, RL,
   PL, PKG, BALE, GL. That is fine on an invoice and useless at a van door at
   six in the morning. "COVERALLS MICROPOROUS LARGE 25/CS" with a 1 next to it
   reads as one coverall to everybody who has never bought them, and it is
   actually a case of twenty five.

   So every quantity in this app says what a one IS. Not "1 CS" but "1 case
   (25 suits)". The pack size is read off the item's own name, because that is
   where the supplier already put it, so nobody has to retype 208 of them. */

const UOM_WORDS = {
  EA: ['each', 'each'], PR: ['pair', 'pairs'], BX: ['box', 'boxes'],
  CS: ['case', 'cases'], RL: ['roll', 'rolls'], PL: ['pail', 'pails'],
  BALE: ['bale', 'bales'], PKG: ['pack', 'packs'], PK: ['pack', 'packs'],
  GL: ['jug', 'jugs'], CT: ['carton', 'cartons'], BG: ['bag', 'bags']
};

/* WHAT KIND OF THING IS THIS, WHICH IS THE QUESTION THAT SHOULD HAVE BEEN
   ASKED FIRST

   The first pass at this asked "how many are in one?" of everything on the
   shelf that came in a container, and lit up thirty nine lines as needing an
   answer. Thirty seven of them had no answer, because the question was wrong: a
   roll of poly does not contain a number of poly, and a jug of Benefect does not
   contain a number of Benefect. You use a length of one and a slug of the other,
   and half of either is an ordinary thing to bring back. Only two lines on the
   entire shelf, Suits/box and Chem suits/box, are boxes of countable objects
   with no count recorded.

   So the app works out what a thing IS before it decides what can be asked
   about it:

     length     poly, tape, tubing, floor protection - used by the metre, comes
                back as part of a roll, and there is nothing to count
     liquid     jugs, pails, gallons - same, by volume
     countable  a box or case of discrete objects: suits, blades, wipes. This is
                the only kind where a piece count means anything
     single     an each or a pair. One is one
     equipment  a machine that got typed into the shelf list with a liquid unit,
                like a 2 gallon pump sprayer, which is a sprayer and not two
                gallons of anything

   Everything downstream reads from this: what the buttons do, what the return
   screen offers, what words it uses, and what the office is asked to fill in.
   Nobody is asked how many poly are in a poly ever again. */

const LIQUID_RE = /\b\d+(\.\d+)?\s*(gal|gallon|gallons|l|litre|liter|litres|liters|ml)\b|\bjug\b|\bpail\b|\bdrum\b/i;
/* No bare "m" for metres. "3M PAPR filter/box" is a brand and a box of filters,
   and reading the 3M as three metres turned a countable box into sheet goods. */
const LENGTH_RE = /\broll\b|\b\d+\s*(ft|feet|foot|metre|meter)\b|\btape\b|\bpoly\b|tubing|lay ?flat|banner|ram board|carpet cover|floor protection|\bfelt\b/i;
const EQUIP_RE = /sprayer|surespray|\bvacuum\b(?!\s*bag)|\bmachine\b|blower|scrubber/i;

function kindOf(item) {
  if (!item) return 'single';
  const n = String(item.name || '');
  const u = String(item.uom || '').toUpperCase();
  // A machine that landed on the shelf list with a liquid unit on it.
  if (EQUIP_RE.test(n) && !/bag|filter|belt|hose/i.test(n)) return 'equipment';
  /* The unit it is actually bought by beats any word in the name, because a box
     of duct tape is a box of rolls and not a length of anything. Reading the
     word "tape" first turned a countable box of twenty four into sheet goods.
     A roll of tape is bought by the roll and says so in its unit. */
  if (['BX', 'CS', 'PKG', 'PK', 'BALE', 'CT', 'BG'].includes(u)) return 'countable';
  if (u === 'RL') return 'length';
  if (u === 'GL' || u === 'PL') return 'liquid';
  /* A name that says "1 GAL 3.78L" is better evidence than the class field,
     which is mis-set on this list: BIO-C odour controller, a gallon of liquid,
     is filed as a roll. Trusting the field over the words put a jug of chemical
     on the shelf as sheet goods. */
  if (LIQUID_RE.test(n)) return 'liquid';
  if (item.cls === 'roll') return 'length';
  if (LENGTH_RE.test(n)) return 'length';
  return 'single';
}
AM.kindOf = kindOf;

// Opened, part used, part back. True of everything except a single item and a
// machine. This is what decides whether a part quantity is allowed at all.
const isContainer = item => {
  const k = kindOf(item);
  return k === 'length' || k === 'liquid' || k === 'countable';
};
AM.isContainer = isContainer;

// What one of it is called when it is opened: "part of a roll", "part of a jug".
const PART_WORD = { length: 'roll', liquid: 'jug', countable: 'box' };
AM.partWord = item => {
  const w = UOM_WORDS[String((item && item.uom) || '').toUpperCase()];
  return w ? w[0] : (PART_WORD[kindOf(item)] || 'one');
};

/* How the suppliers actually write a pack size, which is every way except one
   consistent way: "25/CS", "BOX OF 10", "Duct Tape/24box", "(50)", "100/BOX",
   "50/DISP". Each is tried in turn and the first real number wins. */
const PACK_PATTERNS = [
  /(?:^|[\s(\/])(\d{1,5})\s*[\/ ]\s*(CS|CASE|BX|BOX|PK|PKG|PACK|RL|ROLL|BALE|PR|PAIR|DISP|DISPENSER|CT|CARTON)\b/ig,
  /\b(?:BOX|CASE|PACK|PKG|BALE|CARTON|DISPENSER)\s*(?:OF|\/)\s*(\d{1,5})\b/ig,
  /[\/ ]\s*(\d{1,5})\s*(?:BOX|BX|CASE|CS|PACK|PK|PKG|ROLL|RL)\b/ig,
  /\((\d{1,5})\)/g
];
// Which written token means the same thing as the unit the item is bought by.
const UOM_ALIAS = {
  CS: ['CS', 'CASE'], BX: ['BX', 'BOX'], PK: ['PK', 'PKG', 'PACK'],
  PKG: ['PKG', 'PK', 'PACK'], RL: ['RL', 'ROLL'], BALE: ['BALE'], PR: ['PR', 'PAIR']
};

function uomWord(uom, n) {
  const w = UOM_WORDS[String(uom || '').toUpperCase()];
  if (!w) return String(uom || '').toLowerCase();
  return Math.abs(n) === 1 ? w[0] : w[1];
}
AM.uomWord = uomWord;

/* How many pieces are in one of whatever this is bought by, when the name says
   so. Null when it does not, and null is fine: most things are simply each. */
function packOf(item) {
  if (!item) return null;
  /* Only a box of discrete objects has a number inside it. A roll of poly
     measuring 780FT and a jug measuring 3.78L are both a quantity, but neither
     is a count of anything, and reading one as a pack size is how "780 poly"
     would end up on a screen. */
  if (kindOf(item) !== 'countable') return null;
  /* Whatever the office confirmed beats whatever the supplier wrote in the name.
     Reading it off the name covers most of the list for free; this is how the
     rest gets settled permanently, once, by somebody who has the box in hand. */
  if (item.packSize > 1) {
    return { size: Number(item.packSize), piece: item.packPiece || piecesWord(item), source: 'stated' };
  }
  if (!item.name) return null;
  const hits = [];
  for (const re of PACK_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(item.name))) {
      const size = parseInt(m[1], 10);
      if (isFinite(size) && size >= 2 && size <= 100000) {
        hits.push({ size, token: (m[2] || '').toUpperCase() });
      }
    }
    if (hits.length) break;   // first pattern that finds anything wins
  }
  if (!hits.length) return null;
  /* A name can carry two pack sizes: "BAR TOWEL 12/PKG (600/BALE)" is twelve to
     a pack and six hundred to a bale, and it is bought by the bale. Take the one
     that matches how it is actually bought; otherwise take the first. */
  const want = UOM_ALIAS[String(item.uom || '').toUpperCase()] || [];
  const hit = hits.find(h => want.includes(h.token)) || hits[0];
  return { size: hit.size, piece: piecesWord(item), source: 'name' };
}
AM.packOf = packOf;

/* WORKING OUT A PACK SIZE NOBODY WROTE DOWN
   A box of discrete things with no count on it is the one case left where the
   app genuinely does not know something it needs. Rather than putting the
   question to a person, it does the arithmetic first: A&M buy "Chem suits" at
   $13.60 each and "Chem suits/box" at $272.00, and 272 divided by 13.60 is
   exactly 20. That is not a guess, it is their own invoice history answering the
   question.

   It is offered rather than applied. A ratio that lands on 20.00 is worth
   trusting; one that lands on 12.5 because it matched red tape against blue is
   not, and a wrong pack size does not announce itself, it just quietly makes
   every count on that line wrong. So the app does the thinking and a person does
   one tap, which is the honest division of labour between the two. */
function suggestPack(item, catalog) {
  if (!item || kindOf(item) !== 'countable' || packOf(item)) return null;
  if (!(item.price > 0)) return null;
  const best = nearestSingle(item, catalog);
  /* The bar is deliberately high. A loose name match against a different
     product, or a ratio that does not land near a whole number, means the answer
     is a coincidence rather than a pack size. */
  if (!best) return null;
  const ratio = item.price / best.price;
  const size = Math.round(ratio);
  if (!(size >= 2 && size <= 2000)) return null;
  if (Math.abs(ratio - size) / size > 0.04) return null;

  return {
    size, piece: piecesWord(item), source: 'suggested',
    why: `${money(item.price)} a ${uomWord(item.uom, 1)} against ${money(best.price)} for "${best.name}" works out at ${size}.`
  };
}
AM.suggestPack = suggestPack;
/* WHEN THE UNIT ITSELF IS WRONG, SAY SO RATHER THAN ASKING FOR A PACK SIZE
   Four lines on the shelf are boxes and cases with no count recorded, and the
   temptation is to ask a person for the number. For two of them that is the
   wrong question, and their own prices say why:

     BENEFECT BOTANICAL DISINFECTANT 1 GAL   a "case"  at $32.46
     Benefect Disinfectant - gal             a jug     at $29.00

   A case that costs one and a tenth of a single jug is not a case. The unit on
   that line is wrong, and asking how many jugs are in it invites somebody to
   type 4 and make the count wrong four times over.

   So the app compares a container against the nearest thing it sells singly.
   Priced like a single means it probably IS a single and the unit needs
   correcting; priced like a clean multiple means the multiple is the pack size,
   which is what suggestPack offers. Anything in between it leaves alone rather
   than inventing an answer. */
function unitLooksWrong(item, catalog) {
  if (!item || !(item.price > 0)) return null;
  if (kindOf(item) !== 'countable' || packOf(item)) return null;
  const twin = nearestSingle(item, catalog);
  if (!twin) return null;
  const ratio = item.price / twin.price;
  if (ratio > 1.35) return null;         // a genuine multiple, not a mislabel
  if (ratio < 0.5) return null;          // cheaper than a single: something else again
  return {
    twin,
    why: `Priced at ${money(item.price)} a ${uomWord(item.uom, 1)} while "${twin.name}" is ${money(twin.price)} for one. A ${uomWord(item.uom, 1)} that costs about the same as one is probably a single, so the unit on this line looks wrong rather than the count being missing.`
  };
}
AM.unitLooksWrong = unitLooksWrong;

/* The closest thing on the shelf that is sold one at a time. Shared by the pack
   suggestion and the unit check, because both are asking the same question:
   what does one of these cost on its own? */
function nearestSingle(item, catalog) {
  const stock = (catalog && catalog.stock) || [];
  const strip = s => String(s).toLowerCase().replace(/[^a-z0-9 ]/g, ' ')
    .replace(/\b(box|bx|case|cs|pack|pk|pkg|per|ea|each|of|the)\b/g, ' ')
    .replace(/\s+/g, ' ').trim();
  const wordsOf = s => new Set(strip(s).split(' ').filter(Boolean));
  const mine = wordsOf(item.name);
  if (!mine.size) return null;
  let best = null, score = 0;
  for (const s of stock) {
    if (s === item || !(s.price > 0)) continue;
    // Sold one at a time: an each, a pair, or a single jug.
    if (!['EA', 'PR', 'GL'].includes(String(s.uom || '').toUpperCase())) continue;
    if (packOf(s)) continue;                     // itself a pack, so not a single
    const theirs = wordsOf(s.name);
    let inter = 0;
    mine.forEach(w => { if (theirs.has(w)) inter++; });
    if (!inter) continue;
    const sc = inter / new Set([...mine, ...theirs]).size;
    if (sc > score) { score = sc; best = s; }
  }
  return score >= 0.6 ? best : null;
}

/* What the pieces inside are called. Read off the item's own name so it says
   "suits" and "wipes" rather than a generic "pieces". */
function piecesWord(item) {
  const n = String((item && item.name) || '').toLowerCase();
  if (/coverall|suit/.test(n)) return 'suits';
  if (/glove/.test(n)) return 'pairs';
  if (/wipe/.test(n)) return 'wipes';
  if (/bag/.test(n)) return 'bags';
  if (/blade/.test(n)) return 'blades';
  if (/filter/.test(n)) return 'filters';
  if (/cloth|towel/.test(n)) return 'cloths';
  if (/label/.test(n)) return 'labels';
  return 'pieces';
}

/* The words that go next to a number. `n` decides singular or plural. */
function uomLabel(item, n) {
  if (!item) return '';
  const word = uomWord(item.uom, n == null ? 1 : n);
  const p = packOf(item);
  return p ? `${word} (${p.size} ${p.piece})` : word;
}
AM.uomLabel = uomLabel;

/* "3 cases (25 suits each)" - the whole phrase, for a line on a screen.

   Once a pack has been opened the whole-pack phrasing stops helping: "0.52
   cases" is arithmetic, not an amount anybody can picture, and the thing being
   described is thirteen suits sitting in a torn box. So a part pack is said in
   the pieces it is actually made of, and the fraction follows in brackets for
   whoever is reconciling it against the shelf. */
function qtyLabel(item, n) {
  const v = qty(n);
  const word = uomWord(item && item.uom, n);
  const p = packOf(item);
  if (!p) return `${v} ${word}`;
  const whole = Math.abs(n - Math.round(n)) < 0.0001;
  if (whole) return `${v} ${word} (${p.size} ${p.piece}${Math.abs(n) === 1 ? '' : ' each'})`;
  const pieces = Math.round(n * p.size * 100) / 100;
  return `${qty(pieces)} ${p.piece} (${v} of a ${uomWord(item.uom, 1)})`;
}
AM.qtyLabel = qtyLabel;

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
AM.daysBetween = daysBetween; AM.dayWords = dayWords; AM.dayShort = dayShort;

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
  /* How far through the server's arrival order this phone has read. The
     server's clock, not this one, so a movement made this morning and sent this
     afternoon still counts as new to everybody who has not had it yet. */
  cursor: '',
  route: '#/',
  derived: null,
  storagePersisted: null,
  installed: window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true,
  conn: { jobtread: false, qbo: false, checked: false },
  meId: null,           // which person, not just the name on the screen
  locked: false,        // true while the app is asking for a PIN
  version: null,        // which build of the app this phone is actually running
  newVersion: null,
  reloading: false,
  /* The catalog as the office last confirmed it. Everything this phone has
     changed since is the difference between this and S.catalog, and that
     difference is what a pull must never throw away. */
  catalogBase: null,
  catalogDirty: false,
  /* True while the only catalog this phone has is the file that shipped with
     the app. It has no jobs in it, so nothing derived from it may be treated as
     news for the office. Cleared the moment a real one arrives. */
  catalogFromSeed: false,
  token: '',            // this phone's own sign-in, issued to one person
  needAuth: false,      // the office no longer accepts this phone, so sign in again
  renderHeld: false
};

/* ---------------------------------------------------------------- signing in
   This used to be one shop code shared by everybody. It has been replaced by a
   token belonging to one person, handed out by /api/auth when they type their
   own PIN. The difference that matters: a shared code could only ever say
   "somebody from A&M", so taking it off one person who had left meant changing
   it for all eight and going round every phone. A token is theirs, and Jen
   switching them off in the office kills it on the next request.

   The token is kept on the phone rather than checked each time, because the
   crews work in basements: anything that needs the network to prove who you are
   would fail exactly when the app is most needed. What the network is needed
   for is the FIRST sign-in on a phone, once, and after that it is not.

   The header is added here, in one place, rather than at each of the eighteen
   places the app talks to the office. Wrapping fetch is a heavier hammer than
   threading a helper through every call site, and it is the right one: a call
   added next year carries the token without anybody remembering, and there is
   no version of "we forgot one" that quietly leaves an endpoint open.

   /api/auth is deliberately NOT in this list. It is how a phone gets a token in
   the first place, so it must not carry one, and a 401 from it means "wrong
   PIN" rather than "sign in again", which would be a loop. */

/* Guarded because this runs while the file is being read, before anything else
   in the app exists. A browser without fetch would otherwise take the whole
   application down at load with nothing on the screen to say why, which is a
   bad trade for a wrapper that is only there to add one header. */
const _fetch = (typeof window.fetch === 'function') ? window.fetch.bind(window) : null;
const isOurApi = u => /(^|\/)api\/(sync|jobtread|qbo)\b/.test(String(u || ''));

if (_fetch) window.fetch = function (input, init) {
  const url = typeof input === 'string' ? input : (input && input.url) || '';
  if (!isOurApi(url)) return _fetch(input, init);

  const opts = { ...(init || {}) };
  if (S.token) {
    const h = new Headers((init && init.headers) || (typeof input !== 'string' && input && input.headers) || {});
    h.set('authorization', 'Bearer ' + S.token);
    opts.headers = h;
  }
  return _fetch(input, opts).then(r => {
    /* Switched off in the office, PIN reset, or a token that has been thrown
       away server side. Ask them to sign in rather than letting every screen
       quietly show yesterday's numbers behind a "no signal" pill that is not
       telling the truth. */
    if (r.status === 401) {
      r.clone().json().then(b => {
        if (b && b.error === 'auth' && !S.needAuth) {
          S.needAuth = true;
          S.authRequired = true;
          S.token = '';
          S.locked = true;
          kvSet('token', null).catch(() => {});
          kvSet('authRequired', true).catch(() => {});
          render();
        }
      }).catch(() => {});
    }
    return r;
  });
};

/* Whether this person can sign in at all. The phone is no longer given anybody's
   salt or hash, so what arrives from the office is a plain flag; a PIN issued on
   this screen a moment ago is still sitting here in full and has not been sent
   yet, so both shapes count. */
const hasPin = u => !!(u && (u.hasPin || (u.pin && u.pin.hash)));
AM.hasPin = hasPin;
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

  /* A MACHINE SETTLES THE JOB IT IS ACTUALLY ON, AND ONLY ONCE
     There is only ever one NEG-44, so its line on a job can only ever be
     settled one time. This used to add to that line on every movement that
     brought it home, whichever job the movement happened to name, and however
     many times it arrived.

     Two things came of that in the live data. A dehumidifier was marked "cannot
     find it" three times in six seconds, because tapping a button that appears
     to do nothing is what anybody does, and the job finished with one machine
     out and three back. And three machines were scanned in against a job they
     had never been issued to, leaving that job holding a return with nothing to
     return against.

     So a machine settles the line of the job the record says it is standing on,
     not the one the movement names, and only while it is actually standing
     there. A second tap is then free, a stray scan corrects whichever job was
     genuinely waiting for it, and neither can leave a line in a state that
     cannot happen in a shop. Bulk stock is deliberately left alone: half a box
     coming back against a job it was not signed out to is an ordinary
     correction, and the count is simply the count. */
  const settleUnit = (e, n) => {
    const at = unitAt.get(e.itemId);
    if (!at || at.where !== 'job' || !at.jobId) return;   // not out, so nothing to settle
    const l = line(at.jobId, e.itemId);
    l.back += n;
    l.lastAt = e.at;
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
        if (unitById.has(e.itemId)) {
          settleUnit(e, e.qty || 1);
          unitAt.set(e.itemId, { where: 'shop', jobId: null, at: e.at, by: e.by });
        } else {
          const l = line(e.jobId, e.itemId);
          l.back += e.qty || 0;
          l.lastAt = e.at;
          onHand.set(e.itemId, (onHand.get(e.itemId) || 0) + (e.qty || 0));
        }
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
        // The leaving side settles the job the machine is really standing on,
        // for the same reason a return does: a move typed against the wrong
        // old job should correct the record, not add a second one to it.
        if (unitById.has(e.itemId)) {
          settleUnit(e, e.qty || 1);
        } else {
          const from = line(e.fromJobId, e.itemId);
          from.back += e.qty || 0;
          from.lastAt = e.at;
        }
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
        if (unitById.has(e.itemId)) settleUnit(e, e.qty || 1);
        else if (e.jobId) {
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
        if (unitById.has(e.itemId)) settleUnit(e, e.qty || 1);
        else if (e.jobId) {
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

  /* MINUS FORTY FIVE COVERALLS IS NOT A COUNT
     Most of the master list has never been counted: it came off an invoice
     history, so there is a price and a name but no number on the shelf. Taking
     three boxes off a shelf nobody has counted was leaving the shelf holding
     minus three, and the screens printed that as a quantity, which reads as a
     statement about the shop rather than what it actually is, which is an
     absence of information plus some movements.

     Twenty items were showing that on the live data, one of them at minus
     forty five. So a shelf line is only a number once somebody has actually
     established one, by counting it, receiving it, or writing it on the master
     list. Until then the movements are still tracked, and the screens can say
     "not counted, 45 have gone out since", which is true and is a prompt to go
     and count it. */
  const established = new Set();
  for (const s of cat.stock) if (s.onHand != null) established.add(s.id);
  for (const e of S.events) {
    if (e.type === 'COUNT' || e.type === 'RECEIVE') established.add(e.itemId);
  }
  const movedSince = new Map();
  for (const id of onHand.keys()) {
    if (established.has(id)) continue;
    movedSince.set(id, -(onHand.get(id) || 0));   // how much has gone out, unmeasured
    onHand.delete(id);                            // no count exists, so do not invent one
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
  const today = dayISO();   /* local day: after 6 pm the UTC date is tomorrow */
  for (const e of S.events) {
    if (e.type !== 'ISSUE' || !e.dueBack || !unitById.has(e.itemId)) continue;
    const at = unitAt.get(e.itemId);
    if (at && at.where === 'job' && e.dueBack < today) {
      if (!overdue.some(o => o.itemId === e.itemId)) {
        overdue.push({ itemId: e.itemId, jobId: at.jobId, dueBack: e.dueBack, since: at.at, by: at.by });
      }
    }
  }

  S.derived = { onHand, unitAt, jobLoad, outstanding, dop, repairLog, lost, waste, received, requests, overdue, unitById, stockById, movedSince };
  return S.derived;
}
AM.derive = derive;

/* ------------------------------------------------- reading a job's line ----
   ONE PLACE THAT DECIDES WHAT A LINE MEANS

   A line has three raw sums on it, each the total of its own kind of movement:
   `out` from the issues, `back` from the returns, `consumed` from what a crew
   marked as spent. They are the audit trail and they are never rewritten.

   What cannot happen in a shop is the three of them disagreeing. One box of
   gloves went out; a quarter of it came back and the whole box was marked used,
   which is a box and a quarter out of a box. That is what the live data was
   showing: the shelf got its quarter back AND the job was charged for fifty
   gloves, so the job was over-charged by a quarter of a box and the count of
   what A&M owns was a quarter of a box adrift.

   It happened because "Used it all" and "Fix the count" were each right on
   their own and never spoke to each other. Fixing the count records a return,
   as it should, and nothing was reducing the amount already written off.

   Both halves are now fixed. Correcting a count writes the matching correction
   to what was used, so the sums agree from here on. And this function is the
   belt to that pair of braces, for the lines already in the file: whatever the
   sums say, `back` is the half the shelf count corroborates and the half a
   person last put their name to, so it stands, and `used` is capped at what is
   actually left to account for. `over` carries the difference, so a screen can
   say so rather than quietly rounding it away. */
function settled(l) {
  const out = (l && l.out) || 0;
  const back = (l && l.back) || 0;
  const raw = (l && l.consumed) || 0;
  const room = Math.round(Math.max(0, out - back) * 10000) / 10000;
  const used = Math.min(raw, room);
  return {
    out, back, used,
    consumedRaw: raw,
    over: Math.round(Math.max(0, raw - room) * 10000) / 10000,
    still: Math.round(Math.max(0, out - back - used) * 10000) / 10000
  };
}
AM.settled = settled;

/* --------------------------------------------------------- orphaned jobs ---
   A movement always names the job it was made against, and movements are never
   lost, so the event log is the one place a job cannot go missing from. If the
   catalog has no record of a job the log is still talking about, the record is
   what went astray, not the work.

   That happened here: a bug in the old catalog merge deleted seven days of jobs
   while all of their movements stayed on the server, so thirteen machines were
   signed out to jobs that no longer existed. The merge is fixed, but the gear
   still has to come home, and a phone should not need anybody to intervene to
   show it. So the record is stood back up from the log: the id, when it started,
   and who made the first movement against it, which is everything the log
   actually knows. It is flagged, because a job called "Recovered" needs a real
   address putting on it by somebody who knows the site, and that is an office
   job, not a guess this function should make. */
function recoverOrphanJobs() {
  if (!S.catalog) return false;
  const jobs = S.catalog.jobs || (S.catalog.jobs = []);
  const have = new Set(jobs.map(j => j.id));
  const dead = (S.catalog.deleted && S.catalog.deleted.jobs) || {};
  const first = new Map();
  for (const e of S.events) {
    for (const id of [e.jobId, e.fromJobId, e.toJobId]) {
      if (!id || have.has(id) || dead[id]) continue;
      if (!first.has(id)) first.set(id, e);
    }
  }
  if (!first.size) return false;
  for (const [id, e] of first) {
    jobs.push({
      id, name: 'Recovered job', number: '', address: '',
      division: 'abatement', phase: 'P4',
      containment: null, waterCategory: null, areaSqFt: null, crewSize: null,
      preMob: {}, strike: {},
      jobtreadId: null, createdAt: e.at, createdBy: e.by || 'unknown',
      closed: false, recovered: true
    });
  }
  return true;
}
AM.recoverOrphanJobs = recoverOrphanJobs;

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

/* ------------------------------------------------------- catalog merging ---
   A pull used to do S.catalog = whatever the server sent. That is fine until a
   phone has made a change the server has not got yet, and then it is a silent
   delete. A job started in a basement at two in the morning, address and all,
   would sit on the phone until the next routine sync landed the office copy on
   top of it and took the job with it. The gear scanned onto that job survived,
   because gear is events, so the shop was left with machines standing on a job
   nobody could see. That is exactly what was reported twice.

   So a pull is now a three way merge against the last version the office
   confirmed. Anything this phone added and the office has not seen is kept.
   Anything this phone changed since that confirmation wins over the office
   copy. Everything else is the office copy, so two people editing different
   jobs never fight. */

const CATALOG_LISTS = [['jobs', 'id'], ['units', 'id'], ['stock', 'id'],
                       ['locations', 'id'], ['kits', 'id'], ['users', 'name']];

const rowKey = (o, key) => String(o && o[key] != null ? o[key] : (o && o.name) || '');
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/* WHY A MISSING ROW IS NEVER A DELETE ANY MORE
   This used to read "it is in the confirmed copy but not on this phone, so this
   phone deleted it". That inference is wrong whenever a phone is holding a
   catalog it did not get from the server, and there is one very ordinary way
   that happens: the app opens with no signal, falls back to the seed file that
   ships with it, and the seed has no jobs in it at all. The next sync then read
   every job on the server as "deleted on this phone", dropped all of them, and
   pushed the emptied list straight back up. The movements survived, because
   movements are events, so the shop was left with machines standing on jobs
   nobody could see, and Find showed a bare INV- number because the job it
   pointed at no longer existed.

   That is exactly what had happened here: seven days of jobs gone from the
   catalog while every one of their movements was still on the server.

   So absence is no longer evidence of anything. A row is removed only when
   somebody deliberately removed it, and that is written down as a tombstone
   which travels like any other row. Merging is otherwise purely additive, which
   is the only shape that is safe when a phone can be holding a catalog from any
   point in time, including the one that shipped in the box. */

const tombOf = c => (c && c.deleted) || {};

function mergeTombstones(local, server) {
  const out = {};
  for (const src of [server, local]) {
    for (const [list, ids] of Object.entries(tombOf(src))) {
      out[list] = out[list] || {};
      for (const [id, at] of Object.entries(ids || {})) {
        if (!out[list][id] || String(at) > String(out[list][id])) out[list][id] = at;
      }
    }
  }
  return out;
}

function mergeList(base, local, server, key, tombs, hasBase) {
  const bM = new Map((base || []).map(o => [rowKey(o, key), o]));
  const lM = new Map((local || []).map(o => [rowKey(o, key), o]));
  const dead = tombs || {};
  const out = [];
  const seen = new Set();

  for (const sRow of (server || [])) {
    const id = rowKey(sRow, key);
    seen.add(id);
    if (dead[id]) continue;                    // somebody deliberately removed it
    const lRow = lM.get(id);
    if (!lRow) { out.push(sRow); continue; }   // this phone simply had not got it yet
    /* No confirmed copy to compare against means there is no evidence this
       phone changed anything, so the office's row stands. Without this, a phone
       that fell back to the seed would quietly push the seed's prices and
       serials over the top of whatever the office had corrected. Additions from
       this phone are still kept below; it is only a row both sides already have
       that defers to the server. */
    if (!hasBase) { out.push(sRow); continue; }
    const bRow = bM.get(id);
    // Changed here since the office last confirmed it: this phone wins.
    out.push(!bRow || !same(lRow, bRow) ? lRow : sRow);
  }

  // Anything on this phone the office has never had. A job started in a
  // basement at two in the morning is the whole reason this function exists.
  for (const lRow of (local || [])) {
    const id = rowKey(lRow, key);
    if (seen.has(id) || dead[id]) continue;
    out.push(lRow);
  }
  return out;
}

function mergeCatalog(local, server, base) {
  if (!server) return local;
  if (!local) return server;
  const b = base || {};              // no baseline is not a licence to delete
  const out = { ...server };
  const tombs = mergeTombstones(local, server);
  for (const [name, key] of CATALOG_LISTS) {
    if (server[name] || local[name]) {
      out[name] = mergeList(b[name], local[name], server[name], key, tombs[name], !!base);
    }
  }
  if (Object.keys(tombs).length) out.deleted = tombs;
  /* Settings are one object, not a list, so they cannot be merged row by row.
     Keep this phone's copy only when it has actually been changed here against a
     real baseline. With no baseline the server's copy is the better answer,
     because the seed's settings are defaults nobody chose. */
  const touched = base && !same(local.settings || {}, b.settings || {});
  out.settings = touched ? (local.settings || {}) : (server.settings || {});
  out.meta = server.meta || local.meta;
  return out;
}

/* The one deliberate removal path in the app, on the settings screen. Writing it
   down is what lets every other phone honour it without absence having to mean
   anything. */
function markDeleted(list, id) {
  S.catalog.deleted = S.catalog.deleted || {};
  S.catalog.deleted[list] = S.catalog.deleted[list] || {};
  S.catalog.deleted[list][String(id)] = nowISO();
}
AM.markDeleted = markDeleted;

const bodyOf = c => { const { meta, ...rest } = (c || {}); return rest; };

/* Is this phone holding something the office has not got? */
function aheadOfServer(local, server) {
  if (!server) return !!local;
  return !same(bodyOf(local), bodyOf(server));
}
AM.mergeCatalog = mergeCatalog;

/* ------------------------------------------------------------ starting over
   Clearing the server does not clear anybody's phone. Every movement this phone
   has ever seen is in its own storage, and the counts on every screen are built
   from that, so a shop wiped clean in the office would still show the old
   picture on eleven phones until each one was reinstalled by hand.

   So a reset is announced rather than done quietly: the office stamps a date on
   the catalog, every phone notices it the next time it syncs, and each one
   drops the movements it was holding from before that moment. Work done after
   the stamp is kept, including anything still queued in a basement, because a
   decision made in the office must not throw away a load somebody has already
   put in a van. */
async function applyReset(iso) {
  if (!iso) return false;
  let seen = null;
  try { seen = await kvGet('dataResetAt'); } catch (e) {}
  if (seen === iso) return false;

  const keep = S.outbox.filter(e => String(e.at) >= String(iso));
  try {
    await tx('events', 'readwrite', s => s.clear());
    await tx('outbox', 'readwrite', s => s.clear());
    for (const e of keep) await putIn('outbox', e);
  } catch (e) {}

  S.events = [...keep];
  S.outbox = keep;
  S.cursor = '';
  S.lastEventAt = '';

  /* The jobs go with the movements, and this is the half that is easy to get
     wrong. Merging is additive now, on purpose, so a phone still holding the
     old jobs would push every one of them straight back and undo the reset
     within a minute. The stamp is what tells this phone those jobs belong to
     the shop that was cleared, so it lets go of them rather than arguing for
     them. A job started after the stamp is somebody's real work and stays. */
  if (S.catalog) {
    const before = (S.catalog.jobs || []).length;
    S.catalog.jobs = (S.catalog.jobs || []).filter(j => String(j.createdAt || '') >= String(iso));
    if ((S.catalog.jobs || []).length !== before) {
      S.catalogDirty = false;             // matches the office, nothing to push
      S.catalogBase = JSON.parse(JSON.stringify(S.catalog));
      try {
        await kvSet('catalog', S.catalog);
        await kvSet('catalogBase', S.catalogBase);
        await kvSet('catalogDirty', false);
      } catch (e) {}
    }
  }

  try {
    await kvSet('syncCursor', '');
    await kvSet('lastEventAt', '');
    await kvSet('dataResetAt', iso);
  } catch (e) {}
  derive();
  return true;
}
AM.applyReset = applyReset;

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
        /* A batch is capped so one enormous push cannot time out. Whatever is
           left has to be asked for again, or a phone that came back from a week
           in a basement drains 200 movements and then sits on the rest until
           somebody happens to scan something. */
        if (S.outbox.length) syncSoon(1500);
      }
    }

    // Pull anything anyone else did, from where this phone got to in the
    // server's own arrival order.
    const since = S.cursor ? `?since=${encodeURIComponent(S.cursor)}` : '?since=';
    const r2 = await fetch('/api/sync' + since);
    if (r2.ok) {
      const res = await r2.json();
      if (res.you && res.you.role && res.you.role !== S.role) { S.role = res.you.role; kvSet('role', S.role).catch(() => {}); }
      if (res.catalog) {
        /* A phone that has only ever had the starter file takes the office's
           list as it is. Merging the starter file in would push its three
           sample names and every deleted machine back up to the office. */
        const merged = S.catalogFromSeed ? res.catalog : mergeCatalog(S.catalog, res.catalog, S.catalogBase);
        S.catalog = merged;
        S.catalogBase = res.catalog;
        S.catalogFromSeed = false;      // a real one has arrived
        await kvSet('catalog', S.catalog);
        await kvSet('catalogBase', S.catalogBase);
        /* The office has started the shop over. Drop what this phone was
           holding from before that moment, then come straight back for a clean
           pull rather than laying tonight's movements on top of last month's. */
        if (await applyReset((S.catalog.settings || {}).dataResetAt)) {
          S.syncing = false;
          render();
          return sync();
        }
        // Anything this phone is still holding gets pushed straight back, so a
        // job made offline reaches the office on the first bar of signal
        // instead of waiting for somebody to open a screen and save again.
        if (aheadOfServer(S.catalog, res.catalog)) S.catalogDirty = true;
      }
      let added = 0;
      const have = new Set(S.events.map(e => e.id));
      /* Anything from before the shop was started over is not this shop's
         history any more. Filtered on the way in rather than only cleared once,
         so a phone installed fresh next month does not pull the old life back
         out of the log and show it as though it were current. */
      const resetAt = (S.catalog && S.catalog.settings && S.catalog.settings.dataResetAt) || '';
      for (const e of (res.events || [])) {
        if (have.has(e.id)) continue;
        if (resetAt && String(e.at) < String(resetAt)) continue;
        S.events.push(e);
        await putIn('events', e);
        added++;
        if (e.at > S.lastEventAt) S.lastEventAt = e.at;
      }
      /* Only ever moved forward by what the server says it handed over, and
         only once that has actually been written to this phone. Moving it on a
         phone's own reading of the timestamps is what used to lose movements
         that arrived out of order. */
      /* Compared as numbers. As text, "100" sorts before "99", which left
         phones stuck re-pulling the same movements over and over. */
      if (res.cursor && /^\d+$/.test(String(res.cursor)) && (!/^\d+$/.test(String(S.cursor || '')) || Number(res.cursor) > Number(S.cursor))) {
        S.cursor = res.cursor;
        await kvSet('syncCursor', S.cursor);
      }
      if (added) S.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
      await kvSet('lastEventAt', S.lastEventAt);
      S.lastSync = res.serverTime;
      await kvSet('lastSync', S.lastSync);
      derive();
    }

    // The catalog goes up last, on the freshly pulled revision, which is what
    // turns "somebody else saved first" from a dead end into a retry that
    // works. It keeps trying every sync until it lands.
    if (S.catalogDirty) await saveCatalog({ quiet: true });
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
async function saveCatalog(opts = {}) {
  const quiet = !!opts.quiet;
  /* The file that ships with the app is a starting point, not a record. It has
     no jobs in it. Sending it to the office would be this phone claiming the
     company has no jobs, which is how the jobs were lost the first time.
     `seeding` is the one caller allowed through: the very first run for the
     whole company, when the server genuinely has nothing at all. */
  if (S.catalogFromSeed && !opts.seeding) {
    S.catalogDirty = false;
    /* It used to drop the change without a word, which is what "I added them
       and they are not there" was. Now it says why. */
    if (!quiet) toast('This phone has not loaded the office list yet, so that was not saved. Sign in with a bar of signal, then try again.', 'warn');
    return false;
  }
  const body = { ...S.catalog, meta: { ...(S.catalog.meta || {}), basedOnRev: S.catalog.meta?.rev ?? 0 } };

  // Keep it on the phone first. A catalog edit made in a basement must not be
  // lost, and it must not throw either: several screens call this and none of
  // them should fall over because there is no signal.
  S.catalogDirty = true;
  try { await kvSet('catalog', S.catalog); } catch (e) {}
  try { await kvSet('catalogDirty', true); } catch (e) {}

  let r, res;
  try {
    r = await fetch('/api/sync', {
      method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    });
    res = await r.json().catch(() => ({}));
  } catch (e) {
    if (!quiet) toast('Saved on this phone. It reaches the office when you have signal.', 'warn');
    return false;
  }

  /* Somebody else saved while this page was open. It used to stop here and tell
     the user to reload, and nobody reloads, so the change sat on the phone
     until a pull deleted it. Now it takes their version, merges this phone's
     change onto it, and saves again. A new job is an addition, not an argument.
     One retry only, so a genuinely stuck save cannot spin. */
  if (r.status === 409) {
    if (opts.retried) { if (!quiet) toast(res.message || 'Could not save that yet. It is safe on this phone.', 'warn'); return false; }
    try {
      const fresh = await (await fetch('/api/sync?events=0')).json();
      if (fresh && fresh.catalog) {
        S.catalog = mergeCatalog(S.catalog, fresh.catalog, S.catalogBase);
        S.catalogBase = fresh.catalog;
        await kvSet('catalogBase', S.catalogBase);
        return await saveCatalog({ ...opts, retried: true });
      }
    } catch (e) {}
    if (!quiet) toast('Could not save that yet. It is safe on this phone.', 'warn');
    return false;
  }

  if (!r.ok) {
    if (!quiet) {
      const why = r.status === 401 ? 'Sign in again. The change is kept on this phone and goes up after you do.'
        : r.status === 403 ? (res.message || 'Only the office can change that.')
        : r.status === 503 ? 'The office is busy. It is kept on this phone and tries again by itself.'
        : (res.message || res.error || 'That did not save.');
      toast(why, r.status === 503 || r.status === 401 ? 'warn' : 'bad');
    }
    return false;
  }
  S.catalog.meta = { ...(S.catalog.meta || {}), rev: res.rev, savedAt: res.savedAt };
  S.catalogBase = JSON.parse(JSON.stringify(S.catalog));
  S.catalogDirty = false;
  await kvSet('catalog', S.catalog);
  await kvSet('catalogBase', S.catalogBase);
  await kvSet('catalogDirty', false);
  if (!quiet) toast('Saved');
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
   last thing to confirm anything, so the phone has to say it another way.

   THE BEEP, AND WHY IT KEPT GOING QUIET
   A phone will not make a sound until the person has touched the screen. The
   old version built the sound machine the first time it needed a beep, and the
   first time it needed a beep was inside a camera callback rather than a tap.
   So the phone handed back a silent one, and it stayed silent for the rest of
   the day. On top of that, iOS puts the sound machine to sleep every time the
   app goes to the background or a call comes in, and it does not wake up on
   its own.

   So it is built on the first tap anywhere in the app, woken again on every
   tap after that, and every beep asks it to wake before it plays. Do not move
   the building of it back inside beep(). */
let audioCtx = null;
let audioPrimed = false;

function audioUnlock() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!audioCtx) audioCtx = new Ctx();
    if (audioCtx.state !== 'running' && audioCtx.resume) audioCtx.resume();
    if (!audioPrimed) {
      /* A silent blip. Some phones only really open the speaker once something
         has actually been pushed through it. */
      const o = audioCtx.createOscillator(), g = audioCtx.createGain();
      g.gain.value = 0.0001;
      o.connect(g); g.connect(audioCtx.destination);
      o.start(); o.stop(audioCtx.currentTime + 0.01);
      audioPrimed = true;
    }
  } catch (e) {}
}
AM.audioUnlock = audioUnlock;

/* Every tap, not only the first. The first builds it; the rest wake it after
   the phone has been in a pocket. */
['pointerdown', 'touchend', 'keydown'].forEach(ev =>
  window.addEventListener(ev, audioUnlock, { capture: true, passive: true }));
document.addEventListener('visibilitychange', () => { if (!document.hidden) audioUnlock(); });

/* Ramped on and off rather than switched, because a square edge on a phone
   speaker is a click nobody hears over a running negative air unit. */
function tone(freq, secs, at) {
  const o = audioCtx.createOscillator(), g = audioCtx.createGain();
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.0001, at);
  g.gain.exponentialRampToValueAtTime(0.22, at + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, at + secs);
  o.connect(g); g.connect(audioCtx.destination);
  o.start(at); o.stop(at + secs + 0.02);
}

/* One shape of sound per outcome, and the buzz always fires, because a phone
   on silent in a pocket is the normal state of a phone on a site. */
function play(shape, fallbackBuzz) {
  try {
    audioUnlock();
    if (!audioCtx) { buzz(fallbackBuzz); return; }
    const go = () => { try { shape(audioCtx.currentTime + 0.01); } catch (e) {} };
    if (audioCtx.state === 'running') go();
    else if (audioCtx.resume) audioCtx.resume().then(go).catch(() => {});
  } catch (e) {}
}

function beep(ok = true) {
  if (ok) play(t => tone(880, 0.09, t), 30);
  else play(t => { tone(300, 0.14, t); tone(200, 0.18, t + 0.16); }, 120);
  buzz(ok ? 30 : 120);
}
AM.beep = beep;

/* Already counted. Two quick clicks, deliberately neither the good beep nor
   the bad one: nothing has gone wrong, it is just on the list already. */
function beepDup() {
  play(t => { tone(660, 0.06, t); tone(660, 0.06, t + 0.09); }, 60);
  buzz(60);
}
AM.beepDup = beepDup;

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
  /* Awaited. The camera has to have actually let go before anything else opens
     one, or the next start lands on a reader that is still shutting down and
     the phone comes back with a dead black rectangle. */
  if (opts.altLabel) $('#scanAlt').onclick = async () => { await closeScanner(); opts.onAlt && opts.onAlt(); };

  const Html5Qrcode = window.Html5Qrcode || (window.__Html5QrcodeLibrary__ && window.__Html5QrcodeLibrary__.Html5Qrcode);
  if (!Html5Qrcode) { toast('The scanner did not load. Use the list instead.', 'bad'); return; }

  scanner = new Html5Qrcode('reader', { verbose: false });
  const config = { fps: 12, qrbox: { width: 250, height: 250 }, aspectRatio: 1.0 };

  /* ONE CODE, ONE HIT
     A phone held steady on a tag re-reads it twelve times a second, so the
     same code inside the window is the same scan, not a second one. It was a
     second and a half, which is less than the time it takes to look up from
     the tag, and that is where a lot of the double counting came from.

     The second guard matters more: the camera keeps running behind a quantity
     pad or a warning, and it will happily read the same tag four more times
     while somebody is typing into it. Nothing lands while a modal is open. */
  let lastCode = '', lastAt = 0;
  const handle = text => {
    const t = Date.now();
    const m = $('#modal');
    if (m && !m.hidden) return;
    if (text === lastCode && t - lastAt < 2500) return;
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
    /* The door to the office carries what is waiting behind it. Somebody
       standing on the shop screen can see the office has three things needing a
       decision without having to go and look, which is the whole difference
       between a number and a prompt. */
    : `<button class="tab-swap" data-h="#/dash" data-tour="office">Office${attention().office ? ` <span class="tab-badge">${attention().office}</span>` : ''}</button>`;
  /* Settings sits in the same place on both sides, always.
     It used to appear only on the office side, on the theory that the crew have
     no business in it. Nothing in there is protected, so hiding it protected
     nothing, and what it actually did was send anybody standing on the shop
     screen looking for Settings round in circles. A control that exists on some
     screens and not others reads as broken, not as tidy. */
  const settings =
    `<button class="tab-set" data-h="#/setup" ${AM.isSettings(S.route) ? 'aria-current="true"' : ''}>Settings</button>`;
  /* The command centre lives in this same app, one page over. Shown to the
     office, the field leads and the owner; the server decides who that is. */
  const command = (S.role && S.role !== 'crew')
    ? `<button class="tab-set" data-href="/command.html#equipment">${narrow ? 'Command' : 'Command centre'}</button>` : '';
  /* On a phone these used to wrap onto four lines and eat a third of the
     screen before any of the work showed. The tabs now scroll sideways in one
     line, and Settings and the door to the other side are pinned outside the
     scroller, so the two controls people hunt for are always where they were
     left. */
  /* A number on the Shop tab when the crews have asked for something. An ask
     that only exists on a screen nobody has opened is a phone call waiting to
     happen, which is the habit this was built to replace. */
  /* WHAT IS WAITING, ON THE TAB, NOT BURIED ON A SCREEN
     Below minimum and the crews' requests were both real, both correct, and
     both only visible to somebody who had already decided to go and look at
     them. A number that only exists on a screen nobody has opened is the phone
     call this app was built to replace. So the counts ride on the tabs
     themselves, and the door between the two sides carries the total, which
     means a man in the shop can see that the office has something waiting
     without leaving the shop screen. */
  function attention() {
    const out = { low: 0, asks: 0, certs: 0, lost: 0 };
    try {
      const d = S.derived || derive();
      out.asks = d.requests.filter(r => !r.filled).length;
      out.lost = d.lost.size;
      if (AM.belowMin) out.low = AM.belowMin().length;
      if (AM.dopState) {
        out.certs = (S.catalog.units || []).filter(u => u.dop && AM.dopState(u.id).state !== 'ok').length;
      }
    } catch (e) {}
    out.office = out.low + out.asks + out.certs;
    return out;
  }
  AM.attention = attention;

  const at = attention();
  const asks = at.asks;
  const badge = n => n ? ` <span class="tab-badge">${n}</span>` : '';
  const tabBadge = h => {
    if (!office) return h === '#/' ? badge(asks) : '';
    if (h === '#/dash') return badge(asks);
    if (h === '#/order') return badge(at.low);
    if (h === '#/dop') return badge(at.certs);
    return '';
  };

  $('#tabs').innerHTML =
    `<div class="tab-scroll">` +
      tabs.map(([h, label]) =>
        `<button data-h="${h}" ${S.route === h ? 'aria-current="true"' : ''}>${esc(label)}${tabBadge(h)}</button>`
      ).join('') +
    `</div><div class="tab-fixed">` + settings + command + swap + `</div>`;
  $$('#tabs button').forEach(b => b.onclick = () => b.dataset.href ? (location.href = b.dataset.href) : go(b.dataset.h));
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

/* ------------------------------------------------- typing beats redrawing ---
   The app redraws the whole screen whenever anything changes, including every
   time it talks to the office, which is every sixty seconds and after every
   scan. That redraw was throwing away anything typed into a box and not yet
   sent. Type fifty bags, let a sync land, type the trailer, press Log it, and
   the job gets one trailer and no bags. That is the waste bug, and the same
   thing was quietly resetting the check-in counter.

   Two rules now. A screen is never redrawn under somebody's fingers: if the
   cursor is in a box they have typed into, the redraw waits until they leave
   it. And if a redraw does happen, anything typed and not yet sent is put
   back. A box is only "typed in" once a person has actually typed in it, so
   nothing the app fills in for itself is ever frozen. */

function typedInputs(view) {
  return [...view.querySelectorAll('input, textarea')]
    .filter(el => el.id && el.dataset.typed === '1' &&
      el.type !== 'checkbox' && el.type !== 'radio');
}

function holdingTyping(view) {
  const a = document.activeElement;
  if (!a || !view.contains(a)) return false;
  const tag = a.tagName;
  if (tag !== 'INPUT' && tag !== 'TEXTAREA') return false;
  if (a.type === 'checkbox' || a.type === 'radio' || a.type === 'button') return false;
  return a.dataset.typed === '1' || (a.value != null && a.value !== '');
}

/* Called by anything that has just consumed what was in a box, so the value is
   not put back on the redraw that follows. */
function clearTyped(el) {
  if (!el) return;
  el.value = '';
  delete el.dataset.typed;
}
AM.clearTyped = clearTyped;

function render() {
  // The code comes before the PIN: you get into the building, then you sign in.
  if (!S.catalog) return;
  if (S.locked) { renderLock(); return; }
  document.body.classList.remove('locked');
  renderTabs();
  renderStatus();
  const view = $('#view');
  const r = S.route || '#/';

  /* Somebody is mid-word. Leave the screen alone and come back when they are
     done. The counts on it go a few seconds stale, which nobody notices, and
     what they typed survives, which they very much do. */
  if (S.renderRoute === r && holdingTyping(view)) {
    S.renderHeld = true;
    return;
  }
  S.renderHeld = false;
  S.renderRoute = r;

  const keep = new Map();
  for (const el of typedInputs(view)) keep.set(el.id, el.value);

  const fn = AM.screens[r] || AM.screens['#/'];
  try {
    view.innerHTML = fn();
    wrapTables(view);
    for (const [id, v] of keep) {
      const el = view.querySelector('[id="' + id.replace(/"/g, '\\"') + '"]');
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
        el.value = v;
        el.dataset.typed = '1';
      }
    }
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
const anyPins = () => (S.catalog.users || []).some(u => hasPin(u));
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

/* THE FRONT DOOR
   This is one app. The owner, the office and the field leads land on the
   command centre, where Equipment is one section among the rest. Crew land on
   the shop screens, which is all they use. "Shop and settings" in the command
   centre comes back here with #/ on the address, so it does not bounce. */
function goCommand(justSignedIn) {
  if (!S.role || S.role === 'crew') return false;
  if (location.hash && location.hash !== '#') return false;
  if (/[?&]shop\b/.test(location.search)) return false;
  if (!justSignedIn && /[?&]signin\b/.test(location.search)) return false;
  location.replace('/command.html');
  return true;
}
AM.goCommand = goCommand;

async function checkLock() {
  /* Whether sign-in is needed is the office's call, not this phone's copy of
     the list. A phone holding an old or starter list used to decide nobody had
     a PIN and let anyone in, then fail every sync without saying so. */
  if (!anyPins() && !S.authRequired) { S.locked = false; return; }
  const s = await kvGet('session');
  if (!s) { S.locked = true; return; }
  /* Access taken away in the office has to reach the phone in somebody's
     pocket. It does, the next time that phone syncs the list. */
  const still = activeUsers().find(u => (s.id && u.id === s.id) || u.name === s.name)
    || ((S.catalogFromSeed && S.token) ? { name: s.name, id: s.id } : null);
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
        rp: { name: 'A&M Command Centre' },
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

/* ONE SIGN-IN FOR THE WHOLE APP
   The shop screens no longer draw their own sign-in. Anybody who needs to sign
   in, because they have never signed in on this device, the hour idle ran out,
   or the office switched them off, is sent to the app's front door (/), which
   signs them in the same way, with the same names, PINs and fingerprint, and
   sends them straight back to the shop screen they were on. The front door is
   stored on the device too, so this works with no signal. The session is
   cleared first, so the front door never sends them straight back here. */
async function renderLock() {
  try { await kvSet('session', null); } catch (e) {}
  const h = location.hash && location.hash !== '#' && location.hash !== '#/' ? location.hash : '';
  location.replace('/?next=shop' + (h ? '&h=' + encodeURIComponent(h) : ''));
}

/* The shop's own sign-in screen, kept only for reference. Nothing calls it. */
async function renderLockInShop() {
  document.body.classList.add('locked');
  const tabs = $('#tabs'); if (tabs) tabs.innerHTML = '';
  const sb = $('#statusbar');
  if (sb) sb.innerHTML = `<span class="pill ${S.online ? 'good' : 'off'}">${S.online ? 'Online' : 'No signal, still working'}</span>` +
    (S.outbox.length ? `<span class="pill warn">${S.outbox.length} waiting</span>` : '');

  const view = $('#view');
  const bio = await kvGet('bio');
  const hasBio = !!(bio && bio.credId) && await bioAvailable();
  let picked = null;

  /* The names come from the office when there is signal, so somebody added
     this morning can sign in on a phone that has never seen them. This phone's
     own copy is only the fallback for a basement. */
  let roster = null;
  if (navigator.onLine) {
    try {
      const r = await _fetch('/api/auth', { method: 'GET', cache: 'no-store' });
      if (r.ok) {
        const b = await r.json();
        if (b && Array.isArray(b.people)) roster = b.people;
        if (b && b.required) { S.authRequired = true; kvSet('authRequired', true).catch(() => {}); }
      }
    } catch (e) {}
  }
  const people = () => roster || activeUsers().map(u => ({ id: u.id || '', name: u.name, hasPin: hasPin(u) }));

  const drawPick = () => {
    view.innerHTML = `
      <div class="lock">
        <div class="lock-card">
          <h2>Sign in</h2>
          <p class="muted">The A&amp;M Office Command Centre. Tap your name and type your four digits. This device remembers you until it has sat idle for an hour.</p>
          ${hasBio ? `<button class="btn big" id="bioGo">Unlock as ${esc(bio.name)}</button>
            <button class="btn-ghost" id="bioAlt">Somebody else, or use a PIN</button>` : ''}
          <div class="who-list ${hasBio ? 'tucked' : ''}" id="whoList">
            ${people().map(u => `<button class="who-pick" data-n="${esc(u.name)}">${esc(u.name)}</button>`).join('')
              || '<p class="muted">Nobody has been added yet. The office adds people on the settings screen.</p>'}
          </div>
          <p class="muted small">${roster ? 'Not on the list? Ask the office to add you, then close and reopen the app.' : 'No signal, so this is the list this phone last saw. Somebody added today shows up once there is a bar.'}</p>
        </div>
      </div>`;

    const bg = $('#bioGo');
    if (bg) bg.onclick = async () => {
      bg.disabled = true; bg.textContent = 'Waiting for the phone…';
      const ok = await bioUnlock();
      bg.disabled = false; bg.textContent = `Unlock as ${bio.name}`;
      if (!ok) { toast('That did not match. Use your PIN.', 'warn'); return; }
      const u = activeUsers().find(x => (bio.userId && x.id === bio.userId) || x.name === bio.name)
        || (roster || []).find(x => (bio.userId && x.id === bio.userId) || x.name === bio.name);
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
      picked = people().find(u => u.name === b.dataset.n);
      if (!picked) return;
      /* With signal the office decides; this phone's copy may be out of date. */
      if (!roster && !hasPin(picked)) {
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

    /* WHERE THE FOUR DIGITS ARE ACTUALLY CHECKED, AND WHY IT MOVED
       This used to be done here, on the phone, against a hash that arrived with
       the catalog. That meant every phone was carrying every person's hash, and
       four digits against a known salt is ten thousand guesses, which is no time
       at all. So the real check is the office server's now, and the hash a phone
       holds is only its own.

       The network is therefore needed for a person's FIRST sign-in on a given
       phone, and never again: what comes back is kept, and every sign-in after
       that is answered underground from what is already here. A phone that has
       never signed this person in and has no signal genuinely cannot tell a
       right PIN from a wrong one, and says so rather than guessing. */
    const submit = async () => {
      const f = await failState();
      if (f.until && Date.now() < f.until) {
        msg('Too many wrong. Wait a minute.', 'bad'); entry = ''; dots(); return;
      }

      const wrong = async (why) => {
        const n = (f.n || 0) + 1;
        await kvSet('pinFail', { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        entry = ''; dots();
        msg(why || (n >= 5 ? 'Too many wrong. Wait a minute.' : 'That is not it. Try again.'), 'bad');
        beep(false);
      };

      msg('Checking…');
      let ok = false;
      try {
        const r = await _fetch('/api/auth', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ name: picked.id || picked.name, pin: entry })
        });
        const b = await r.json().catch(() => null);
        if (r.ok && b && b.token) {
          S.token = b.token;
          await kvSet('token', b.token);
          /* Their own, and nobody else's. This is the whole of what makes the
             next sign-in work in a basement. */
          if (b.pin) await kvSet('mypin', { id: picked.id || '', name: picked.name, ...b.pin });
          if (b.user && b.user.id && !picked.id) picked = { ...picked, id: b.user.id };
          S.isOffice = !!(b.user && b.user.office);
          await kvSet('isOffice', S.isOffice);
          S.role = (b.user && b.user.role) || 'crew';
          await kvSet('role', S.role);
          ok = true;
        } else if (r.status === 429) {
          entry = ''; dots();
          msg((b && b.message) || 'Too many wrong tries. Ask the office.', 'bad');
          beep(false);
          return;
        } else if (r.status === 403 && b && b.error === 'nopin') {
          entry = ''; dots();
          msg('The office has not issued you a PIN yet.', 'bad');
          beep(false);
          return;
        }
      } catch (e) {
        /* No signal. Fall back to what this phone was told about this one
           person the last time it did have some. */
        const mine = await kvGet('mypin');
        const same = mine && ((picked.id && mine.id === picked.id) || mine.name === picked.name);
        if (!same || !mine.salt) {
          entry = ''; dots();
          msg('No signal, and this phone has not signed you in before. The first one needs a bar of signal.', 'bad');
          beep(false);
          return;
        }
        ok = (await pinHash(entry, mine.salt)) === mine.hash;
      }

      if (!ok) { await wrong(); return; }

      await kvSet('pinFail', { n: 0, until: 0 });
      S.needAuth = false;
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
    if (goCommand(true)) return;
    document.body.classList.remove('locked');
    render();
    /* Straight to the office, so a phone that was showing the starter list or
       an old one has the real one within a second of signing in. */
    if (navigator.onLine) sync().catch(() => {});
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
    S.catalogBase = (await kvGet('catalogBase')) || null;
    S.catalogDirty = !!(await kvGet('catalogDirty'));
    S.me = (await kvGet('me')) || null;
    S.token = (await kvGet('token')) || '';         // before anything talks to the office
    S.authRequired = !!(await kvGet('authRequired'));
    S.isOffice = !!(await kvGet('isOffice'));
    S.role = (await kvGet('role')) || '';
    S.lastEventAt = (await kvGet('lastEventAt')) || '';
    /* Deliberately not seeded from the old lastEventAt marker. That one was a
       phone's own clock reading; treating it as a server cursor would skip
       whatever is sitting between the two. Starting empty costs one full pull,
       once, and guarantees this phone is holding everything. */
    S.cursor = (await kvGet('syncCursor')) || '';
    S.lastSync = (await kvGet('lastSync')) || null;
    S.events = (await allOf('events')) || [];
    S.outbox = (await allOf('outbox')) || [];
    // Same rule on the way up from this phone's own storage.
    const rAt = (S.catalog && S.catalog.settings && S.catalog.settings.dataResetAt) || '';
    if (rAt) S.events = S.events.filter(e => String(e.at) >= String(rAt));
    S.events.sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  } catch (e) { console.error(e); }

  // First run: take the master list off the server, or off the file that ships
  // with the app if there is no signal at all.
  let serverHadCatalog = false;
  let serverSaysEmpty = false;
  if (!S.catalog) {
    try {
      const r = await fetch('/api/sync?since=');
      /* Refused means "sign in first", not "the office has nothing". The old
         code read a refusal as an empty office and tried to make the starter
         file the company's list. */
      if (r.status === 401) { S.authRequired = true; await kvSet('authRequired', true); }
      const res = r.ok ? await r.json() : {};
      if (r.ok && res.catalog === null) serverSaysEmpty = true;
      if (res.catalog) {
        S.catalog = res.catalog;
        S.catalogBase = res.catalog;
        serverHadCatalog = true;
        /* Both of these used to be held in memory only, so a phone that opened
           once with signal and again without it came back up with no catalog
           and no baseline at all, and went to the seed. Write them down. */
        try { await kvSet('catalog', S.catalog); await kvSet('catalogBase', S.catalogBase); } catch (e) {}
      }
    } catch (e) {}
  }
  /* Falling back to the file that shipped with the app. It has no jobs in it and
     never will, so it is marked as what it is: a starting point, not a record of
     anything. Nothing derived from it is allowed to be pushed up as though this
     phone knew something the office did not. */
  if (!S.catalog) {
    try { S.catalog = await (await fetch('seed.json')).json(); S.catalogFromSeed = true; } catch (e) {}
  }
  // Last resort, and the one that works when the app is opened straight off the
  // disk with nothing serving it.
  if (!S.catalog && window.AM_SEED) {
    S.catalog = JSON.parse(JSON.stringify(window.AM_SEED));
    S.catalogFromSeed = true;
  }

  // Very first run for the whole company: nobody has put the master list on the
  // server yet, so the copy that shipped with the app becomes it.
  if (S.catalog && !serverHadCatalog && serverSaysEmpty && navigator.onLine && !S.authRequired) {
    try {
      const r = await fetch('/api/sync?since=&catalog=1&events=0');
      const res = r.ok ? await r.json() : null;
      if (res && res.catalog === null) await saveCatalog({ seeding: true });
    } catch (e) {}
  }
  if (!S.catalog) {
    $('#view').innerHTML = `<div class="panel"><h2>Nothing to open yet</h2>
      <p>This phone has never had a signal and the master list is not on it. Get one bar, then open the app again.</p></div>`;
    return;
  }

  S.route = routeOf(location.hash);

  /* One listener for the whole app: a box a person has actually typed in is
     marked, and the screen catches up the moment they leave it. */
  const viewEl = $('#view');
  if (viewEl) {
    viewEl.addEventListener('input', e => {
      const t = e.target;
      if (t && t.id && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) t.dataset.typed = '1';
    }, true);
    viewEl.addEventListener('focusout', () => {
      if (!S.renderHeld) return;
      setTimeout(() => { if (S.renderHeld && !holdingTyping($('#view'))) render(); }, 120);
    }, true);
  }

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
  if (!S.locked && S.me && S.token && goCommand()) return;
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
