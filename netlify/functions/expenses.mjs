/* A&M - the Expenses page's server.

   GET /api/expenses            the payout list, branch totals, card spend and exceptions
   GET /api/expenses?fresh=1    read JobTread again (at most once every 20 seconds)

   Accounts with Payroll ticked only, because it shows what people are owed.
   Read only: nothing is written to JobTread or QuickBooks. The rules are in
   _expenses.mjs. KM_RATE and KM_TRAILER_RATE in Netlify change the km rates
   (default 0.70 and 0.90). */

import { getStore } from "@netlify/blobs";
import { accountGate, sees } from "./_accounts.mjs";
import { localDay } from "./_derive.mjs";
import { buildExpenses, parseCards } from "./_expenses.mjs";

const STORE = "am-inventory";
const PAVE = "https://api.jobtread.com/pave";
const CACHE = "expenses-cache";
const TTL = 120000;
const FORMS = { km: "22Ph3KW2M92A", reimb: "22Ph3KXGzeF4", shop: "22Ph3KYPAim7" };
const BRANCH_FIELD = "22PeaWxSDpiA";
const store = () => getStore({ name: STORE, consistency: "strong" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function pave(query, grantKey) {
  const r = await fetch(PAVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: { $: { grantKey }, ...query } }) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) throw new Error(`JobTread refused the request: ${body.message || body.raw || "HTTP " + r.status}`.slice(0, 300));
  return body;
}

const JOB = { id: {}, number: {}, name: {}, closedOn: {}, customFieldValues: { $: { where: [["customField", "id"], BRANCH_FIELD] }, nodes: { value: {} } } };
const flatJob = j => j ? { id: j.id, number: j.number || "", name: j.name || "", closedOn: j.closedOn || null, branch: ((j.customFieldValues && j.customFieldValues.nodes && j.customFieldValues.nodes[0]) || {}).value || "" } : null;

async function readForm(formId, key) {
  const out = []; let page = null, guard = 0;
  do {
    const args = { size: 25 }; if (page) args.page = page;
    const res = await pave({ form: { $: { id: formId }, submissions: { $: args, nextPage: {}, nodes: { id: {}, createdAt: {}, isSubmitted: {}, user: { name: {} }, job: JOB, values: {} } } } }, key);
    const s = res && res.form && res.form.submissions;
    if (!s) throw new Error("JobTread did not return the form " + formId + ".");
    out.push(...(s.nodes || []).filter(n => n.isSubmitted !== false).map(n => ({ ...n, job: flatJob(n.job) })));
    page = s.nextPage || null;
  } while (page && ++guard < 40);
  return out;
}

async function readCards(key) {
  const res = await pave({ form: { $: { id: FORMS.shop }, fields: { $: { size: 50 }, nodes: { name: {}, options: {} } } } }, key);
  const f = ((res.form && res.form.fields && res.form.fields.nodes) || []).find(x => /company card used/i.test(x.name || ""));
  return parseCards(f && f.options && f.options.options);
}

async function readBills(orgId, key) {
  const out = []; let page = null, guard = 0;
  do {
    const args = { size: 25, where: { and: [["type", "vendorBill"], ["name", "like", "%Expense%"]] } }; if (page) args.page = page;
    const res = await pave({ organization: { $: { id: orgId }, documents: { $: args, nextPage: {}, nodes: {
      id: {}, fullName: {}, status: {}, issueDate: {}, cost: {}, description: {}, account: { name: {} }, job: JOB,
      costItems: { nodes: { costCode: { number: {} } } },
      documentPayments: { nodes: { payment: { description: {}, paidAt: {} } } }
    } } } }, key);
    const d = res && res.organization && res.organization.documents;
    if (!d) throw new Error("JobTread did not return the Expense bills.");
    out.push(...(d.nodes || []).map(b => ({
      id: b.id, name: b.fullName, status: b.status, date: b.issueDate, cost: b.cost, description: b.description || "",
      vendor: (b.account && b.account.name) || "", job: flatJob(b.job),
      test: /^test\b/i.test((b.account && b.account.name) || ""),
      codes: ((b.costItems && b.costItems.nodes) || []).map(c => c.costCode && c.costCode.number).filter(Boolean),
      payments: ((b.documentPayments && b.documentPayments.nodes) || []).map(p => p.payment || {}).filter(Boolean)
    })));
    page = d.nextPage || null;
  } while (page && ++guard < 40);
  return out;
}

async function readNoBranch(orgId, key) {
  const out = []; let page = null, guard = 0;
  do {
    const args = { size: 50, with: { br: { _: "customFieldValues", $: { where: { and: [[["customField", "id"], BRANCH_FIELD], ["value", "!=", ""]] } }, count: {} } }, where: { and: [["closedOn", null], [["br", "count"], 0]] } };
    if (page) args.page = page;
    const res = await pave({ organization: { $: { id: orgId }, jobs: { $: args, nextPage: {}, nodes: { id: {}, number: {}, name: {} } } } }, key);
    const j = res && res.organization && res.organization.jobs;
    if (!j) break;
    out.push(...(j.nodes || []));
    page = j.nextPage || null;
  } while (page && ++guard < 20);
  return out;
}

async function build(s) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey || !c.organizationId) { const e = new Error("JobTread is not connected yet. An admin connects it in Settings, Connections."); e.status = 409; throw e; }
  /* One after another: JobTread refuses big requests, and these are light. */
  const cards = await readCards(c.grantKey);
  const km = await readForm(FORMS.km, c.grantKey);
  const reimb = await readForm(FORMS.reimb, c.grantKey);
  const shop = await readForm(FORMS.shop, c.grantKey);
  const bills = await readBills(c.organizationId, c.grantKey);
  const noBranchJobs = await readNoBranch(c.organizationId, c.grantKey);
  const rates = { regular: Number(process.env.KM_RATE) || 0.70, trailer: Number(process.env.KM_TRAILER_RATE) || 0.90 };
  return buildExpenses({ cards, km, reimb, shop, bills, noBranchJobs }, { today: localDay(), rates });
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (!sees(u, "payroll")) return json({ error: "role", message: "Expenses shows what people are owed, so it is for accounts with Payroll ticked. Ask an admin if you need it." }, 403);
  if (req.method !== "GET") return json({ error: "Use GET." }, 405);
  const fresh = new URL(req.url).searchParams.get("fresh") === "1";
  try {
    const hit = await s.get(CACHE, { type: "json" });
    const age = hit ? Date.now() - hit.at : Infinity;
    if (hit && age < TTL && !(fresh && age > 20000)) return json({ ...hit.data, readAt: new Date(hit.at).toISOString() });
    const data = await build(s);
    const at = Date.now();
    try { await s.setJSON(CACHE, { at, data }); } catch (e) {}
    return json({ ...data, readAt: new Date(at).toISOString() });
  } catch (e) {
    const notConnected = e.status === 409;
    return json({ error: notConnected ? "not_connected" : "upstream", message: e.message }, notConnected ? 409 : 502);
  }
};

export const config = { path: "/api/expenses" };
