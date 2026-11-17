/* A&M - the weekly cash flow, built on Craig's own method.

   Craig's "Cashflow Management Tool" sheet starts each week from the room left
   on the $750,000 line of credit (the bank balance at end of day Sunday plus
   the line), adds what customers will pay that week, takes off what A&M will
   pay, and carries the result into the next week. This does the same, with
   three changes:
     - what customers owe and what A&M owes come straight from QuickBooks, with
       their due dates, so nobody copies them over;
     - anything planned that did not happen (a payment not ticked, a promised
       cheque not in) rolls into the current week by itself;
     - it says in plain words what to pay, what to hold and who to chase.

   Weeks run Monday to Sunday, like the sheet. "This week" is the week that
   starts the Monday after the most recent Sunday, so on a Sunday Craig plans
   the week ahead from that evening's balance.

   COUNTED AND NOT COUNTED
   An invoice or bill is counted in a week when Craig placed it there, or when
   it falls due that week. One that fell due in the last GRACE days (14) and is
   still open rolls into this week. Older ones are not counted in the weeks,
   because a 90-day-old invoice will not arrive just because it is late: they
   are listed to chase (or to pay) until Craig gives them a week. They are
   always in the "if everyone paid me and I paid everyone" line.

   Everything here is a pure function of its inputs, so it can be tested. */

const DAY = 86400000;
export const CATEGORIES = {
  payroll:  { label: "Payroll", must: true },
  source:   { label: "Source deductions", must: true },
  wcb:      { label: "WCB", must: true },
  benefits: { label: "Benefits", must: true },
  subs:     { label: "Internal subcontractors", must: true },
  loans:    { label: "Vehicles and loans", must: true },
  tax:      { label: "GST and taxes", must: true },
  oneoff:   { label: "One-off known payments", must: true },
  running:  { label: "Running costs", must: false },
  owner:    { label: "Owners and related companies", must: false },
  income:   { label: "Other money in", must: false }
};
export const EVERY = ["once", "week", "2weeks", "month"];

const t = d => Date.parse(d + "T12:00:00Z");
export const addDays = (d, n) => new Date(t(d) + n * DAY).toISOString().slice(0, 10);
const dow = d => new Date(t(d)).getUTCDay();             /* 0 Sunday .. 6 Saturday */
export const mondayOf = d => addDays(d, -((dow(d) + 6) % 7));
const r2 = x => Math.round(x * 100) / 100;

/* The Monday that starts "this week". On a Sunday that is tomorrow. */
export function weekZero(today) {
  return dow(today) === 0 ? addDays(today, 1) : mondayOf(today);
}

/* Every date an item falls on between from and to (both YYYY-MM-DD, inclusive). */
export function occurrences(item, from, to) {
  const out = [];
  if (!item || !item.start || !(Number(item.amount) > 0)) return out;
  const end = item.end && item.end < to ? item.end : to;
  if (item.every === "once" || !item.every) { if (item.start >= from && item.start <= end) out.push(item.start); return out; }
  let d = item.start, guard = 0;
  const step = item.every === "week" ? 7 : item.every === "2weeks" ? 14 : 0;
  const [y0, m0, day0] = item.start.split("-").map(Number);
  while (d <= end && guard++ < 400) {
    if (d >= from) out.push(d);
    if (step) d = addDays(d, step);
    else {
      /* monthly: same day of the month, or the month's last day when shorter */
      const k = guard; const y = y0 + Math.floor((m0 - 1 + k) / 12), m = (m0 - 1 + k) % 12;
      const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
      d = `${y}-${String(m + 1).padStart(2, "0")}-${String(Math.min(day0, last)).padStart(2, "0")}`;
    }
  }
  return out;
}

/* The bank balance the room is worked from: the NEWEST figure there is, for
   any day up to today. Craig's typed figure wins while QuickBooks has no bank
   entry on or after its date; QuickBooks wins once Danielle's import has
   passed it.
   Until 2026-11-17 this took the Sunday figure (or the last one before
   Sunday) and ignored a balance typed during the week, so "Room on the line
   now" sat still from Monday to Sunday whatever was typed or ticked. */
export function openingBalance({ today, history, qbo }) {
  const w0 = weekZero(today), sunday = addDays(w0, -1);
  const typed = (history || []).filter(h => h && h.date && h.date <= today).sort((a, b) => b.date.localeCompare(a.date) || String(b.at).localeCompare(String(a.at)));
  const newest = typed[0];
  const q = qbo || {};
  if (newest && (!q.lastEntry || newest.date >= q.lastEntry)) return { amount: newest.amount, date: newest.date, source: "you", sunday: newest.date === sunday, at: newest.at || null };
  if (q.amount !== null && q.amount !== undefined) return { amount: q.amount, date: q.lastEntry || null, source: "quickbooks", sunday: q.lastEntry === sunday, at: null };
  if (newest) return { amount: newest.amount, date: newest.date, source: "you", sunday: newest.date === sunday, at: newest.at || null };
  return { amount: null, date: null, source: "none", sunday: false, at: null };
}

/* Money ticked as received or paid AFTER the bank balance was read. The
   balance cannot know about it yet, so it is added to (or taken off) the room
   straight away: that is what makes the room move the moment Craig ticks
   something, not at the next Sunday.
   moves: [{ key, side:"in"|"out", amount, at, day }]   kept in the plan
   A move counts when it was ticked on a later day than the balance, or on the
   same day but after the balance was typed (when it was typed that day). */
export function movesSince(moves, opening) {
  const out = { in: 0, out: 0, count: 0, list: [] };
  if (!opening || opening.amount === null || opening.amount === undefined || !opening.date) return out;
  for (const m of moves || []) {
    if (!m || !(Number(m.amount) > 0) || !m.day) continue;
    const after = m.day > opening.date || (m.day === opening.date && opening.at && opening.atDay === opening.date && String(m.at) > String(opening.at));
    if (!after) continue;
    out[m.side === "in" ? "in" : "out"] += Number(m.amount); out.count++; out.list.push(m);
  }
  out.in = r2(out.in); out.out = r2(out.out);
  return out;
}

export const docKey = (kind, d) => kind + ":" + [d.type || "", d.num || "", d.name || "", d.date || ""].join("|").toLowerCase();

/* Main build.
   input: { today, weeks, limit, floor, graceDays, opening, invoices, bills, plan }
     invoices: [{ type, num, customer, date, due, open }]   from QuickBooks
     bills:    [{ type, num, vendor, date, due, open }]     from QuickBooks
     plan:     { items:[...], done:{ key: {at,by} }, place:{ key: weekMonday|"later" } } */
export function buildCashFlow(input) {
  const today = input.today, W = Math.max(1, Math.min(13, input.weeks || 4));
  const limit = Number(input.limit) || 750000, floor = Number(input.floor ?? 25000), grace = Number(input.graceDays ?? 14);
  /* Craig's sheet keeps more of the line unused each week ("Amount to stay in
     the LOC", up $5,000 a week): paying the line down. reserveGrowth does the
     same: the reserve in week i is floor + reserveGrowth x i. */
  const growth = Math.max(0, Number(input.reserveGrowth) || 0);
  const plan = input.plan || {}, done = plan.done || {}, place = plan.place || {};
  const w0 = weekZero(today);
  const weeks = Array.from({ length: W }, (_, i) => { const s = addDays(w0, i * 7); return { start: s, end: addDays(s, 6), in: [], out: [] }; });
  const lastEnd = weeks[W - 1].end;
  const weekOf = d => { if (d < w0) return 0; const i = Math.floor((t(d) - t(w0)) / (7 * DAY)); return i < W ? i : -1; };
  const later = { in: [], out: [] };
  const chase = [], lateBills = [];

  /* QuickBooks invoices and bills */
  const place1 = (kind, list, side) => {
    for (const x of list || []) {
      const open = r2(Number(x.open) || 0);
      if (open <= 0.005) continue;
      const name = kind === "inv" ? x.customer : x.vendor;
      const key = docKey(kind, { type: x.type, num: x.num, name, date: x.date });
      if (done[key]) continue;                                   /* ticked by hand, QuickBooks not caught up */
      const due = x.due || x.date;
      const line = { key, kind, name, num: x.num || "", date: x.date || "", due, amount: open,
        movedForGst: kind === "inv" && /-01$/.test(x.date || ""), daysLate: Math.max(0, Math.round((t(w0) - t(due)) / DAY)) };
      const p = place[key];
      if (p === "later") { later[side].push({ ...line, why: "placed later" }); continue; }
      if (p) {
        if (p < w0) { weeks[0][side].push({ ...line, why: "promised for week of " + p + ", not " + (kind === "inv" ? "in" : "paid") + " yet", rolled: true, placed: p }); continue; }
        const i = weekOf(p);
        if (i >= 0) weeks[i][side].push({ ...line, why: "placed by you", placed: p }); else later[side].push({ ...line, why: "placed after these weeks", placed: p });
        continue;
      }
      if (due >= w0) { const i = weekOf(due); if (i >= 0) weeks[i][side].push({ ...line, why: "due " + due }); else later[side].push({ ...line, why: "due " + due }); continue; }
      if (t(w0) - t(due) <= grace * DAY) { weeks[0][side].push({ ...line, why: "was due " + due + ", not " + (kind === "inv" ? "in" : "paid") + " yet", rolled: true }); continue; }
      (kind === "inv" ? chase : lateBills).push(line);
    }
  };
  place1("inv", input.invoices, "in");
  place1("bill", input.bills, "out");

  /* Craig's planned payments (and other money in) */
  const items = (plan.items || []).filter(i => i && i.active !== false);
  const since = addDays(w0, -56);                                /* look back 8 weeks for things missed */
  for (const it of items) {
    const side = it.cat === "income" ? "in" : "out";
    const from = it.since && it.since > since ? it.since : since;
    for (const d of occurrences(it, from, lastEnd)) {
      const key = "item:" + it.id + ":" + d;
      if (done[key]) continue;
      const line = { key, kind: "item", itemId: it.id, name: it.name, cat: it.cat || "running", date: d, amount: r2(Number(it.amount)), every: it.every || "once", note: it.note || "", estimate: !!it.estimate };
      if (d < w0) weeks[0][side].push({ ...line, why: "planned for " + d + ", not ticked yet", rolled: true });
      else weeks[weekOf(d)][side].push({ ...line, why: d });
    }
  }

  /* Totals and the running room on the line */
  const opening = input.opening || { amount: null };
  const moved = movesSince(plan.moves, opening);
  let room = opening.amount === null || opening.amount === undefined ? null : r2(opening.amount + limit + moved.in - moved.out);
  const sum = a => r2(a.reduce((s, x) => s + x.amount, 0));
  for (const w of weeks) {
    w.in.sort((a, b) => b.amount - a.amount); w.out.sort((a, b) => (CAT_ORDER(a) - CAT_ORDER(b)) || b.amount - a.amount);
    w.totalIn = sum(w.in); w.totalOut = sum(w.out);
    w.byCat = {};
    for (const x of w.out) { const c = x.kind === "bill" ? "bills" : x.cat; w.byCat[c] = r2((w.byCat[c] || 0) + x.amount); }
    w.receivables = sum(w.in.filter(x => x.kind === "inv")); w.otherIn = r2(w.totalIn - w.receivables);
    w.open = room; w.close = room === null ? null : r2(room + w.totalIn - w.totalOut); room = w.close;
  }
  weeks.forEach((w, i) => { w.reserve = r2(floor + growth * i); });
  chase.sort((a, b) => b.amount - a.amount); lateBills.sort((a, b) => b.daysLate - a.daysLate || b.amount - a.amount);

  const allIn = sum((input.invoices || []).filter(x => !done[docKey("inv", { type: x.type, num: x.num, name: x.customer, date: x.date })]).map(x => ({ amount: Math.max(0, Number(x.open) || 0) })));
  const allBills = sum((input.bills || []).filter(x => !done[docKey("bill", { type: x.type, num: x.num, name: x.vendor, date: x.date })]).map(x => ({ amount: Math.max(0, Number(x.open) || 0) })));
  const plannedOut = r2(weeks.reduce((s, w) => s + sum(w.out.filter(x => x.kind === "item")), 0));
  const plannedIn = r2(weeks.reduce((s, w) => s + sum(w.in.filter(x => x.kind === "item")), 0));
  const roomNow = opening.amount === null || opening.amount === undefined ? null : r2(opening.amount + limit + moved.in - moved.out);
  const everyone = roomNow === null ? null : { room: roomNow, allIn, allBills, plannedIn, plannedOut, result: r2(roomNow + allIn + plannedIn - allBills - plannedOut) };

  const out = { today, weekZero: w0, limit, floor, reserveGrowth: growth, graceDays: grace, opening, roomNow, sinceBalance: { in: moved.in, out: moved.out, count: moved.count }, weeks, later: { in: later.in, out: later.out, totalIn: sum(later.in), totalOut: sum(later.out) },
    chase, chaseTotal: sum(chase), lateBills, lateBillsTotal: sum(lateBills), everyone };
  out.advice = advise(out);
  return out;
}
/* The look ahead: the same sums carried out to 13 weeks, one line a week,
   for the chart that shows where it gets tight. Each week says whether it
   ends over the line's limit (below zero) or under the reserve.
   WHAT IS IN IT: invoices already sent and bills already entered, on their
   dates, and the planned payments. WHAT IS NOT: work not billed yet. So the
   far weeks read low on money in unless Craig adds "Other money in" lines
   for billing he expects. `known` is how many weeks ahead have invoices;
   `horizon` is how many weeks the headline trusts. */
export function outlookOf(cf) {
  const weeks = (cf.weeks || []).map((w, i) => {
    const reserve = w.reserve ?? cf.floor;
    return { start: w.start, end: w.end, open: w.open, close: w.close, in: w.totalIn, out: w.totalOut, receivables: w.receivables, otherIn: w.otherIn, reserve,
      state: w.close === null ? "none" : w.close < 0 ? "over" : w.close < reserve ? "under" : "ok", i };
  });
  let known = 0; weeks.forEach((w, i) => { if (w.receivables > 0) known = i + 1; });
  /* The weeks that can be trusted: as far ahead as invoices are already sent,
     and never fewer than four. The headline is taken from these. Weeks past
     it are still shown, drawn lighter, because their money in is not known. */
  const horizon = Math.min(weeks.length, Math.max(known, 4));
  weeks.forEach(w => { w.firm = w.i < horizon; });
  const have = weeks.filter(w => w.close !== null), firm = have.filter(w => w.firm);
  const slim = w => w ? { start: w.start, close: w.close, reserve: w.reserve, state: w.state, firm: w.firm } : null;
  const tightest = firm.reduce((lo, w) => (!lo || w.close - w.reserve < lo.close - lo.reserve) ? w : lo, null);
  return { weeks, horizon, known, tightest: slim(tightest), firstUnder: slim(firm.find(w => w.state !== "ok")), firstOver: slim(have.find(w => w.state === "over")),
    laterIn: cf.later.totalIn, laterOut: cf.later.totalOut };
}
/* Every line the build knows, by key, for the amount behind a tick. */
export function findLine(cf, key) {
  for (const w of cf.weeks || []) { for (const x of w.in) if (x.key === key) return { amount: x.amount, side: "in", name: x.name }; for (const x of w.out) if (x.key === key) return { amount: x.amount, side: "out", name: x.name }; }
  for (const x of cf.later.in) if (x.key === key) return { amount: x.amount, side: "in", name: x.name };
  for (const x of cf.later.out) if (x.key === key) return { amount: x.amount, side: "out", name: x.name };
  for (const x of cf.chase || []) if (x.key === key) return { amount: x.amount, side: "in", name: x.name };
  for (const x of cf.lateBills || []) if (x.key === key) return { amount: x.amount, side: "out", name: x.name };
  return null;
}
/* Keep the moves list short: drop those older than 60 days. */
export function tidyMoves(moves, today) {
  const cut = addDays(today, -60);
  return (moves || []).filter(m => m && m.day && m.day >= cut).slice(-400);
}

const ORDER = ["payroll", "source", "wcb", "benefits", "subs", "loans", "tax", "oneoff", "bills", "running", "owner"];
const CAT_ORDER = x => { const i = ORDER.indexOf(x.kind === "bill" ? "bills" : x.cat); return i < 0 ? 99 : i; };

/* What to do this week, in plain words.
   The test is the tightest week of the four, not just this one: paying a bill
   today uses room that payroll needs in two weeks. So:
     headroom = the lowest "room at the end" over the four weeks, less the
                reserve Craig keeps (floor).
   Bills already counted this week are paid while there is headroom; if there
   is not, the newest of them are held first (AP Solutions last, because it
   charges interest). Late bills with no date are added, in the order that
   costs A&M most if they slip, while headroom lasts. */
const SAY = { payroll: "payroll", source: "source deductions", wcb: "WCB", benefits: "benefits", subs: "internal subcontractors", loans: "vehicle and loan payments", tax: "GST and taxes", oneoff: "one-off payments", running: "running costs", owner: "owner payments" };
export function advise(cf) {
  const w = cf.weeks[0];
  if (!w || w.open === null) return { lines: ["Type Sunday's bank balance under Money, Cash position, so the weeks have a starting point."], pay: [], hold: [], chase: [], must: [] };
  const M = v => (v < 0 ? "-$" : "$") + Math.abs(Math.round(v)).toLocaleString("en-CA");
  const day = d => new Date(Date.parse(d + "T12:00:00Z")).toLocaleDateString("en-CA", { month: "long", day: "numeric", timeZone: "UTC" });
  const names = list => list.slice(0, 3).map(x => x.name + " " + M(x.amount)).join(", ") + (list.length > 3 ? ", and " + (list.length - 3) + " more" : "");
  const must = w.out.filter(x => x.kind === "item" && CATEGORIES[x.cat] && CATEGORIES[x.cat].must);
  const mustTotal = must.reduce((s, x) => s + x.amount, 0);
  const res = x => x.reserve ?? cf.floor;
  const tight = cf.weeks.reduce((lo, x) => (x.close !== null && (lo === null || x.close - res(x) < lo.close - res(lo))) ? x : lo, null);
  let headroom = (tight ? tight.close - res(tight) : w.close - cf.floor);
  const pri = b => /ap solutions/i.test(b.name) ? 0 : 1;
  const byPriority = (a, b) => pri(a) - pri(b) || (b.daysLate || 0) - (a.daysLate || 0) || b.amount - a.amount;
  const counted = w.out.filter(x => x.kind === "bill").sort(byPriority);
  const pay = counted.slice(), hold = [];
  /* Not enough room: hold this week's bills, lowest priority first. */
  while (headroom < 0 && pay.length) { const b = pay.pop(); hold.unshift(b); headroom += b.amount; }
  /* Room to spare: pay late bills, highest priority first. */
  const extra = [];
  for (const b of cf.lateBills.slice().sort(byPriority)) { if (headroom - b.amount >= 0) { extra.push(b); headroom -= b.amount; } else hold.push(b); }
  const chase = cf.chase.filter(x => x.daysLate > 30).slice(0, 3).concat(cf.chase.filter(x => x.daysLate <= 30)).slice(0, 3);
  const promisedLate = w.in.filter(x => x.rolled && x.kind === "inv");
  const lines = [];
  const kinds = [...new Set(must.map(x => SAY[x.cat] || x.cat))];
  lines.push(`You have ${M(w.open)} of room on the line now. ${M(w.totalIn)} is expected in, and ${M(mustTotal)} has to go out${kinds.length ? " for " + kinds.join(", ") : ""}.`);
  if (tight) lines.push(`The tightest week is the week of ${day(tight.start)}. ${tight.close < 0 ? "As things stand it ends " + M(-tight.close) + " over the line's limit." : "As things stand it ends with " + M(tight.close) + " of room."}`);
  const payAll = pay.concat(extra);
  if (payAll.length) lines.push(`You can pay ${payAll.length === 1 ? "this bill" : "these " + payAll.length + " bills"}: ${names(payAll)}. That keeps ${cf.reserveGrowth ? "the reserve, growing " + M(cf.reserveGrowth) + " a week," : "at least " + M(cf.floor) + " of room"} in every one of the four weeks.`);
  else if (counted.length || cf.lateBills.length) lines.push(`Hold the supplier bills this week. Paying any of them would take the room below the ${M(cf.floor)} you keep in reserve before the month is out.`);
  if (hold.length && payAll.length) lines.push(`Hold ${hold.length === 1 ? "this one" : "these"} for now: ${names(hold)}.`);
  if (chase.length) lines.push(`Chase ${chase.length === 1 ? "this one" : "these " + chase.length}: ${chase.map(x => x.name + " " + M(x.amount) + " (" + x.daysLate + " days late)").join(", ")}.`);
  if (promisedLate.length) lines.push(`${names(promisedLate)} ${promisedLate.length === 1 ? "was" : "were"} expected and ${promisedLate.length === 1 ? "has" : "have"} not come in. It rolled into this week.`);
  if (headroom < 0) lines.push(`Even with every bill held, the week of ${day(tight ? tight.start : w.start)} is ${M(-headroom)} short of the ${M(tight ? res(tight) : cf.floor)} you keep in reserve. Something else has to move: a customer payment brought forward, or an owner payment held.`);
  return { lines, pay: payAll, hold: hold.slice(0, 10), chase, must, tightest: tight ? { week: tight.start, close: tight.close } : null, headroomLeft: Math.round(headroom) };
}

/* ------------------------------------------------------------- the plan */
export function cleanItem(b, today) {
  const name = String(b.name || "").trim().slice(0, 80);
  if (!name) return { ok: false, message: "Give the payment a name." };
  const amount = Number(String(b.amount ?? "").replace(/[$,\s]/g, ""));
  if (!isFinite(amount) || amount <= 0 || amount > 5000000) return { ok: false, message: "The amount must be a number above zero." };
  const every = EVERY.includes(b.every) ? b.every : "once";
  const start = String(b.start || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || isNaN(t(start))) return { ok: false, message: "The date must look like 2026-11-21." };
  const end = b.end && /^\d{4}-\d{2}-\d{2}$/.test(b.end) ? b.end : "";
  const cat = CATEGORIES[b.cat] ? b.cat : "running";
  return { ok: true, value: { name, amount: r2(amount), every, start, end, cat, note: String(b.note || "").slice(0, 200), active: b.active !== false } };
}
