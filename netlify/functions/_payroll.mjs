/* A&M - the payroll split, worked out from JobTread timesheets.

   Danielle (Your Tax Gal) needs, for each pay period, every employee's hours
   split into the cost of sales buckets: each service line, Edmonton or
   Calgary, with shop, office, training and safety time kept apart so it can
   stay in general payroll expense. QuickBooks payroll can only code a pay
   cheque to one class, so today that split is typed by hand into the Net
   Payroll by Period sheet and posted as a journal entry. This file does the
   split. payroll.mjs serves it and posts the entry through A&M's QuickBooks
   connection.

   Pure functions only, so the rules can be tested without JobTread or
   QuickBooks.

   The rules, agreed 2026-10-10:
   - Service line comes from the cost code on the time entry (51 Demolition,
     53 Asbestos, 54 Lead, 55 Mould, 56 Sampling, 59 Restoration, anything
     else Other), not the job type, so combined jobs split correctly.
   - City comes from the job's Estimating branch field. If it is blank, a job
     whose address city is Calgary goes to Calgary and everything else to
     Edmonton, and the job is listed so the field can be filled in.
   - The overhead jobs in settings (General Shop and Office Work to start with)
     always stay in general payroll, whatever cost code is on the entry.
   - Time entry types with "temp" in the name are ACES staffing, not A&M
     payroll, and are reported separately.
   - Anyone still clocked in is left out until they clock out.
   - Overtime counts at the multiplier (1.5) when the pay is split, because
     an overtime hour costs one and a half regular hours. */

export const LINE_BY_DIVISION = { "51": "Demolition", "53": "Asbestos", "54": "Lead", "55": "Mould", "56": "Sampling", "59": "Restoration" };
export const LINES = ["Demolition", "Asbestos", "Lead", "Mould", "Sampling", "Restoration", "Other"];
export const CITIES = ["Edmonton", "Calgary"];
export const COS_BUCKETS = LINES.flatMap(l => CITIES.map(c => `${l} ${c}`));

export const DEFAULTS = {
  anchor: "2026-09-28",          /* first day of a pay period; periods run 14 days from here */
  periodDays: 14,
  otMultiplier: 1.5,
  tz: "America/Edmonton",
  overheadJobs: { "26-00000": "Shop (overhead)", "26-0000": "Office and admin" },
  map: {},                       /* bucket -> { accountId, accountName, classId, className, departmentId, departmentName } */
  credit: null                   /* { accountId, accountName, classId, className } the payroll expense line the entry takes the money out of */
};

export function withDefaults(s) {
  const out = { ...DEFAULTS, ...(s || {}) };
  out.overheadJobs = { ...(s && s.overheadJobs ? s.overheadJobs : DEFAULTS.overheadJobs) };
  out.map = { ...(s && s.map ? s.map : {}) };
  return out;
}

export function overheadBuckets(settings) {
  return [...new Set(Object.values(settings.overheadJobs))];
}
export function allBuckets(settings) {
  return COS_BUCKETS.concat(overheadBuckets(settings));
}

/* ----------------------------------------------------------- dates */
const DAY = 86400000;
const isDate = s => /^\d{4}-\d{2}-\d{2}$/.test(String(s || ""));
const dayNum = s => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / DAY;
const dayStr = n => new Date(n * DAY).toISOString().slice(0, 10);

/* The UTC instant of local midnight on a date in a time zone. */
export function localMidnightUtc(date, tz) {
  const guess = dayNum(date) * DAY;
  const f = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const p = Object.fromEntries(f.formatToParts(new Date(guess)).map(x => [x.type, x.value]));
  const shown = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute);
  return new Date(guess - (shown - guess));
}

/* The pay period containing `date` (or the one starting there). */
export function periodFor(date, settings) {
  const s = withDefaults(settings);
  const d = isDate(date) ? date : dayStr(Math.floor(Date.now() / DAY));
  const a = dayNum(s.anchor), n = dayNum(d);
  const k = Math.floor((n - a) / s.periodDays);
  const start = dayStr(a + k * s.periodDays), end = dayStr(a + k * s.periodDays + s.periodDays - 1);
  return {
    start, end,
    startUtc: localMidnightUtc(start, s.tz).toISOString(),
    endUtc: localMidnightUtc(dayStr(dayNum(end) + 1), s.tz).toISOString(),
    previous: dayStr(dayNum(start) - s.periodDays),
    next: dayStr(dayNum(start) + s.periodDays)
  };
}

/* ----------------------------------------------------------- classify */
export const isTemp = type => /temp/i.test(String(type || ""));
export const isOvertime = type => /overtime/i.test(String(type || ""));

function branchOf(job) {
  const v = job && job.customFieldValues && job.customFieldValues.nodes && job.customFieldValues.nodes[0];
  const b = v && String(v.value || "").trim();
  return CITIES.includes(b) ? b : null;
}

export function classify(entry, settings) {
  const job = entry.job || {};
  const number = String(job.number || "");
  if (settings.overheadJobs[number]) return { bucket: settings.overheadJobs[number], overhead: true, assumed: false };
  const code = String((entry.costItem && entry.costItem.costCode && entry.costItem.costCode.number) || "");
  const line = LINE_BY_DIVISION[code.slice(0, 2)] || "Other";
  let city = branchOf(job), assumed = false;
  if (!city) { assumed = true; city = /^calgary$/i.test(String((job.location && job.location.city) || "").trim()) ? "Calgary" : "Edmonton"; }
  return { bucket: `${line} ${city}`, overhead: false, assumed, noCode: !code };
}

/* ----------------------------------------------------------- the report */
const h = m => Math.round(m / 60 * 100) / 100;

export function buildReport(entries, settingsIn, period) {
  const settings = withDefaults(settingsIn);
  const buckets = allBuckets(settings);
  const emp = new Map(), temps = new Map(), detail = new Map();
  const open = [], assumedJobs = new Map(), conflicts = new Map(), noCode = [];

  for (const e of entries || []) {
    const user = (e.user && e.user.name) || "Unknown person";
    const job = e.job || {};
    if (!e.endedAt) {
      open.push({ person: user, job: job.number || "", jobName: job.name || "", since: e.startedAt, temp: isTemp(e.type) });
      continue;
    }
    const c = classify(e, settings);
    const mins = Math.max(0, Math.round(Number(e.minutes) || 0));
    const ot = isOvertime(e.type);
    if (c.assumed && job.number) assumedJobs.set(job.number, { job: job.number, jobName: job.name || "", city: (job.location && job.location.city) || "", countedAs: c.bucket.split(" ").pop() });
    const br = branchOf(job), city = job.location && job.location.city;
    if (br && city && CITIES.includes(city) && city !== br && !settings.overheadJobs[job.number]) conflicts.set(job.number, { job: job.number, jobName: job.name || "", branch: br, city });
    if (c.noCode) noCode.push({ person: user, job: job.number || "" });

    if (isTemp(e.type)) {
      const t = temps.get(user) || { name: user, minutes: 0, byBucket: {} };
      t.minutes += mins; t.byBucket[c.bucket] = (t.byBucket[c.bucket] || 0) + mins; temps.set(user, t);
      continue;
    }
    const r = emp.get(user) || { name: user, userId: e.user && e.user.id, reg: 0, ot: 0, unapproved: 0, byBucket: {} };
    if (ot) r.ot += mins; else r.reg += mins;
    if (!e.isApproved) r.unapproved += mins;
    const b = r.byBucket[c.bucket] || { reg: 0, ot: 0 };
    if (ot) b.ot += mins; else b.reg += mins;
    r.byBucket[c.bucket] = b; emp.set(user, r);

    const code = (e.costItem && e.costItem.costCode) || {};
    const k = [user, job.number, code.number || ""].join("|");
    const d = detail.get(k) || { person: user, job: job.number || "", jobName: job.name || "", costCode: [code.number, code.name].filter(Boolean).join(" "), bucket: c.bucket, assumed: c.assumed, reg: 0, ot: 0, unapproved: 0 };
    if (ot) d.ot += mins; else d.reg += mins;
    if (!e.isApproved) d.unapproved += mins;
    detail.set(k, d);
  }

  const mult = Number(settings.otMultiplier) || 1;
  const employees = [...emp.values()].sort((a, b) => a.name.localeCompare(b.name)).map(r => {
    const pay = r.reg + mult * r.ot;
    const byBucket = {}, share = {};
    for (const b of buckets) {
      const x = r.byBucket[b]; if (!x) continue;
      byBucket[b] = { reg: h(x.reg), ot: h(x.ot), total: h(x.reg + x.ot) };
      share[b] = pay ? (x.reg + mult * x.ot) / pay : 0;
    }
    return { name: r.name, userId: r.userId, regular: h(r.reg), overtime: h(r.ot), total: h(r.reg + r.ot), unapproved: h(r.unapproved), payHours: h(pay), byBucket, share };
  });
  const bucketTotals = {};
  for (const b of buckets) bucketTotals[b] = h([...emp.values()].reduce((s, r) => s + (r.byBucket[b] ? r.byBucket[b].reg + r.byBucket[b].ot : 0), 0));
  const totalMin = [...emp.values()].reduce((s, r) => s + r.reg + r.ot, 0);

  return {
    period, buckets, cosBuckets: COS_BUCKETS, overheadBuckets: overheadBuckets(settings), otMultiplier: mult,
    employees,
    totals: { hours: h(totalMin), unapproved: h([...emp.values()].reduce((s, r) => s + r.unapproved, 0)), byBucket: bucketTotals, people: employees.length },
    detail: [...detail.values()].sort((a, b) => a.person.localeCompare(b.person) || a.job.localeCompare(b.job)).map(d => ({ ...d, reg: h(d.reg), ot: h(d.ot), total: h(d.reg + d.ot), unapproved: h(d.unapproved) })),
    temps: [...temps.values()].sort((a, b) => a.name.localeCompare(b.name)).map(t => ({ name: t.name, total: h(t.minutes), byBucket: Object.fromEntries(Object.entries(t.byBucket).map(([k, v]) => [k, h(v)])) })),
    tempHours: h([...temps.values()].reduce((s, t) => s + t.minutes, 0)),
    open: open.sort((a, b) => String(a.since).localeCompare(String(b.since))),
    assumedJobs: [...assumedJobs.values()].sort((a, b) => a.job.localeCompare(b.job)),
    conflicts: [...conflicts.values()],
    noCode
  };
}

/* ----------------------------------------------------------- the journal entry */
const cents = v => Math.round(v * 100);

/* costs: { "Employee name": 2400.00, ... } typed by Danielle from QuickBooks payroll.
   Returns the entry ready to post, or the reasons it cannot be posted yet. */
export function buildJournal(report, costs, settingsIn) {
  const settings = withDefaults(settingsIn);
  const errors = [], perEmployee = [], byBucket = {};
  for (const b of COS_BUCKETS) byBucket[b] = 0;

  for (const e of report.employees) {
    const raw = costs ? costs[e.name] : undefined;
    if (raw === undefined || raw === null || raw === "") { errors.push(`No payroll cost typed for ${e.name}.`); continue; }
    const cost = Number(raw);
    if (!isFinite(cost) || cost < 0) { errors.push(`The payroll cost for ${e.name} is not a number.`); continue; }
    const total = cents(cost);
    /* Split the whole cost across every bucket (overhead included) so it adds up
       to the cent, then only the cost of sales part moves. */
    const parts = Object.entries(e.share).map(([b, s]) => ({ b, c: Math.floor(total * s), r: total * s - Math.floor(total * s) }));
    let left = total - parts.reduce((s, p) => s + p.c, 0);
    parts.sort((x, y) => y.r - x.r).forEach(p => { if (left > 0) { p.c += 1; left -= 1; } });
    const row = { name: e.name, cost: total / 100, buckets: {} };
    for (const p of parts) { row.buckets[p.b] = p.c / 100; if (byBucket[p.b] !== undefined) byBucket[p.b] += p.c; }
    row.moved = COS_BUCKETS.reduce((s, b) => s + (row.buckets[b] ? cents(row.buckets[b]) : 0), 0) / 100;
    perEmployee.push(row);
  }
  for (const name of Object.keys(costs || {})) {
    if (!report.employees.some(e => e.name === name) && costs[name] !== "" && costs[name] !== null) errors.push(`${name} has a cost typed but no hours in this period.`);
  }

  const lines = [];
  for (const b of COS_BUCKETS) {
    const amt = byBucket[b]; if (!amt) continue;
    const m = settings.map[b];
    if (!m || !m.accountId) { errors.push(`${b} has no QuickBooks account chosen yet. Set it under Payroll settings.`); continue; }
    lines.push({ bucket: b, amount: amt / 100, posting: "Debit", accountId: m.accountId, accountName: m.accountName, classId: m.classId || null, className: m.className || null, departmentId: m.departmentId || null, departmentName: m.departmentName || null });
  }
  const moved = lines.reduce((s, l) => s + cents(l.amount), 0);
  if (!settings.credit || !settings.credit.accountId) errors.push("The payroll expense account the money comes out of is not chosen yet. Set it under Payroll settings.");
  else if (moved) lines.push({ bucket: "Payroll expense", amount: moved / 100, posting: "Credit", accountId: settings.credit.accountId, accountName: settings.credit.accountName, classId: settings.credit.classId || null, className: settings.credit.className || null, departmentId: null });

  const p = report.period;
  const docNumber = "PAYSPLIT-" + p.start.replace(/-/g, "").slice(2);
  const payload = {
    TxnDate: p.end,
    DocNumber: docNumber,
    PrivateNote: `Payroll split to cost of sales, pay period ${p.start} to ${p.end}. From JobTread timesheets through the A&M app.`,
    Line: lines.map((l, i) => ({
      Id: String(i),
      DetailType: "JournalEntryLineDetail",
      Amount: l.amount,
      Description: l.posting === "Debit" ? `${l.bucket} labour, pay period ${p.start} to ${p.end}` : `Payroll moved to cost of sales, ${p.start} to ${p.end}`,
      JournalEntryLineDetail: Object.assign(
        { PostingType: l.posting, AccountRef: { value: String(l.accountId) } },
        l.classId ? { ClassRef: { value: String(l.classId) } } : {},
        l.departmentId ? { DepartmentRef: { value: String(l.departmentId) } } : {}
      )
    }))
  };
  return { ok: errors.length === 0 && moved > 0, errors, lines, perEmployee, moved: moved / 100, docNumber, payload };
}
