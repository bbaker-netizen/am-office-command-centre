/* A&M - the command centre's one door.

   GET /api/command?part=me | jobs | money | inventory

   Everything the command centre shows comes through here, read on the server
   with A&M's own JobTread key and QuickBooks connection, so nobody needs their
   own login to either system to see their section. Nothing here writes to
   JobTread, QuickBooks or the shop. Answers are kept for a minute or two so ten
   people opening the page at 7 am is one read of JobTread, not ten.

   Who sees what is decided here, not in the page, from the person's account
   (set by an admin on People and access):
     jobs, inventory   anyone who sees Office, Field or Money
     money, buying     anyone who sees Money
     payroll           its own door, /api/payroll, for anyone who sees Payroll
   Changing a job needs an account that can make changes. The shop's PINs do
   not open any of this; see _accounts.mjs. */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit, logAccount } from "./_accounts.mjs";
import { CUSTOMER_FIELDS, fieldIds } from "./_jtfields.mjs";
import { qboGet, query as qboQuery } from "./_qbo.mjs";
import { KEY as BANK_KEY, cleanActual, readBankAccounts, lastEntryDate, pickCash, addActual, clearActual } from "./_bank.mjs";
import { readAging, readBalanceSheet, readProfitAndLoss, readPayableDetail, readVendorSpend } from "./_qboreports.mjs";
import { buildFeed, localDay } from "./_derive.mjs";
import { pickTask, readInBatches } from "./_crew.mjs";
import { CLAIM_TASK, CLAIM_TASK_RE, claimsFromTasks, membershipFor, decide, cleanClaimBody, claimText, releaseText } from "./_claims.mjs";
import { closeoutCheck } from "./_closeout.mjs";
import { SWEEP_KEY as ENCIRCLE_SWEEP } from "./_encircle.mjs";

const STORE = "am-inventory";
const PAVE = "https://api.jobtread.com/pave";
const store = () => getStore({ name: STORE, consistency: "strong" });
const FY_START_MONTH = 4;   /* fiscal year runs 1 April to 31 March */

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

const ACCESS = {
  me: u => true,
  jobs: u => sees(u, "office", "field", "money"),
  money: u => sees(u, "money"),
  inventory: u => sees(u, "office", "field", "money"),
  buying: u => sees(u, "money"),
  people: u => sees(u, "office", "field"),
  crew: u => sees(u, "office", "field"),
  field: u => sees(u, "office", "field", "money"),
  billing: u => sees(u, "office", "field", "money"),
  encircle: u => sees(u, "office", "field"),
  closeout: u => sees(u, "office", "field"),
  claims: u => sees(u, "office", "field")
};
const TTL = { claims: 45000, jobs: 120000, money: 300000, inventory: 60000, buying: 300000, people: 3600000, billing: 1800000, field: 300000 };

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

/* JobTread refuses a request that asks for too much at once ("Request Entity
   Too Large"): 50 jobs with 100 custom fields each was refused outright, which
   is why the top bar said JobTread was not answering. So: 25 jobs a page, up to
   20 fields each (the most any A&M job has is about 16), and no more than about
   seven seconds of reading per call, well inside Netlify's limit. With 200 and
   more jobs that means the page asks again with the nextPage it is handed and
   adds the rest as they arrive. */
async function readJobs(s, startPage) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey || !c.organizationId) {
    const e = new Error("JobTread is not connected yet. An admin connects it in Settings, Connections.");
    e.status = 409; throw e;
  }
  const nodes = []; let total = null, page = startPage || null, guard = 0;
  const t0 = Date.now();
  do {
    const args = { size: 25 }; if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, jobs: { $: args, count: {}, nextPage: {}, nodes: {
      id: {}, name: {}, number: {}, createdAt: {}, closedOn: {},
      location: { address: {}, account: { id: {}, name: {} } },
      customFieldValues: { $: { size: 24 }, nodes: { value: {}, customField: { name: {} } } }
    } } } }, c.grantKey);
    const jb = res && res.organization && res.organization.jobs;
    if (!jb) throw new Error("JobTread did not return a job list.");
    nodes.push(...(jb.nodes || []));
    if (total === null && typeof jb.count === "number") total = jb.count;
    page = jb.nextPage || null;
  } while (page && ++guard < 100 && Date.now() - t0 < 7000);
  /* A follow-on call only carries more jobs. */
  if (startPage) return { nodes, total, nextPage: page };
  const nextPage = page;

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

  return { nodes, total, orders, nextPage };
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
  return { asOf: today, fyStart: start, bs, ar, ap, pl, bank: await readBankStatus(today) };
}

/* How far the bank accounts in QuickBooks have been brought up to date. BMO
   does not feed QuickBooks; Danielle imports it by hand each Tuesday, so the
   newest transaction date is the date QuickBooks' balance is good to. */
async function readBankStatus(today) {
  try {
    const accounts = readBankAccounts(await qboQuery("select * from Account where AccountType = 'Bank'"));
    if (!accounts.length) return { accounts, lastEntry: null };
    const from = new Date(Date.parse(today + "T12:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
    let lastEntry = null;
    try {
      const gl = await qboGet("reports/GeneralLedger", { start_date: from, end_date: today, account: accounts.map(a => a.id).join(","), columns: "tx_date", accounting_method: "Accrual" });
      lastEntry = lastEntryDate(gl, today, accounts.map(a => a.name));
    } catch (e) { return { accounts, lastEntry: null, problem: "Could not read when the bank was last brought up to date: " + e.message.slice(0, 120) }; }
    return { accounts, lastEntry };
  } catch (e) { return { accounts: [], lastEntry: null, problem: e.message.slice(0, 160) }; }
}

/* The cash figure the page leads with, worked out on every read (Craig's typed
   figure is not cached with the QuickBooks reports). */
async function withCash(s, data) {
  const doc = (await s.get(BANK_KEY, { type: "json" })) || { current: null, history: [] };
  const qAmount = data && data.bs ? data.bs.cash : null;
  const cash = pickCash({ qbo: { amount: qAmount, lastEntry: data && data.bank ? data.bank.lastEntry : null }, actual: doc.current, today: localDay() });
  return { ...data, cash, bankHistory: (doc.history || []).slice(0, 10) };
}

async function saveBankActual(s, req, body) {
  const u = req.amUser;
  if (!sees(u, "money") || !canEdit(u)) return json({ error: "role", message: "Only someone who sees Money and can make changes can type in the bank balance." }, 403);
  const doc = (await s.get(BANK_KEY, { type: "json" })) || { current: null, history: [] };
  if (body.bankActual === null || body.bankActual === "clear") {
    await s.setJSON(BANK_KEY, clearActual(doc));
    return json({ ok: true, current: null });
  }
  const ck = cleanActual(body.bankActual, localDay());
  if (!ck.ok) return json({ error: "bad_value", message: ck.message }, 400);
  const next = addActual(doc, ck.value, u.name, new Date().toISOString());
  await s.setJSON(BANK_KEY, next);
  return json({ ok: true, current: next.current });
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
/* The people a crew can be made of: JobTread users with a field role (and the
   shop). Customers, vendors and office-only roles are left out. Read once an
   hour; the crew board on Dispatch drags these onto jobs. */
const CREW_ROLES = /site supervisor|site superintendent|site worker|temp worker|foreman|labourer|shop|vendor/i;
async function readPeople(s) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) { const e = new Error("JobTread is not connected yet."); e.status = 409; throw e; }
  const res = await pave({ organization: { $: { id: c.organizationId }, memberships: { $: { size: 100 }, nodes: { id: {}, role: { name: {} }, user: { id: {}, name: {} } } } } }, c.grantKey);
  const nodes = (res.organization && res.organization.memberships && res.organization.memberships.nodes) || [];
  const extra = (process.env.CREW_EXTRA || "Maxim").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  const people = nodes.filter(m => m.user && (CREW_ROLES.test((m.role && m.role.name) || "") || extra.includes(String(m.user.name).toLowerCase())))
    .map(m => ({ id: m.id, name: m.user.name, role: (m.role && m.role.name) || "", temp: /temp worker|\(aces\)/i.test(((m.role && m.role.name) || "") + " " + m.user.name), sub: /vendor/i.test((m.role && m.role.name) || "") }))
    .sort((a, b) => (a.sub - b.sub) || (a.temp - b.temp) || a.name.localeCompare(b.name));
  return { people };
}

/* Billing rules on JobTread customers (see _jtfields.mjs). Only customers that
   carry at least one rule are sent to the page. */
async function readBilling(s) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) { const e = new Error("JobTread is not connected yet."); e.status = 409; throw e; }
  const map = await fieldIds(s, c);
  const names = CUSTOMER_FIELDS.map(f => f.name).filter(n => map[n + "|customer"]);
  if (!names.length) return { rules: {}, ready: false };
  const rules = {}; let page = null, guard = 0; const t0 = Date.now();
  do {
    /* 40 customers with 12 values each stays under JobTread's size limit
       (it refuses large requests with "Request Entity Too Large"). */
    const args = { size: 40, where: ["type", "customer"] }; if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, accounts: { $: args, nextPage: {}, nodes: { id: {}, name: {},
      customFieldValues: { $: { size: 12 }, nodes: { value: {}, customField: { name: {} } } } } } } }, c.grantKey);
    const a = res.organization && res.organization.accounts;
    if (!a) break;
    for (const n of a.nodes || []) {
      const r = {};
      for (const v of (n.customFieldValues && n.customFieldValues.nodes) || []) {
        const k = v.customField && v.customField.name;
        if (names.includes(k) && v.value !== null && v.value !== "" && v.value !== false) r[k] = v.value;
      }
      if (Object.keys(r).length) rules[n.id] = { name: n.name, ...r };
    }
    page = a.nextPage || null;
  } while (page && ++guard < 40 && Date.now() - t0 < 8000);
  return { rules, ready: true, partial: !!page };
}

/* ---------------------------------------------------------- crew plan
   JobTread allows 25 custom fields on a job and A&M uses all 25, so the crew
   plan lives where A&M already schedules site work: the job's "Site Work" task
   in JobTread's schedule. The crew are the task's assigned people, so it shows
   on their own JobTread app. The crew lead and the shop and site start times
   are lines in the task's description ("Crew lead: Carlos", "Shop start:
   6:30 AM", "Site start: 7:30 AM"); anything else written there is kept. */
/* Which task holds the crew: see _crew.mjs. */
const LINE = { lead: "Crew lead", shop: "Shop start", site: "Site start" };
function parseDesc(d) {
  const out = { lead: "", shop: "", site: "", rest: [] };
  String(d || "").split(/\r?\n/).forEach(l => {
    const m = l.match(/^\s*(crew lead|shop start|site start)\s*:\s*(.*)$/i);
    if (!m) { if (l.trim()) out.rest.push(l); return; }
    const k = m[1].toLowerCase().startsWith("crew") ? "lead" : m[1].toLowerCase().startsWith("shop") ? "shop" : "site";
    out[k] = m[2].trim();
  });
  return out;
}
function buildDesc(p) {
  return [p.lead && LINE.lead + ": " + p.lead, p.shop && LINE.shop + ": " + p.shop, p.site && LINE.site + ": " + p.site, ...(p.rest || [])].filter(Boolean).join("\n") || null;
}
/* Closeout checks for jobs that have finished on site (see _closeout.mjs):
   quotes, purchase orders and bills on each job, and its last time entry. */
async function readCloseout(s, idsParam, poParam) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) { const e = new Error("JobTread is not connected yet."); e.status = 409; throw e; }
  const ids = String(idsParam || "").split(",").filter(x => /^[A-Za-z0-9_-]{2,40}$/.test(x)).slice(0, 60);
  const po = {}; String(poParam || "").split(",").forEach((v, i) => { if (ids[i]) po[ids[i]] = decodeURIComponent(v || ""); });
  const today = localDay();
  const ask = async group => {
    const q = {};
    group.forEach((id, i) => { q["j" + i] = { _: "job", $: { id }, id: {},
      documents: { $: { size: 50 }, nodes: { type: {}, status: {}, account: { name: {} } } },
      timeEntries: { $: { size: 1, sortBy: [{ field: "startedAt", order: "desc" }] }, nodes: { startedAt: {} } } }; });
    const res = await pave(q, c.grantKey);
    const out = {};
    group.forEach((id, i) => {
      const j = res["j" + i]; if (!j) return;
      const docs = ((j.documents && j.documents.nodes) || []).map(d => ({ type: d.type, status: d.status, vendor: (d.account && d.account.name) || "" }));
      const te = j.timeEntries && j.timeEntries.nodes && j.timeEntries.nodes[0];
      const last = te ? localDay(new Date(te.startedAt)) : null;
      out[id] = closeoutCheck({ poStatus: po[id], docs, lastWork: last, today });
    });
    return out;
  };
  const { found, failed } = await readInBatches(ids, ask, 4);
  return { closeout: found, failed, today };
}

/* A document from a phone into the job's Files in JobTread (purchase orders,
   quotes, subcontractor invoices, sign-in sheets, letters). Site photos stay
   in Encircle, which owns them. Three steps, per JobTread's API: ask for an
   upload address, send the bytes there, then attach it to the job. */
const FOLDERS = ["Purchase orders", "Quotes", "Subcontractor invoices", "Site documents"];
async function uploadToJob(s, req, b) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) return json({ error: "not_connected", message: "JobTread is not connected yet." }, 409);
  const jobId = String(b.jobId || ""), name = String(b.name || "").replace(/[^\w .&()-]/g, "").trim().slice(0, 100) || "Document";
  const folder = FOLDERS.includes(b.folder) ? b.folder : "Site documents";
  const m = String(b.dataUrl || "").match(/^data:([\w/+.-]+);base64,(.+)$/);
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(jobId) || !m) return json({ error: "bad", message: "Pick a job and a file." }, 400);
  if (/^image\//.test(m[1]) && b.photo) return json({ error: "photo", message: "Site photos go in Encircle, which keeps them for the job. Use Encircle's app for photos." }, 400);
  const bytes = Buffer.from(m[2], "base64");
  if (bytes.length > 4_000_000) return json({ error: "big", message: "That file is over 4 MB. Send a smaller copy or upload it in JobTread." }, 400);
  const ur = await pave({ createUploadRequest: { $: { organizationId: c.organizationId, type: m[1], size: bytes.length }, createdUploadRequest: { id: {}, url: {}, method: {}, headers: {} } } }, c.grantKey);
  const u = ur.createUploadRequest && ur.createUploadRequest.createdUploadRequest;
  if (!u || !u.url) return json({ error: "upstream", message: "JobTread did not give an upload address." }, 502);
  const put = await fetch(u.url, { method: u.method || "PUT", headers: u.headers || { "content-type": m[1] }, body: bytes });
  if (!put.ok) return json({ error: "upstream", message: "The file did not upload (" + put.status + ")." }, 502);
  const f = await pave({ createFile: { $: { uploadRequestId: u.id, name, targetType: "job", targetId: jobId, folder, description: "Added from the A&M app by " + req.amUser.name }, createdFile: { id: {}, name: {} } } }, c.grantKey);
  try {
    const logDoc = (await s.get("jobtread-log", { type: "json" })) || { entries: [] };
    logDoc.entries.unshift({ at: new Date().toISOString(), action: "createFile", by: req.amUser.name, jobId, changes: [folder + ": " + name] });
    logDoc.entries = logDoc.entries.slice(0, 300); await s.setJSON("jobtread-log", logDoc);
  } catch (e) {}
  return json({ ok: true, file: f.createFile && f.createFile.createdFile, folder });
}

async function readCrew(s, idsParam) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) { const e = new Error("JobTread is not connected yet."); e.status = 409; throw e; }
  const ids = String(idsParam || "").split(",").filter(x => /^[A-Za-z0-9_-]{2,40}$/.test(x)).slice(0, 60);
  if (!ids.length) return { crew: {} };
  const today = localDay();
  /* A few jobs per request: JobTread refuses one big request ("too large"). */
  const ask = async group => {
    const q = {};
    group.forEach((id, i) => { q["j" + i] = { _: "job", $: { id }, id: {}, tasks: { $: { size: 25 }, nodes: { id: {}, name: {}, description: {}, startDate: {}, endDate: {},
      assignedMemberships: { nodes: { id: {}, user: { name: {} } } } } } }; });
    const res = await pave(q, c.grantKey);
    const crew = {};
    group.forEach((id, i) => {
      const j = res["j" + i]; if (!j) return;
      const t = pickTask(j.tasks && j.tasks.nodes, today);
      if (!t) { crew[id] = { taskId: null, members: [], lead: "", shop: "", site: "" }; return; }
      const p = parseDesc(t.description);
      crew[id] = { taskId: t.id, taskName: t.name, startDate: t.startDate, endDate: t.endDate, lead: p.lead, shop: p.shop, site: p.site,
        members: ((t.assignedMemberships && t.assignedMemberships.nodes) || []).map(m => ({ id: m.id, name: m.user && m.user.name })) };
    });
    return crew;
  };
  const { found, failed } = await readInBatches(ids, ask);
  return { crew: found, failed };
}
const TIME = /^(1[0-2]|0?[1-9]):[0-5]\d ?(AM|PM)$|^([01]?\d|2[0-3]):[0-5]\d$/;
async function saveCrew(s, req, body) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) return json({ error: "not_connected", message: "JobTread is not connected yet." }, 409);
  const b = body.crew || {};
  const jobId = String(b.jobId || "");
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(jobId)) return json({ error: "bad_job", message: "That job id does not look right." }, 400);
  const members = (Array.isArray(b.members) ? b.members : []).map(String).filter(x => /^[A-Za-z0-9_-]{2,40}$/.test(x)).slice(0, 40);
  const clean = v => String(v || "").replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 80);
  const lead = clean(b.lead), shop = clean(b.shop).toUpperCase(), site = clean(b.site).toUpperCase();
  if ((shop && !TIME.test(shop)) || (site && !TIME.test(site))) return json({ error: "bad_value", message: "Write times like 6:30 AM or 14:00." }, 400);
  /* Read the job's tasks fresh, so nothing typed into JobTread meanwhile is lost. */
  const cur = await pave({ job: { $: { id: jobId }, id: {}, number: {}, tasks: { $: { size: 25 }, nodes: { id: {}, name: {}, description: {}, startDate: {}, endDate: {}, assignedMemberships: { nodes: { id: {} } } } } } }, c.grantKey);
  const job = cur && cur.job; if (!job) return json({ error: "bad_job", message: "JobTread does not know that job." }, 404);
  const t = pickTask(job.tasks && job.tasks.nodes, localDay());
  const desc = buildDesc({ lead, shop, site, rest: t ? parseDesc(t.description).rest : [] });
  let taskId;
  if (t) {
    await pave({ updateTask: { $: { id: t.id, assignedMembershipIds: members, description: desc } } }, c.grantKey);
    taskId = t.id;
  } else {
    const args = { targetId: jobId, targetType: "job", name: "Site Work", assignedMembershipIds: members, description: desc };
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(b.startDate || ""))) { args.startDate = b.startDate; args.endDate = /^\d{4}-\d{2}-\d{2}$/.test(String(b.endDate || "")) ? b.endDate : b.startDate; }
    const r = await pave({ createTask: { $: args, createdTask: { id: {} } } }, c.grantKey);
    taskId = r && r.createTask && r.createTask.createdTask && r.createTask.createdTask.id;
  }
  try {
    const logDoc = (await s.get("jobtread-log", { type: "json" })) || { entries: [] };
    logDoc.entries.unshift({ at: new Date().toISOString(), action: t ? "updateTask crew" : "createTask crew", by: req.amUser.name, jobId,
      changes: [`crew: ${members.length} people`, lead && `lead ${lead}`, shop && `shop ${shop}`, site && `site ${site}`].filter(Boolean) });
    logDoc.entries = logDoc.entries.slice(0, 300);
    await s.setJSON("jobtread-log", logDoc);
  } catch (e) {}
  return json({ ok: true, taskId, created: !t });
}

/* ---------------------------------------------------------- taken by
   Who has taken a lead or estimate: an "Estimate" task on the job, assigned
   to them. See _claims.mjs. */
const whenLocal = () => new Intl.DateTimeFormat("en-CA", { timeZone: "America/Edmonton", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date()).replace(",", "");
export async function readClaims(s) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) { const e = new Error("JobTread is not connected yet."); e.status = 409; throw e; }
  const tasks = []; let page = null, guard = 0;
  do {
    const args = { size: 100, where: { and: [["name", "like", CLAIM_TASK + "%"], [["job", "id"], "!=", null]] }, sortBy: [{ field: "createdAt", order: "desc" }] };
    if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, tasks: { $: args, nextPage: {}, nodes: { id: {}, name: {}, description: {}, createdAt: {},
      job: { id: {}, number: {} }, assignedMemberships: { nodes: { id: {}, user: { name: {} } } } } } } }, c.grantKey);
    const t = res.organization && res.organization.tasks; if (!t) break;
    tasks.push(...(t.nodes || []));
    page = t.nextPage || null;
  } while (page && ++guard < 5);
  return { claims: claimsFromTasks(tasks) };
}
async function saveClaim(s, req, body) {
  const u = req.amUser;
  if (!sees(u, "office", "field")) return json({ error: "role", message: "Taking a lead is for the office and field leads." }, 403);
  const b = cleanClaimBody(body.claim);
  if (!b) return json({ error: "bad_job", message: "That job id does not look right." }, 400);
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) return json({ error: "not_connected", message: "JobTread is not connected yet." }, 409);
  const res = await pave({
    job: { $: { id: b.jobId }, id: {}, number: {}, tasks: { $: { size: 50 }, nodes: { id: {}, name: {}, description: {}, createdAt: {}, assignedMemberships: { nodes: { id: {}, user: { name: {} } } } } } },
    organization: { $: { id: c.organizationId }, memberships: { $: { size: 100 }, nodes: { id: {}, role: { name: {} }, user: { name: {} } } } }
  }, c.grantKey);
  const job = res && res.job; if (!job) return json({ error: "bad_job", message: "JobTread does not know that job." }, 404);
  const me = membershipFor(u.name, res.organization && res.organization.memberships && res.organization.memberships.nodes);
  if (!me) return json({ error: "no_member", message: `${u.name} is not a JobTread user under that name, so JobTread cannot show who has it. Ask an admin to match the name in JobTread.` }, 409);
  const tasks = ((job.tasks && job.tasks.nodes) || []).filter(t => CLAIM_TASK_RE.test(t.name || "")).sort((a, x) => String(x.createdAt).localeCompare(String(a.createdAt)));
  const task = tasks[0] || null;
  const current = claimsFromTasks(task ? [{ ...task, job: { id: job.id, number: job.number } }] : [])[job.id] || null;
  const ok = decide({ take: b.take, force: b.force, mine: me.id, current, admin: !!u.admin });
  if (!ok.ok) return json({ error: ok.error, message: ok.message, by: ok.by || "", claim: current }, ok.status);
  if (ok.nothing) return json({ ok: true, claim: current, job: job.number });
  const when = whenLocal();
  if (b.take) {
    const desc = claimText(u.name, when, task && task.description);
    if (task) await pave({ updateTask: { $: { id: task.id, assignedMembershipIds: [me.id], description: desc } } }, c.grantKey);
    else await pave({ createTask: { $: { targetId: job.id, targetType: "job", name: CLAIM_TASK, assignedMembershipIds: [me.id], description: desc }, createdTask: { id: {} } } }, c.grantKey);
  } else {
    await pave({ updateTask: { $: { id: task.id, assignedMembershipIds: [], description: releaseText(u.name, when, task.description) } } }, c.grantKey);
  }
  try {
    const logDoc = (await s.get("jobtread-log", { type: "json" })) || { entries: [] };
    logDoc.entries.unshift({ at: new Date().toISOString(), action: b.take ? "take estimate" : "let go of estimate", by: u.name, jobId: job.id,
      changes: [b.take ? (ok.from ? `taken over from ${ok.from}` : "taken") : "let go"] });
    logDoc.entries = logDoc.entries.slice(0, 300);
    await s.setJSON("jobtread-log", logDoc);
  } catch (e) {}
  try { await s.delete("cc-cache-claims"); } catch (e) {}
  const claim = b.take ? { jobId: job.id, jobNumber: job.number, by: u.name, byIds: [me.id], at: when } : null;
  return json({ ok: true, claim, job: job.number, from: ok.from || "" });
}

/* ---------------------------------------------------------- field record
   The last three weeks of JobTread timesheets and daily logs, read once every
   five minutes for everyone. Used for the daily log check on Sites, the T&M
   sheets, the emergency view on Dispatch and the scorecards. Light on purpose:
   who, which job, when, how long, and the cost item. */
async function readField(s) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) { const e = new Error("JobTread is not connected yet."); e.status = 409; throw e; }
  const since = new Date(Date.now() - 21 * 86400000).toISOString();
  const entries = []; let page = null, guard = 0; const t0 = Date.now();
  do {
    const args = { size: 100, where: ["startedAt", ">=", since] }; if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, timeEntries: { $: args, nextPage: {}, nodes: {
      minutes: {}, startedAt: {}, endedAt: {}, type: {}, isApproved: {}, user: { name: {} }, job: { id: {} }, costItem: { name: {} } } } } }, c.grantKey);
    const te = res.organization && res.organization.timeEntries; if (!te) break;
    for (const n of te.nodes || []) entries.push({ m: n.minutes || 0, at: n.startedAt, end: n.endedAt, type: n.type || "", ok: !!n.isApproved, who: n.user && n.user.name, job: n.job && n.job.id, item: n.costItem && n.costItem.name });
    page = te.nextPage || null;
  } while (page && ++guard < 40 && Date.now() - t0 < 7000);
  const logs = []; let lp = null; guard = 0;
  do {
    const args = { size: 50, sortBy: [{ field: "date", order: "desc" }] }; if (lp) args.page = lp;
    const res = await pave({ organization: { $: { id: c.organizationId }, dailyLogs: { $: args, nextPage: {}, nodes: { date: {}, user: { name: {} }, job: { id: {} }, notes: {} } } } }, c.grantKey);
    const dl = res.organization && res.organization.dailyLogs; if (!dl) break;
    let old = false;
    for (const n of dl.nodes || []) { if (String(n.date) < since.slice(0, 10)) { old = true; continue; } logs.push({ date: n.date, who: n.user && n.user.name, job: n.job && n.job.id, words: String(n.notes || "").trim().split(/\s+/).filter(Boolean).length }); }
    lp = old ? null : (dl.nextPage || null);
  } while (lp && ++guard < 10);
  return { entries, logs, since: since.slice(0, 10), partial: !!page };
}

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
  "NOP Expires":                    { id: "22PeaZdCwFn2", kind: "date" },
};
function checkValue(def, v) {
  if (v === null || v === "") return { ok: true, value: null };
  if (def.kind === "option") return def.options.includes(String(v)) ? { ok: true, value: String(v) } : { ok: false };
  if (def.kind === "date") return /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? { ok: true, value: String(v) } : { ok: false };
  if (def.kind === "datetime") { const d = new Date(String(v)); return isNaN(d) ? { ok: false } : { ok: true, value: d.toISOString() }; }
  if (def.kind === "number") { const n = Number(v); return (isFinite(n) && n >= 0 && n < 1000) ? { ok: true, value: n } : { ok: false }; }
  if (def.kind === "text") { const t = String(v).replace(/[\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim(); return t.length <= 400 ? { ok: true, value: t || null } : { ok: false }; }
  if (def.kind === "time") { const t = String(v).trim().toUpperCase().replace(/\s+/g, " "); return /^(1[0-2]|0?[1-9]):[0-5]\d ?(AM|PM)$|^([01]?\d|2[0-3]):[0-5]\d$/.test(t) ? { ok: true, value: t } : { ok: false }; }
  return { ok: false };
}
async function updateJob(s, req) {
  let body; try { body = await req.json(); } catch { return json({ error: "Body was not valid JSON." }, 400); }
  const jobId = String(body.jobId || "");
  if (!/^[A-Za-z0-9_-]{2,40}$/.test(jobId)) return json({ error: "bad_job", message: "That job id does not look right." }, 400);
  const changes = body.changes || {};
  const values = {}, said = [];
  const c0 = (await s.get("jobtread-key", { type: "json" })) || {};
  let byName = null;
  for (const [name, v] of Object.entries(changes)) {
    let def = EDITABLE[name];
    if (def && def.id === null) {
      if (!byName) byName = await fieldIds(s, c0);
      const id = byName[name + "|job"];
      if (!id) return json({ error: "not_set_up", message: `JobTread has no ${name} field yet. An admin adds it in Settings, Connections, Set up billing and crew fields.` }, 409);
      def = { ...def, id };
    }
    if (!def) return json({ error: "not_editable", message: `${name} cannot be changed from the app. Change it in JobTread.` }, 400);
    const ck = checkValue(def, v);
    if (!ck.ok) return json({ error: "bad_value", message: `"${v}" is not an allowed value for ${name}.` }, 400);
    values[def.id] = ck.value; said.push(`${name}: ${ck.value === null ? "cleared" : ck.value}`);
  }
  if (!said.length) return json({ error: "nothing", message: "Nothing to change." }, 400);
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey) return json({ error: "not_connected", message: "JobTread is not connected yet." }, 409);
  /* Nothing is asked back: JobTread refuses "updateJob.job" without arguments,
     which is what broke saving from the job panel. */
  await pave({ updateJob: { $: { id: jobId, notify: false, customFieldValues: values } } }, c.grantKey);
  const res = null;
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
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (req.method === "POST") {
    const peek = await req.clone().json().catch(() => ({}));
    if (peek && Object.prototype.hasOwnProperty.call(peek, "bankActual")) {
      try { return await saveBankActual(s, req, peek); } catch (e) { return json({ error: "upstream", message: e.message }, 502); }
    }
    /* Taking a lead is open to anyone in the office or field, even look-only
       accounts: it only says who is working on it. */
    if (peek && peek.claim) { try { return await saveClaim(s, req, peek); } catch (e) { return json({ error: "upstream", message: e.message }, 502); } }
    if (!canEdit(u) || !sees(u, "office", "field")) return json({ error: "role", message: "Your account can look but not change jobs. Ask an admin if you need to." }, 403);
    try {
      const body = await req.clone().json().catch(() => ({}));
      /* Estimators do not dispatch crews (Craig, 2026-11-20). */
      if (body && body.crew && u.assistant === "estimator") return json({ error: "role", message: "Crews are scheduled by dispatch, not estimating." }, 403);
      if (body && body.crew) return await saveCrew(s, req, body);
      if (body && body.upload) return await uploadToJob(s, req, body.upload);
      return await updateJob(s, req);
    }
    catch (e) { return json({ error: "upstream", message: e.message }, 502); }
  }

  const url = new URL(req.url);
  const part = url.searchParams.get("part") || "me";
  if (!ACCESS[part]) return json({ error: "Unknown part." }, 400);
  if (!ACCESS[part](u)) return json({ error: "role", message: "That part is not in your section. Ask an admin if you need it." }, 403);
  const fresh = url.searchParams.get("fresh") === "1";

  try {
    if (part === "me") {
      if (u.viewAs) await logAccount(s, { action: "view-as", by: u.viewAs.byName, target: u.name });
      return json({ id: u.id, name: u.name, email: u.email, title: u.title, areas: u.areas, level: u.level, edit: u.edit, admin: u.admin, role: u.role, idleHours: u.idleHours, claude: !!u.claude, today: localDay(), assistant: u.assistant, landing: u.landing, projectLive: !!u.projectLive, tours: u.tours || {}, branch: u.branch || "",
        master: !!u.master, viewAs: u.viewAs ? { by: u.viewAs.byName, shownLevel: u.shownLevel, mail: !!u.viewAs.mail } : null });
    }
    if (part === "jobs" && url.searchParams.get("page")) return json(await readJobs(s, url.searchParams.get("page")));
    if (part === "jobs") return json(await cached(s, "jobs", () => readJobs(s), fresh));
    if (part === "money") return json(await withCash(s, await cached(s, "money", () => readMoney(), fresh)));
    if (part === "inventory") return json(await cached(s, "inventory", () => readInventory(s), fresh));
    if (part === "buying") return json(await cached(s, "buying", () => readBuying(s), fresh));
    if (part === "people") return json(await cached(s, "people", () => readPeople(s), fresh));
    if (part === "crew") return json(await readCrew(s, url.searchParams.get("ids")));
    if (part === "claims") return json(await cached(s, "claims", () => readClaims(s), fresh));
    if (part === "closeout") return json(await readCloseout(s, url.searchParams.get("ids"), url.searchParams.get("po")));
    if (part === "field") return json(await cached(s, "field", () => readField(s), fresh));
    if (part === "billing") return json(await cached(s, "billing", () => readBilling(s), fresh));
    if (part === "encircle") return json({ mode: String(process.env.ENCIRCLE_MODE || "off").toLowerCase(), sweep: (await s.get(ENCIRCLE_SWEEP, { type: "json" })) || null });
  } catch (e) {
    const notConnected = e.code === "NOT_CONNECTED" || e.status === 409;
    return json({ error: notConnected ? "not_connected" : "upstream", message: e.message }, notConnected ? 409 : 502);
  }
  return json({ error: "Unknown part." }, 400);
};

export const config = { path: "/api/command" };
