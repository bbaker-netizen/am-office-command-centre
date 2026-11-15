/* A&M - closeout checks for the project assistant (and Amir's Done, not
   billed list).

   The rule (Bruce's brief, 6 November): every purchase order, approved quote
   and subcontractor invoice is in JobTread within 7 days of the job
   finishing, before it goes to Thursday billing. Post mortems run straight
   after the Thursday invoice meeting.

   What is checked on each job, from JobTread:
   - Client PO: the job's "PO Status" is Received or Not Required.
   - Approved quote: at least one customer order (quote) is approved.
   - Subcontractor invoices: every supplier or subcontractor with a purchase
     order on the job has at least one bill, and no bill is left in draft.
   "Finished" is the day of the last time entry on the job (JobTread keeps no
   date for a status change). The deadline is 7 days after that, and the
   billing day is the first Thursday on or after the deadline. */

const DAY = 86400000;
const t = d => Date.parse(d + "T12:00:00Z");
export const addDays = (d, n) => new Date(t(d) + n * DAY).toISOString().slice(0, 10);
export function thursdayOnOrAfter(d) { const w = new Date(t(d)).getUTCDay(); return addDays(d, (4 - w + 7) % 7); }

export function closeoutCheck({ poStatus, docs, lastWork, today }) {
  const D = docs || [];
  const missing = [];
  const po = String(poStatus || "").trim();
  const poOk = po === "Received" || po === "Not Required";
  if (!poOk) missing.push(po === "Outstanding" ? "Client PO outstanding" : "Client PO status not set");
  const quotes = D.filter(x => x.type === "customerOrder");
  const approved = quotes.filter(x => x.status === "approved");
  if (!approved.length) missing.push(quotes.length ? "Quote not approved in JobTread" : "No quote in JobTread");
  const orders = D.filter(x => x.type === "vendorOrder" && x.status !== "denied");
  const bills = D.filter(x => x.type === "vendorBill");
  const billed = new Set(bills.map(b => (b.vendor || "").toLowerCase()));
  const noBill = [...new Set(orders.map(o => o.vendor || "").filter(v => v && !billed.has(v.toLowerCase())))];
  noBill.forEach(v => missing.push("No invoice yet from " + v));
  const drafts = bills.filter(b => b.status === "draft").length;
  if (drafts) missing.push(drafts + " bill" + (drafts === 1 ? "" : "s") + " still in draft");
  const finished = lastWork || null;
  const deadline = finished ? addDays(finished, 7) : null;
  const billing = deadline ? thursdayOnOrAfter(deadline) : null;
  const daysSince = finished ? Math.round((t(today) - t(finished)) / DAY) : null;
  return { missing, ok: !missing.length, finished, deadline, billing, daysSince, late: !!(deadline && today > deadline && missing.length),
    counts: { quotes: quotes.length, approved: approved.length, orders: orders.length, bills: bills.length, drafts } };
}
