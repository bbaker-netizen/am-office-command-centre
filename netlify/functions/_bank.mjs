/* A&M - cash in the bank: QuickBooks, or the balance Craig typed in.

   WHY THIS EXISTS
   A&M's corporate BMO account does not feed into QuickBooks. Danielle (the
   outside bookkeeper) imports the BMO transactions by hand at the start of her
   Tuesday slot. So the bank balance in QuickBooks is always up to a week old,
   and the cash figure jumped around for weeks (-$400K, then +$600K, then
   +$395K; on 2026-11-10 one screen said 528 and another -519).

   Craig can now type the real balance from the bank, with its date. The
   command centre shows whichever is newer:
     - Craig's figure, while QuickBooks has no bank entry on or after its date;
     - QuickBooks again, once Danielle's import has caught up to that date.
   Both are always shown, with their dates, so nobody has to guess.

   WHERE IT LIVES
   One record in the app's store, "bank-actual": { current, history }. The
   history (last 60 entries) is what the weekly cash flow starts from. */

export const KEY = "bank-actual";
const DAY = 86400000;

export function dayDiff(a, b) {
  const x = Date.parse(a + "T12:00:00Z"), y = Date.parse(b + "T12:00:00Z");
  if (isNaN(x) || isNaN(y)) return null;
  return Math.round((y - x) / DAY);
}

/* What a person typed, checked. Returns { ok, value } or { ok:false, message }. */
export function cleanActual(body, today) {
  const raw = String(body && body.amount !== undefined ? body.amount : "").replace(/[$,\s]/g, "");
  const neg = /^\(.*\)$/.test(raw);
  const amount = Number(raw.replace(/[()]/g, "")) * (neg ? -1 : 1);
  if (raw === "" || !isFinite(amount)) return { ok: false, message: "Type the balance as a number, for example -540000 or 25,000." };
  if (Math.abs(amount) > 20000000) return { ok: false, message: "That balance looks too large. Check the number." };
  const date = String((body && body.date) || today);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { ok: false, message: "The date must look like 2026-11-15." };
  const d = dayDiff(date, today);
  if (d === null) return { ok: false, message: "That date is not a real date." };
  if (d < 0) return { ok: false, message: "The date cannot be in the future." };
  if (d > 60) return { ok: false, message: "That date is more than 60 days ago." };
  const note = String((body && body.note) || "").trim().slice(0, 200);
  return { ok: true, value: { amount: Math.round(amount * 100) / 100, date, note } };
}

/* QuickBooks Account query -> the bank accounts with their balances. */
export function readBankAccounts(resp) {
  const list = (resp && resp.QueryResponse && resp.QueryResponse.Account) || [];
  return list.filter(a => a.Active !== false).map(a => ({
    id: String(a.Id), name: a.FullyQualifiedName || a.Name || "", balance: Number(a.CurrentBalance) || 0,
    changedAt: (a.MetaData && a.MetaData.LastUpdatedTime) || null
  }));
}

/* General ledger for the bank accounts -> the newest transaction date in it,
   which is how far Danielle's import has reached. Report shapes vary, so this
   looks at every cell for a date and keeps the newest one not after today.
   With `names`, only sections headed by one of the bank accounts count, so a
   ledger that came back with every account (invoices dated today) cannot make
   QuickBooks look caught up when the bank is not. */
export function lastEntryDate(rep, today, names) {
  let best = null;
  const want = (names || []).map(x => String(x).toLowerCase().split(":").pop().trim()).filter(Boolean);
  const heading = r => String((r.Header && r.Header.ColData && r.Header.ColData[0] && r.Header.ColData[0].value) || "").toLowerCase();
  const isBank = r => want.some(w => heading(r).includes(w));
  const walk = (rows, inBank) => {
    for (const r of rows || []) {
      const here = inBank || !want.length || (r.Header && isBank(r));
      if (here) for (const c of r.ColData || []) {
        const v = String((c && c.value) || "");
        if (/^\d{4}-\d{2}-\d{2}$/.test(v) && (!today || v <= today) && (!best || v > best)) best = v;
      }
      if (r.Rows && r.Rows.Row) walk(r.Rows.Row, here);
    }
  };
  walk(rep && rep.Rows && rep.Rows.Row, false);
  return best;
}

/* Which cash figure the command centre leads with.
   qbo: { amount, lastEntry }   actual: { amount, date, by, at } or null */
export function pickCash({ qbo, actual, today }) {
  const q = qbo || {};
  const out = { qbo: { amount: q.amount ?? null, lastEntry: q.lastEntry || null }, actual: actual || null };
  if (!actual) return { ...out, amount: q.amount ?? null, source: "quickbooks", date: q.lastEntry || null };
  const caughtUp = q.lastEntry && q.amount !== null && q.amount !== undefined && q.lastEntry >= actual.date;
  if (caughtUp) return { ...out, amount: q.amount, source: "quickbooks", date: q.lastEntry, caughtUp: true };
  const age = dayDiff(actual.date, today);
  return {
    ...out, amount: actual.amount, source: "you", date: actual.date, ageDays: age, stale: age !== null && age > 7,
    gap: (q.amount !== null && q.amount !== undefined) ? Math.round((actual.amount - q.amount) * 100) / 100 : null
  };
}

/* Save a new figure; keeps the last 60. */
export function addActual(doc, value, who, nowIso) {
  const entry = { ...value, by: who, at: nowIso };
  const history = [entry].concat(((doc && doc.history) || [])).slice(0, 60);
  /* The current figure is the one with the newest date (a late entry for an
     older day does not replace a newer one). */
  const current = history.slice().sort((a, b) => (b.date.localeCompare(a.date)) || (b.at.localeCompare(a.at)))[0];
  return { current, history };
}

export function clearActual(doc) {
  return { current: null, history: (doc && doc.history) || [] };
}
