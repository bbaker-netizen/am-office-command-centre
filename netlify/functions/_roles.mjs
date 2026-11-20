/* A&M - one personal assistant per position (Craig, 2026-11-20: "Each person
   needs an assistant regardless... per position formatted for that role").

   Every assistant has the same base: My day, check-ins at 7, noon and 5, the
   hit list, Talk, sticky notes, inbox sorting with reply drafts, and the
   calendar. What changes by position:
   - words: who the person is and what their work is, given to the mail sort
   - focus: what counts as needing them
   - notMine: mail that is someone else's work, unless it is sent to them and
     asks them for something
   - pages: the command centre pages whose problems show on their My day
   Positions are from the organizational chart of 10 October 2026. */

const CO = "A&M Abatement Services (hazardous materials abatement, demolition and restoration, Edmonton and Calgary)";

export const ROLES = {
  exec: { label: "Executive (owners and general manager)", short: "Executive",
    words: "a leader at " + CO + ". Owners: Craig and Amir.",
    focus: "decisions, approvals, money in and out, banks and insurers, clients and partners asking for them",
    notMine: "estimating mail (bid invitations, tenders, addenda, plan downloads)",
    pages: ["overview", "money", "cashflow", "dispatch", "closeout"] },
  ops: { label: "Operations Director (estimating, scheduling, admin, finance, safety)", short: "Operations Director",
    words: "the Director of Operations and Administration at " + CO + ". They run estimating, scheduling, administration, finance and safety, and the people in those seats report to them.",
    focus: "staff asking for a decision or approval, estimates waiting for review, schedule clashes, client complaints, insurance and safety matters, anything an estimator, dispatcher, administrator or accounting clerk has escalated",
    notMine: "routine bid invitations an estimator will pick up, and plan downloads",
    pages: ["overview", "estimating", "dispatch", "drafts", "records"] },
  estimator: { label: "Estimator (bids, quotes, site visits)", short: "Estimator",
    words: "an estimator at " + CO + ". Their work: bid invites and tenders, closing dates, site visits and walkthroughs, quotes and estimates, following up quotes that have no answer, addenda and RFIs. Mail to the shared estimating inbox is for the estimators.",
    focus: "bid invites, addenda, RFIs, site visits being set up, clients answering a quote, questions about scope or price",
    notMine: "",
    pages: ["estimating"] },
  project: { label: "Project Manager (jobs, closeout, change orders)", short: "Project Manager",
    words: "a project manager at " + CO + ". They run jobs from award to closeout: the turnover meeting, scheduling with dispatch, client updates, change orders and extras, consultant reports and air clearances, purchase orders and subcontractor invoices into JobTread within 7 days of finishing, and the post mortem.",
    focus: "clients and general contractors on their jobs, change orders and extras, consultant reports and clearances, site problems, subcontractor quotes and invoices, approvals for their jobs",
    notMine: "estimating mail for jobs not yet won, company finance",
    pages: ["projects", "closeout", "sites", "tm", "postmortem"] },
  dispatch: { label: "Project Coordinator and Dispatcher (crews, equipment, schedule)", short: "Dispatcher",
    words: "the project coordinator and dispatcher at " + CO + ". They schedule crews and equipment, book temp workers with the staffing agencies, file notices of project, and move jobs on the schedule when things change.",
    focus: "schedule changes and start dates, crew and temp worker requests, staffing agencies, equipment requests, notices of project, site access and keys, anything that moves a crew",
    notMine: "estimating mail, invoices and payments",
    pages: ["dispatch", "sites", "equipment", "projects"] },
  admin: { label: "Administrator (documents, invoices, front desk)", short: "Administrator",
    words: "the administrator at " + CO + ". They handle the front desk, phone and walk-ins, documents and filing, certificates of insurance and WCB clearances, sending invoices built by the project managers, and supplier paperwork.",
    focus: "requests for certificates of insurance or WCB clearance letters, documents and forms to send or file, invoices to send, visitors and calls to return, supplier paperwork",
    notMine: "estimating mail, technical questions about a job",
    pages: ["drafts", "clients", "records", "buying"] },
  accounting: { label: "Accounting and Payroll (bills, payments, payroll)", short: "Accounting and Payroll",
    words: "the accounting and payroll clerk at " + CO + ". They enter bills, match payments in and out, chase money owed, run payroll deposits and check them against paystubs, and pay expense and km claims.",
    focus: "bills and supplier statements, payments in and out, e-transfers, remittances, clients chasing or paying invoices, payroll questions, expense claims, the bookkeeper and the bank",
    notMine: "estimating mail, site and scheduling mail",
    pages: ["money", "payroll", "expenses", "buying", "cashflow"] },
  safety: { label: "Health and Safety (notices, incidents, inspections)", short: "Health and Safety",
    words: "the health and safety officer at " + CO + ". They look after asbestos and lead notices, site inspections, incidents and near misses, safety records in SiteDocs, training and fit tests, air monitoring and clearance results, and Alberta OHS.",
    focus: "incidents and near misses, OHS officers, notices of project, inspections, air monitoring and clearance results, training, fit tests and certificates, safety concerns from site",
    notMine: "estimating mail, invoices and payments",
    pages: ["sites", "dispatch", "equipment"] },
  sales: { label: "Business Development and Sales (leads, clients, follow-ups)", short: "Business Development",
    words: "business development at " + CO + ". They bring in work: new leads and enquiries, client relationships, following up quotes with no answer, and meetings with general contractors, property managers and insurers.",
    focus: "new enquiries and leads, clients and general contractors, quotes with no answer, meeting requests, referrals",
    notMine: "site and scheduling mail, invoices and payments",
    pages: ["estimating", "clients"] },
  shop: { label: "Shop and Logistics (equipment, loading, rentals)", short: "Shop and Logistics",
    words: "the shop and logistics lead at " + CO + ". They stage and load equipment for jobs, sign gear out and back, keep filter certificates current on HEPA vacuums and negative air machines, order shelf stock, and handle rentals and returns.",
    focus: "equipment requests and requisitions for tomorrow, rentals and returns, suppliers and deliveries, filter testing, broken or missing equipment",
    notMine: "estimating mail, invoices and payments",
    pages: ["equipment", "dispatch", "buying"] },
  site: { label: "Site Superintendent or Supervisor (site, crew, daily logs)", short: "Site lead",
    words: "a site superintendent or supervisor at " + CO + ". They run the work on site: the crew, daily logs and photos, safety on site, equipment there, and what the client or general contractor asks for on the day.",
    focus: "their sites and crews, start times, site access, client or general contractor requests on site, safety, equipment on site",
    notMine: "estimating mail, invoices and payments, company finance",
    pages: ["sites", "projects", "equipment"] }
};
export const ROLE_KEYS = Object.keys(ROLES);

/* The position from the job title, then from what the person sees. Nobody is
   left without one. */
const TITLE_RULES = [
  [/owner|chairman|president|ceo|general manager/i, "exec"],
  [/director/i, "ops"],
  [/estimat/i, "estimator"],
  [/coordinator|dispatch/i, "dispatch"],
  [/project manager|\bpm\b/i, "project"],
  [/account|payroll|bookkeep|finance|clerk/i, "accounting"],
  [/safety|hse|ohs/i, "safety"],
  [/business development|\bbd\b|sales/i, "sales"],
  [/shop|logistic|material|salvage|warehouse/i, "shop"],
  [/superintendent|supervisor|crew chief|foreman|site lead/i, "site"],
  [/admin|reception|office/i, "admin"]
];
export function roleFromTitle(title) {
  const t = String(title || "");
  for (const [re, key] of TITLE_RULES) if (re.test(t)) return key;
  return "";
}
export function roleFromAreas(areas) {
  const a = areas || [];
  if (a.includes("payroll") && !a.includes("field")) return "accounting";
  if (a.includes("field") && !a.includes("office")) return "project";
  if (a.includes("office") && a.includes("field") && a.includes("money")) return "exec";
  return "admin";
}
export const roleInfo = key => {
  const r = ROLES[key]; if (!r) return null;
  return { key, label: r.label, short: r.short, pages: r.pages };
};
