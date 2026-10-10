/* A&M - Settings, Connections, the one-time JobTread set-up (2026-10-10).

   GET  /api/setup                       which of the twelve fields exist, and whether the billing rules are loaded
   POST /api/setup { action:"fields" }   add any of the twelve fields JobTread does not have yet
   POST /api/setup { action:"billing" }  write Craig's billing rules onto the matched JobTread customers

   Admins only. Uses the app's own JobTread key, the one saved on Connections,
   so Claude's own JobTread connection can stay read-only. Every write is
   logged with the name of the admin who pressed the button, next to every
   other change the app makes to JobTread. JobTread is told not to email
   anybody about any of it. */

import { getStore } from "@netlify/blobs";
import { accountGate, isAdmin } from "./_accounts.mjs";
import { CUSTOMER_FIELDS, pave, fieldIds } from "./_jtfields.mjs";
const ALL_FIELDS = CUSTOMER_FIELDS.map(f => ({ ...f, targetType: "customer" }));
import { BILLING_RULES } from "./_billingrules.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function logIt(s, by, action, changes) {
  try {
    const d = (await s.get("jobtread-log", { type: "json" })) || { entries: [] };
    d.entries.unshift({ at: new Date().toISOString(), action, by, changes });
    d.entries = d.entries.slice(0, 300);
    await s.setJSON("jobtread-log", d);
  } catch (e) {}
}

async function status(s, c) {
  const map = await fieldIds(s, c, true);
  const fields = ALL_FIELDS.map(f => ({ name: f.name, on: f.targetType, exists: !!map[f.name + "|" + f.targetType] }));
  const loaded = await s.get("billing-rules-loaded", { type: "json" }).catch(() => null);
  return { fields, missing: fields.filter(f => !f.exists).length, billing: { rules: BILLING_RULES.length, loaded } };
}

async function addFields(s, c, who) {
  const map = await fieldIds(s, c, true);
  const added = [], failed = [];
  for (const f of ALL_FIELDS) {
    if (map[f.name + "|" + f.targetType]) continue;
    const args = { organizationId: c.organizationId, targetType: f.targetType, name: f.name, type: f.type, minValuesRequired: 0 };
    if (f.options) args.options = f.options;
    try {
      await pave({ createCustomField: { $: args, createdCustomField: { id: {} } } }, c.grantKey);
      added.push(f.name + " (" + f.targetType + ")");
    } catch (e) {
      failed.push({ field: f.name + " (" + f.targetType + ")", why: e.message });
      /* A key without permission fails the same way every time; stop at the first. */
      if (/requires the "updateOrganization" action|not allow/i.test(e.message)) break;
    }
  }
  if (added.length) await logIt(s, who, "createCustomField", added);
  const after = await status(s, c);
  const noRight = failed.some(f => /updateOrganization|not allow/i.test(f.why));
  return { added, failed, noRight, ...after };
}

/* JobTread will not save a customer whose required "Type" is empty, and only
   about one customer in fourteen has one. So for a customer with no Type, the
   app fills it in with its best reading and lists it in the result for Jen to
   check: public bodies are "Institution (Hospital, School etc.)", every other
   client on Craig's sheet is a contractor or property company, "Commercial".
   A Type already set is never changed. */
const PUBLIC_BODIES = ["22PSLrujDBxB", "22PSLrvYLyEV", "22PSLs2e3AaB"]; /* City of Edmonton, Edmonton Public Schools, Strathcona County */
async function loadBilling(s, c, who) {
  const map = await fieldIds(s, c, true);
  const ids = {}; const missing = [];
  for (const f of CUSTOMER_FIELDS) { const id = map[f.name + "|customer"]; if (id) ids[f.name] = id; else missing.push(f.name); }
  if (missing.length) return { ok: false, message: "Add the fields first. JobTread does not have: " + missing.join(", ") + "." };
  const typeId = map["Type|customer"];
  const done = [], failed = [], typed = [];
  const jobs = BILLING_RULES.map((r, i) => async () => {
    const values = {};
    for (const f of CUSTOMER_FIELDS) if (r[f.name] !== undefined && r[f.name] !== null && r[f.name] !== "") values[ids[f.name]] = r[f.name];
    if (!Object.keys(values).length) return;
    const have = ((cur[r.accountId] && cur[r.accountId].customFieldValues && cur[r.accountId].customFieldValues.nodes) || []);
    if (typeId && !have.some(v => v.customField && v.customField.name === "Type" && v.value)) {
      const t = PUBLIC_BODIES.includes(r.accountId) ? "Institution (Hospital, School etc.)" : "Commercial";
      values[typeId] = t; typed.push(r.customer + ": " + t);
    }
    try {
      /* JobTread wants nothing asked back from an update. */
      await pave({ updateAccount: { $: { id: r.accountId, customFieldValues: values } } }, c.grantKey);
      done.push(r.customer);
    } catch (e) { failed.push({ customer: r.customer, why: e.message }); }
  });
  /* Eight at a time, so 47 customers take a few seconds, not half a minute.
     Each eight are read first, to see whether Type is already set. All 47 in
     one read was "Request Entity Too Large", so the reads go in eights too. */
  const cur = {};
  for (let i = 0; i < jobs.length; i += 8) {
    const q = {};
    BILLING_RULES.slice(i, i + 8).forEach((r, k) => { q["a" + k] = { _: "account", $: { id: r.accountId }, id: {}, customFieldValues: { $: { size: 15 }, nodes: { value: {}, customField: { name: {} } } } }; });
    const res = await pave(q, c.grantKey);
    Object.values(res || {}).forEach(a => { if (a && a.id) cur[a.id] = a; });
    await Promise.all(jobs.slice(i, i + 8).map(f => f()));
  }
  const stamp = { at: new Date().toISOString(), by: who, customers: done.length, failed: failed.length, typeFilled: typed.length };
  if (done.length) { await logIt(s, who, "updateAccount billing rules", done.concat(typed.map(t => "Type set, " + t))); await s.setJSON("billing-rules-loaded", stamp); }
  try { await s.delete("cc-cache-billing"); } catch (e) {}
  return { ok: !failed.length, done, failed, typed, loaded: stamp };
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (!isAdmin(u)) return json({ error: "role", message: "Only an admin can set up JobTread from here." }, 403);
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey || !c.organizationId) return json({ error: "not_connected", message: "Connect JobTread first, on this page." }, 409);
  try {
    if (req.method === "GET") return json(await status(s, c));
    if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
    const body = await req.json().catch(() => ({}));
    if (body.action === "fields") return json(await addFields(s, c, u.name));
    if (body.action === "billing") return json(await loadBilling(s, c, u.name));
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: "upstream", message: e.message }, 502); }
};

export const config = { path: "/api/setup" };
