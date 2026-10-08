/* A&M - the command centre's one door.

   GET /api/command?part=me | jobs | money | inventory

   Everything the command centre shows comes through here, read on the server
   with A&M's own JobTread key and QuickBooks connection, so nobody needs their
   own login to either system to see their section. Nothing here writes to
   JobTread, QuickBooks or the shop. Answers are kept for a minute or two so ten
   people opening the page at 7 am is one read of JobTread, not ten.

   Who sees what is decided here, not in the page:
     owner   every part
     office  jobs, money, inventory
     field   jobs, inventory
     crew    none of it */

import { getStore } from "@netlify/blobs";
import { authGate } from "./_auth.mjs";
import { qboGet } from "./_qbo.mjs";
import { readAging, readBalanceSheet, readProfitAndLoss, readPayableDetail, readVendorSpend } from "./_qboreports.mjs";
import { buildFeed, localDay } from "./_derive.mjs";

const STORE = "am-inventory";
const PAVE = "https://api.jobtread.com/pave";
const store = () => getStore({ name: STORE, consistency: "strong" });
const FY_START_MONTH = 4;   /* fiscal year runs 1 April to 31 March */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const ACCESS = {
  me: ["owner", "office", "field", "crew"],
  jobs: ["owner", "office", "field"],
  money: ["owner", "office"],
  inventory: ["owner", "office", "field"],
  buying: ["owner", "office"]
};
const TTL = { jobs: 120000, money: 300000, inventory: 60000, buying: 300000 };

async function cached(s, part, build, fresh) {
  const key = "cc-cache-" + part;
  const hit = await s.get(key, { type: "json" });
  const age = hit ? Date.now() - hit.at : Infinity;
  /* A refresh is honoured, but not more than once every 20 seconds. */
  if (hit && (age < TTL[part]) && !(fresh && age > 20000)) return { ...hit.data, storedAt: hit.at };
  const data = await build();
  const at = Date.now();
  try { await s.setJSON(key, { at, data }); } catch (e) {}
  return { ...data, storedAt: at };
}

/* ---------------------------------------------------------------- JobTread */
async function pave(query, grantKey) {
  const r = await fetch(PAVE, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } })
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) throw new Error(`JobTread refused the request: ${body.message || body.raw || "HTTP " + r.status}`.slice(0, 300));
  return body;
}

async function readJobs(s) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey || !c.organizationId) {
    const e = new Error("JobTread is not connected yet. The office connects it in Settings, JobTread link.");
    e.status = 409; throw e;
  }
  const nodes = []; let total = null, page = null, guard = 0;
  do {
    const args = { size: 50 }; if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, jobs: { $: args, count: {}, nextPage: {}, nodes: {
      id: {}, name: {}, number: {}, createdAt: {}, closedOn: {},
      location: { address: {}, account: { name: {} } },
      customFieldValues: { $: { size: 100 }, nodes: { value: {}, customField: { name: {} } } }
    } } } }, c.grantKey);
    const jb = res && res.organization && res.organization.jobs;
    if (!jb) throw new Error("JobTread did not return a job list.");
    nodes.push(...(jb.nodes || []));
    if (total === null && typeof jb.count === "number") total = jb.count;
    page = jb.nextPage || null;
  } while (page && ++guard < 100);

  const orders = []; page = null; guard = 0;
  do {
    const args = { size: 100, where: ["type", "customerOrder"] }; if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, orders: { _: "documents", $: args, nextPage: {}, nodes: {
      id: {}, name: {}, status: {}, price: {}, issueDate: {}, createdAt: {}, job: { id: {} }
    } } } }, c.grantKey);
    const d = res && res.organization && res.organization.orders;
    if (!d) break;
    orders.push(...(d.nodes || []));
    page = d.nextPage || null;
  } while (page && ++guard < 100);

  return { nodes, total, orders };
}

/* Buying: purchase orders and supplier paperwork from JobTread, bills and
   spend from QuickBooks. Each half is read on its own, so one being down does
   not blank the other. */
async function readBuying(s) {
  const out = { pos: null, vendors: null, bills: null, spend: null, errors: {} };
  try {
    const c = (await s.get("jobtread-key", { type: "json" })) || {};
    if (!c.grantKey || !c.organizationId) throw new Error("JobTread is not connected yet.");
    const pos = []; let page = null, guard = 0;
    do {
      const args = { size: 100, where: ["type", "vendorOrder"] }; if (page) args.page = page;
      const res = await pave({ organization: { $: { id: c.organizationId }, d: { _: "documents", $: args, nextPage: {}, nodes: {
        id: {}, name: {}, status: {}, cost: {}, issueDate: {}, dueDate: {}, account: { name: {} }, job: { id: {}, number: {}, name: {} }
      } } } }, c.grantKey);
      const d = res && res.organization && res.organization.d;
      if (!d) break;
      pos.push(...(d.nodes || [])); page = d.nextPage || null;
    } while (page && ++guard < 50);
    out.pos = pos;
    const vendors = []; page = null; guard = 0;
    do {
      const args = { size: 50, where: ["type", "vendor"] }; if (page) args.page = page;
      const res = await pave({ organization: { $: { id: c.organizationId }, v: { _: "accounts", $: args, nextPage: {}, nodes: {
        id: {}, name: {}, customFieldValues: { nodes: { value: {}, customField: { name: {} } } }
      } } } }, c.grantKey);
      const v = res && res.organization && res.organization.v;
      if (!v) break;
      vendors.push(...(v.nodes || []).map(n => {
        const f = {}; ((n.customFieldValues && n.customFieldValues.nodes) || []).forEach(x => { if (x.customField) f[x.customField.name] = x.value; });
        return { id: n.id, name: n.name, wcb: f["WCB"] === true, coiExpires: f["COI Expires"] || "" };
      }));
      page = v.nextPage || null;
    } while (page && ++guard < 50);
    out.vendors = vendors;
  } catch (e) { out.errors.jobtread = e.message; }
  try {
    const { start, today } = fyStart();
    out.bills = readPayableDetail(await qboGet("reports/AgedPayableDetail", { report_date: today }));
    out.spend = readVendorSpend(await qboGet("reports/VendorExpenses", { start_date: start, end_date: today, accounting_method: "Accrual" }));
  } catch (e) { out.errors.quickbooks = e.message; }
  return out;
}

/* ------------------------------------------------------------- QuickBooks */
function fyStart() {
  const today = localDay();
  const [y, m] = today.split("-").map(Number);
  const startYear = m >= FY_START_MONTH ? y : y - 1;
  return { start: `${startYear}-0${FY_START_MONTH}-01`, today };
}

async function readMoney() {
  const { start, today } = fyStart();
  /* One at a time. Intuit allows ten requests at once per company, shared with
     every other app connected to it. */
  const bsRep = await qboGet("reports/BalanceSheet", { start_date: today, end_date: today, accounting_method: "Accrual" });
  const arRep = await qboGet("reports/AgedReceivables", { report_date: today });
  const apRep = await qboGet("reports/AgedPayables", { report_date: today });
  const plRep = await qboGet("reports/ProfitAndLoss", { start_date: start, end_date: today, accounting_method: "Accrual" });
  const bs = readBalanceSheet(bsRep), ar = readAging(arRep), ap = readAging(apRep), pl = readProfitAndLoss(plRep);
  return { asOf: today, fyStart: start, bs, ar, ap, pl };
}

/* --------------------------------------------------------------- inventory */
async function readInventory(s) {
  const catalog = await s.get("catalog", { type: "json" });
  const idx = (await s.get("ev-index", { type: "json" })) || { months: [] };
  const events = [];
  for (const m of [...idx.months].sort()) {
    const doc = await s.get(m, { type: "json" });
    if (doc && Array.isArray(doc.events)) events.push(...doc.events);
  }
  return buildFeed(catalog || {}, events);
}

/* ------------------------------------------------------- changing a job
   The handful of job details the office and the field leads change most,
   written to JobTread under the app's key. Every value is checked against what
   JobTread allows before it is sent, every change is logged with who made it,
   and JobTread is told not to email anybody about it. */
const STATUSES = ["New Lead","Uploaded Without Plans","Uploaded With Plans","Estimating","Site Visit Scheduled","Pending Estimate Review",
  "Estimate Review Completed","Estimate Sent","Bid Accepted","Pending","Follow Up Required","Upcoming To Be Scheduled","Scheduling required",
  "Scheduled (Date promised)","Turnover Meeting Required","NOP","Site work","Loose Ends Required","Job Complete by A&M","PM Approvals",
  "Invoicing","Job Post Mortem","Closed Won","Not Bid","File Closed Bid Lost"];
const EDITABLE = {
  "Status":                         { id: "22PRQFJ6qMrZ", kind: "option", options: STATUSES },
  "Project Manager":                { id: "22PRWXsnFt3W", kind: "option", options: (process.env.PM_NAMES || "Ryan,Pat,George").split(",").map(x => x.trim()).filter(Boolean) },
  "Expected Date of Project Start": { id: "22PRUjf66Lh7", kind: "date" },
  "Number of Guys Required":        { id: "22PeWmzfPxqx", kind: "option", options: Array.from({ length: 30 }, (_, i) => String(i + 1)) },
  "Estimated Days of Work":         { id: "22PeWmzJYuxK", kind: "number" },
  "Risk Level":                     { id: "22PevE8z3Mek", kind: "option", options: ["Low Risk", "Glovebag", "Moderate Risk", "High Risk"] },
  "NOP Filed Date and Time":        { id: "22Pe8itTZBLX", kind: "datetime" },
  "NOP Expires":                    { id: "22PeaZdCwFn2", kind: "date" }
};
function checkValue(def, v) {
  if (v === null || v === "") return { ok: true, value: null };
  if (def.kind === "option") return def.options.includes(String(v)) ? { ok: true, value: String(v) } : { ok: false };
  if (def.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? { ok: true, value: String(v) } : { ok: false };
  if (def.kind === "datetime") { const d = new Date(String(v)); return isNaN(d) ? { ok: false } : { ok: true, value: d.toISOString() }; }
  if (def.kind === "number") { const n = Number(v); return (isFinite(n) && n >= 0 && n < 1000) ? { ok: true, value: n } : { ok: false }; }
  return { ok: false };
}
async function updateJob(s, req) {
  let body; try { body = await req.json(); } catch { return json({ error: "Body was not valid JSON." }, 400); }
  const jobId = String(body.jobId || "");
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(jobId)) return json({ error: "bad_job", message: "That job id does not look right." }, 400);
  const changes = body.changes || {};
  const values = {}, said = [];
  for (const [name, v] of Object.entries(changes)) {
    const def = EDITABLE[name];
    if (!def) return json({ error: "not_editable", message: `${name} cannot be changed from the app. Change it in JobTread.` }, 400);
    const ck = checkValue(def, v);
    if (!ck.ok) return json({ error: "bad_value", message: `"${v}" is not an allowed value for ${name}.` }, 400);
    values[def.id] = ck.value; said.push(`${name}: ${ck.value === null ? "cleared" : ck.value}`);
  }
  if (!said.length) return json({ error: "nothing", message: "Nothing to change." }, 400);
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) return json({ error: "not_connected", message: "JobTread is not connected yet." }, 409);
  const res = await pave({ updateJob: { $: { id: jobId, notify: false, customFieldValues: values },
    job: { id: {}, number: {}, customFieldValues: { $: { size: 100 }, nodes: { value: {}, customField: { name: {} } } } } } }, c.grantKey);
  try {
    const logDoc = (await s.get("jobtread-log", { type: "json" })) || { entries: [] };
    logDoc.entries.unshift({ at: new Date().toISOString(), action: "updateJob", by: req.amUser.name, jobId, changes: said });
    logDoc.entries = logDoc.entries.slice(0, 300);
    await s.setJSON("jobtread-log", logDoc);
  } catch (e) {}
  try { await s.delete("cc-cache-jobs"); } catch (e) {}
  return json({ ok: true, job: res && res.updateJob && res.updateJob.job, changed: said });
}

export default async (req) => {
  if (req.method !== "GET" && req.method !== "POST") return json({ error: "Use GET." }, 405);
  const s = store();
  const denied = await authGate(req, s);
  if (denied) return denied;
  if (!req.amUser) return json({ error: "auth", message: "Sign in to the app first." }, 401);
  if (req.method === "POST") {
    const role = req.amUser.role || "crew";
    if (!["owner", "office", "field"].includes(role)) return json({ error: "role", message: "Changing jobs is for the office and the field leads." }, 403);
    try { return await updateJob(s, req); }
    catch (e) { return json({ error: "upstream", message: e.message }, 502); }
  }

  const url = new URL(req.url);
  const part = url.searchParams.get("part") || "me";
  const role = req.amUser.role || "crew";
  if (!ACCESS[part]) return json({ error: "Unknown part." }, 400);
  if (!ACCESS[part].includes(role)) {
    return json({ error: "role", message: role === "crew" ? "The command centre is for the office and the field leads. Ask Jen if you need it." : "That part is not in your section." }, 403);
  }
  const fresh = url.searchParams.get("fresh") === "1";

  try {
    if (part === "me") return json({ name: req.amUser.name, role, today: localDay() });
    if (part === "jobs") return json(await cached(s, "jobs", () => readJobs(s), fresh));
    if (part === "money") return json(await cached(s, "money", () => readMoney(), fresh));
    if (part === "inventory") return json(await cached(s, "inventory", () => readInventory(s), fresh));
    if (part === "buying") return json(await cached(s, "buying", () => readBuying(s), fresh));
  } catch (e) {
    const notConnected = e.code === "NOT_CONNECTED" || e.status === 409;
    return json({ error: notConnected ? "not_connected" : "upstream", message: e.message }, notConnected ? 409 : 502);
  }
  return json({ error: "Unknown part." }, 400);
};

export const config = { path: "/api/command" };
