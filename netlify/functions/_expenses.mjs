/* A&M - km, reimbursements, company card and shop spending, worked out from
   JobTread. Pure functions only, so the rules can be tested without JobTread.

   Built 2026-11-10 from Jen's spec of 28 October (forms, card list, branch,
   exceptions) and Bruce's additions. Who uses it:
   - Brenda: the monthly payout list. Km and reimbursements stay out of payroll
     and are paid once a month.
   - Craig: every cost on the right branch, Edmonton or Calgary, using the same
     rule as the payroll split (the job's Estimating branch field).

   Where each figure comes from:
   - Personal vehicle KM log form (job). Owed = approved regular km x rate plus
     approved trailer km x trailer rate, worked out here. The PM's typed
     "Amount owed" is compared with it, never trusted on its own.
   - Job expense reimbursement form (job). Owed = Total.
   - Company card: draft Expense bills on jobs, with the card's last 4 in the
     bill description or in the payment's reference.
   - Shop and equipment purchase form (no job). Its own Branch field.
   - The card list is read from the shop form's "Company card used" dropdown,
     so when Jen adds a card there it shows here. No second copy of the list.

   Nothing here writes to JobTread or QuickBooks. */

export const RATES = { regular: 0.70, trailer: 0.90 };
export const OVERHEAD_JOBS = ["26-00000", "26-0000"];
export const CITIES = ["Edmonton", "Calgary"];
export const NO_BRANCH = "No branch";
export const PHOTO_RULE_FROM = "2026-11-01";

const r2 = x => Math.round((Number(x) || 0) * 100) / 100;
const num = v => { const n = Number(v); return isFinite(n) ? n : null; };
const one = v => Array.isArray(v) ? (v[0] == null ? "" : String(v[0])) : (v == null ? "" : String(v));
const day = v => (v ? String(v).slice(0, 10) : "");
const month = v => day(v).slice(0, 7);
const yes = v => v === true || /^(true|yes)$/i.test(one(v));
const files = v => Array.isArray(v) ? v.filter(f => f && (f.url || f.storageId)).length : 0;
const daysBetween = (a, b) => Math.floor((Date.parse(b) - Date.parse(a)) / 86400000);

export const isSpecialJob = j => !!j && (/^99-/.test(j.number || "") || /^test\b/i.test(j.name || ""));
export const isOverheadJob = j => !!j && OVERHEAD_JOBS.includes(String(j.number || ""));
export const isOldJob = j => !!j && /-OLD$/i.test(String(j.number || ""));

/* The branch a job's cost lands on. Same rule as payroll: the Estimating
   branch field. Overhead jobs and jobs with it blank are "No branch", shown
   as their own column so unsplit money is visible instead of dropped. */
export function branchOfJob(j) {
  if (!j || isOverheadJob(j)) return NO_BRANCH;
  return CITIES.includes(j.branch) ? j.branch : NO_BRANCH;
}

/* ------------------------------------------------------------ cards */
/* "0740 Mark" from the shop form's dropdown. */
export function parseCards(options) {
  return (options || []).map(o => String(o)).map(o => { const m = o.match(/^\s*(\d{4})\s+(.+?)\s*$/); return m ? { last4: m[1], holder: m[2] } : null; }).filter(Boolean);
}
/* A card number written on purpose: "Card 9726", "Visa 9726", "cc 9726",
   "ending in 9726", "last 4 9726", or a reference that is only the four
   digits. A street number such as "7712 Saskatchewan Drive" is not read as a
   card: a bare 4-digit number only counts when it is the whole reference. */
const CARD_WORDS = /(?:card|visa|mastercard|master card|\bmc\b|\bcc\b|credit|ending(?:\s+in)?|last\s*4(?:\s*digits)?)\D{0,12}(\d{4})(?!\d)/gi;
export function findLast4(text) {
  const s = String(text || "");
  const out = [];
  let m; CARD_WORDS.lastIndex = 0;
  while ((m = CARD_WORDS.exec(s))) out.push(m[1]);
  const bare = s.trim().match(/^#?\s*(\d{4})$/);
  if (bare) out.push(bare[1]);
  return [...new Set(out)];
}
export function cardOfBill(b) {
  const fromPay = (b.payments || []).flatMap(p => findLast4(p.description));
  if (fromPay.length) return { last4: fromPay[0], from: "payment reference" };
  const fromDesc = findLast4(b.description);
  if (fromDesc.length) return { last4: fromDesc[0], from: "bill description" };
  return null;
}
/* An Expense bill that books an approved km or reimbursement claim, not a card purchase. */
export const isClaimBooking = b => /\b(km|kms|kilomet\w*|mileage|reimburs\w*|claim)\b/i.test(String(b.description || ""))
  || (b.payments || []).some(p => /\b(personal|pay to|reimburs\w*)\b/i.test(String(p.description || "")));

/* ------------------------------------------------------------ claims */
export function readKm(sub, rates = RATES) {
  const v = sub.values || {};
  const status = one(v["Status"]);
  const regC = num(v["Regular km (no trailer)"]) || 0, trlC = num(v["Trailer km"]) || 0;
  const regA = num(v["Approved regular km"]), trlA = num(v["Approved trailer km"]);
  const approvedFilled = regA !== null || trlA !== null;
  const reg = approvedFilled ? (regA || 0) : regC, trl = approvedFilled ? (trlA || 0) : trlC;
  const owed = r2(reg * rates.regular + trl * rates.trailer);
  const typed = num(v["Amount owed"]);
  const start = num(v["Start odometer reading"]), end = num(v["End odometer reading"]);
  return {
    kind: "km", id: sub.id, person: (sub.user && sub.user.name) || "Unknown", job: sub.job || null,
    date: day(v["Date of trips"]) || day(sub.createdAt), submitted: day(sub.createdAt),
    status, regClaimed: regC, trlClaimed: trlC, reg, trl, approvedFilled, owed, typed,
    start, end, trip: String(v["Trip details"] || "").trim(),
    photos: files(v["Start odometer photo"]) + files(v["End odometer photo"]),
    inBudget: yes(v["Added to job budget in JobTread"]), paidDate: day(v["Pay period paid"]),
    branch: branchOfJob(sub.job)
  };
}
export function readReimb(sub) {
  const v = sub.values || {};
  return {
    kind: "reimbursement", id: sub.id, person: (sub.user && sub.user.name) || "Unknown", job: sub.job || null,
    date: day(v["Date of purchase"]) || day(sub.createdAt), submitted: day(sub.createdAt),
    status: one(v["Status"]), vendor: String(v["Store or vendor"] || ""), type: one(v["Type"]),
    beforeGst: num(v["Amount before GST"]), gst: num(v["GST"]), total: num(v["Total"]) || 0, owed: r2(num(v["Total"]) || 0),
    notes: String(v["Notes"] || ""), photos: files(v["Receipt photo"]),
    inBudget: yes(v["Added to job budget in JobTread"]), paidDate: day(v["Reimbursed date"]),
    branch: branchOfJob(sub.job)
  };
}
export function readShop(sub) {
  const v = sub.values || {};
  const card = one(v["Company card used"]);
  return {
    kind: "shop", id: sub.id, person: (sub.user && sub.user.name) || "Unknown",
    date: day(v["Date of purchase"]) || day(sub.createdAt), submitted: day(sub.createdAt),
    status: one(v["Status"]), vendor: String(v["Store or vendor"] || ""), what: String(v["What is it for"] || ""),
    total: num(v["Total"]) || 0, paidWith: one(v["Paid with"]), card, cardLast4: (card.match(/^(\d{4})\b/) || [])[1] || "",
    notes: String(v["Notes"] || ""), photos: files(v["Receipt photo"]),
    paidDate: day(v["Reimbursed date (personal card or cash only)"]),
    branch: CITIES.includes(one(v["Branch"])) ? one(v["Branch"]) : NO_BRANCH
  };
}

const approvedish = s => /^(approved)$/i.test(s);
const done = s => /^(paid|filed)/i.test(s);
const counts = s => approvedish(s) || done(s);
const sentBack = s => /sent back/i.test(s || "");

/* ------------------------------------------------------------ the report */
export function buildExpenses(input, opts = {}) {
  const today = opts.today || new Date().toISOString().slice(0, 10);
  const rates = { ...RATES, ...(opts.rates || {}) };
  const cards = input.cards || [];
  const cardBy = Object.fromEntries(cards.map(c => [c.last4, c.holder]));
  const km = (input.km || []).map(s => readKm(s, rates));
  const re = (input.reimb || []).map(readReimb);
  const shop = (input.shop || []).map(readShop);
  const bills = (input.bills || []).map(b => ({ ...b, branch: branchOfJob(b.job), card: cardOfBill(b), claim: isClaimBooking(b) }));
  const ex = [];
  const add = (kind, level, what, item, detail) => ex.push({ kind, level, what, detail: detail || "", person: item && item.person || "", job: item && item.job ? (item.job.number || "") : "", jobName: item && item.job ? (item.job.name || "") : "", date: item && item.date || "", id: item && item.id || "" });

  /* 1. Brenda's payout list: approved, not yet paid. No month filter, so a
     late approval is never missed. */
  const payout = new Map();
  const owe = c => {
    const p = payout.get(c.person) || { person: c.person, km: 0, reimbursements: 0, total: 0, byBranch: {}, items: [] };
    if (c.kind === "km") p.km = r2(p.km + c.owed); else p.reimbursements = r2(p.reimbursements + c.owed);
    p.total = r2(p.km + p.reimbursements);
    p.byBranch[c.branch] = r2((p.byBranch[c.branch] || 0) + c.owed);
    p.items.push({ kind: c.kind, id: c.id, date: c.date, job: c.job ? c.job.number : "", jobName: c.job ? c.job.name : "", branch: c.branch, owed: c.owed, detail: c.kind === "km" ? `${c.reg} km${c.trl ? ` + ${c.trl} trailer km` : ""}` : c.vendor });
    payout.set(c.person, p);
  };
  km.filter(c => approvedish(c.status)).forEach(owe);
  re.filter(c => approvedish(c.status)).forEach(owe);
  /* Shop purchases on someone's own card or cash are owed back too. */
  shop.filter(c => approvedish(c.status) && /personal/i.test(c.paidWith)).forEach(c => owe({ ...c, kind: "reimbursement", owed: r2(c.total), job: { number: "Shop", name: c.what } }));

  /* 2. Branch totals by month, from the trip or purchase date: when the cost
     hit the job. Claims count once approved; card bills once logged. */
  const totals = {};
  const put = (date, cat, branch, amt) => {
    const m = month(date) || "No date";
    const t = totals[m] || (totals[m] = { month: m, km: {}, reimbursements: {}, card: {}, shop: {} });
    t[cat][branch] = r2((t[cat][branch] || 0) + amt);
  };
  km.filter(c => counts(c.status)).forEach(c => put(c.date, "km", c.branch, c.owed));
  re.filter(c => counts(c.status)).forEach(c => put(c.date, "reimbursements", c.branch, c.owed));
  shop.filter(c => counts(c.status)).forEach(c => put(c.date, "shop", c.branch, c.total));
  bills.filter(b => !b.claim && !b.test && !isOverheadJob(b.job)).forEach(b => put(b.date, "card", b.branch, Number(b.cost) || 0));
  const months = Object.values(totals).sort((a, b) => b.month.localeCompare(a.month));

  /* 3. Card spend by holder: Expense bills plus shop purchases on a card. */
  const spend = new Map();
  const spent = (last4, amt, branch) => {
    const k = last4 || "?";
    const c = spend.get(k) || { last4: k, holder: cardBy[last4] || (last4 ? "Not on the card list" : "No card given"), total: 0, count: 0, byBranch: {} };
    c.total = r2(c.total + amt); c.count++; c.byBranch[branch] = r2((c.byBranch[branch] || 0) + amt);
    spend.set(k, c);
  };
  bills.filter(b => !b.claim && !b.test).forEach(b => spent(b.card && b.card.last4, Number(b.cost) || 0, b.branch));
  shop.filter(c => /company card/i.test(c.paidWith) && !/sent back/i.test(c.status)).forEach(c => spent(c.cardLast4, c.total, c.branch));
  const cardSpend = [...spend.values()].sort((a, b) => b.total - a.total);

  /* 4. Exceptions to chase. */
  for (const c of [...km, ...re].filter(c => !sentBack(c.status))) {
    if (c.date && c.date > today) add("future_date", "stop", (c.kind === "km" ? "Km claim" : "Reimbursement") + " dated in the future", c, `Dated ${c.date}, sent in ${c.submitted}.`);
    const what = c.kind === "km" ? "Km claim" : "Reimbursement";
    if (counts(c.status) && !c.inBudget) add("not_in_budget", "caution", `${what} approved but not added to the job budget`, c, "That cost is missing from job costing until someone records it on the job.");
    if ((!c.status || /^submitted$/i.test(c.status)) && c.submitted && daysBetween(c.submitted, today) > 7) add("waiting", "caution", `${what} waiting for review more than 7 days`, c, `Sent in ${c.submitted}.`);
    if (c.job && (c.job.closedOn || isOldJob(c.job))) add("closed_job", "caution", `${what} on a closed or old job`, c, "Check it is on the right job before it is paid.");
    if (c.job && isSpecialJob(c.job)) add("test_job", "caution", `${what} on a test job`, c);
  }
  for (const c of km.filter(c => !sentBack(c.status))) {
    if (c.date >= PHOTO_RULE_FROM && c.photos < 2) add("no_photos", "stop", "Km claim with no odometer photos", c, `Photos are required for trips on or after ${PHOTO_RULE_FROM}.`);
    if (counts(c.status) && !c.approvedFilled) add("no_approved_km", "caution", "Km claim approved with the approved km left blank", c, "Paid on the km claimed. The PM should fill in the approved km.");
    if (c.typed !== null && Math.abs(c.typed - c.owed) > 0.01) add("amount_mismatch", "stop", "Km amount owed does not match the km", c, `Typed $${c.typed.toFixed(2)}, the km work out to $${c.owed.toFixed(2)} at $${rates.regular.toFixed(2)} and $${rates.trailer.toFixed(2)} a km.`);
    if (c.start !== null && c.end !== null) {
      const gap = c.end - c.start, claimed = c.regClaimed + c.trlClaimed;
      if (gap < 0) add("odometer_backwards", "stop", "Km claim with the end odometer below the start", c, `${c.start} to ${c.end}.`);
      else if (Math.abs(gap - claimed) > 1) add("odometer_gap", "caution", "Odometer gap does not match the km claimed", c, `Odometer shows ${gap} km, ${claimed} km claimed.`);
    }
  }
  /* Same person: odometer readings that overlap or run backwards from one
     trip to the next, and the same trip twice. Readings under 5,000 are
     taken as a trip meter that gets reset, so they are not compared across
     claims (Richard's 56 to 87 on 2 November is not an odometer). */
  const byPerson = new Map();
  km.filter(c => !sentBack(c.status)).forEach(c => { const l = byPerson.get(c.person) || []; l.push(c); byPerson.set(c.person, l); });
  for (const list of byPerson.values()) {
    const odo = list.filter(c => c.start !== null && c.end !== null && c.end >= c.start && c.start >= 5000)
      .sort((a, b) => a.date.localeCompare(b.date) || a.start - b.start);
    for (let i = 1; i < odo.length; i++) {
      const a = odo[i - 1], b = odo[i];
      if (b.start < a.end) add("odometer_sequence", "caution", "Odometer readings overlap or go backwards", b, `${a.date} on ${a.job ? a.job.number : "?"} reads ${a.start} to ${a.end}, then ${b.date} reads ${b.start} to ${b.end}.`);
    }
    const seen = new Map();
    for (const c of list) {
      const k = c.date + "|" + c.trip.toLowerCase().replace(/[^a-z0-9]/g, "");
      if (c.trip && seen.has(k)) add("duplicate_trip", "stop", "Same trip claimed twice on the same day", c, `"${c.trip.split("\n")[0]}" is also on job ${seen.get(k).job ? seen.get(k).job.number : "?"}.`);
      else seen.set(k, c);
    }
  }
  for (const c of re.filter(c => !sentBack(c.status))) {
    const l4 = findLast4(c.notes).filter(x => cardBy[x]);
    if (l4.length) add("reimb_on_card", "stop", "Reimbursement claim that says it was paid on a company card", c, `Notes mention card ${l4[0]} (${cardBy[l4[0]]}). A company card purchase is an Expense bill, not a reimbursement, or it gets paid twice.`);
  }
  for (const c of shop.filter(c => !sentBack(c.status))) {
    if (/company card/i.test(c.paidWith) && !c.card) add("shop_no_card", "caution", "Shop purchase on a company card with no card picked", { ...c, job: null });
    if (c.cardLast4 && !cardBy[c.cardLast4]) add("unknown_card", "stop", "Shop purchase on a card that is not on the card list", { ...c, job: null }, `Card ${c.cardLast4}.`);
    if (/^other/i.test(c.card) && !findLast4(c.notes).length && !/\d{4}/.test(c.notes)) add("shop_other_card", "caution", "Shop purchase on \"Other\" card with no last 4 in Notes", { ...c, job: null });
  }
  for (const b of bills) {
    const item = { person: b.vendor || "", job: b.job, date: b.date, id: b.id };
    if (b.test || /^test\b/i.test(b.vendor || "")) { add("test_bill", "caution", "Test Expense bill on a live job", item, `${b.name}, ${b.vendor}, $${r2(b.cost).toFixed(2)}. Delete it in JobTread.`); continue; }
    if ((b.codes || []).some(c => /^0+$/.test(String(c)))) add("uncategorized", "caution", "Expense bill on 0000 Uncategorized", item, `${b.name}, $${r2(b.cost).toFixed(2)}.`);
    if (isOverheadJob(b.job)) add("overhead_bill", "caution", "Expense bill on the overhead job", item, `${b.name}. Shop costs go through the Shop and equipment purchase form, or they are counted twice.`);
    if (!b.claim && !b.card) add("no_card", "caution", "Company card Expense bill with no card last 4", item, `${b.name}, $${r2(b.cost).toFixed(2)}. Put "Card" and the last 4 in the description (for example Card 9726), or "Km claim" or "Reimbursement" if it books a claim.`);
    if (b.card && !cardBy[b.card.last4]) add("unknown_card", "stop", "Expense bill on a card that is not on the card list", item, `Card ${b.card.last4}, from the ${b.card.from}.`);
  }
  for (const j of input.noBranchJobs || []) if (!isOverheadJob(j) && !isSpecialJob(j)) add("no_branch", "caution", "Open job with no Estimating branch", { job: j }, "Its costs cannot be split Edmonton or Calgary.");

  const order = { stop: 0, caution: 1 };
  ex.sort((a, b) => order[a.level] - order[b.level] || a.kind.localeCompare(b.kind) || String(a.date).localeCompare(String(b.date)));

  return {
    today, rates, cards,
    payout: [...payout.values()].sort((a, b) => a.person.localeCompare(b.person)),
    payoutTotal: r2([...payout.values()].reduce((s, p) => s + p.total, 0)),
    months, cardSpend, exceptions: ex,
    counts: { km: km.length, reimbursements: re.length, shop: shop.length, bills: bills.length },
    claims: { km, reimbursements: re, shop }
  };
}
