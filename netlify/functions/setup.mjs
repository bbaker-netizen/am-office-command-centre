/* A&M - Settings, Connections, the one-time JobTread set-up (2026-10-10).

   GET  /api/setup                       which of the twelve fields exist, and whether the billing rules are loaded
   POST /api/setup { action:"fields" }   add any of the twelve fields JobTread does not have yet
   (Loading Craig's billing rules was a one-time job, done 2026-10-10 by Bruce
   Baker: 47 customer records. JobTread owns the rules now, so the loader and
   its copy of the list were removed, so nobody can overwrite a correction
   made in JobTread.)

   Admins only. Uses the app's own JobTread key, the one saved on Connections,
   so Claude's own JobTread connection can stay read-only. Every write is
   logged with the name of the admin who pressed the button, next to every
   other change the app makes to JobTread. JobTread is told not to email
   anybody about any of it. */

import { getStore } from "@netlify/blobs";
import { accountGate, isAdmin } from "./_accounts.mjs";
import { CUSTOMER_FIELDS, pave, fieldIds } from "./_jtfields.mjs";
const ALL_FIELDS = CUSTOMER_FIELDS.map(f => ({ ...f, targetType: "customer" }));

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
  return { fields, missing: fields.filter(f => !f.exists).length, billing: { loaded } };
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
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: "upstream", message: e.message }, 502); }
};

export const config = { path: "/api/setup" };
