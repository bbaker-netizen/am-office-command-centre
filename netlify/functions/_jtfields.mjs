/* A&M - the JobTread fields the command centre added (2026-10-10).

   Eight on each customer hold the billing rules from Craig's sheet "Accounting
   info for invoicing". JobTread owns them; the app reads them. (The crew plan
   was going to be four job fields too, but JobTread allows 25 on a job and A&M
   uses all 25, so it lives on the job's Site Work task instead: see
   command.mjs.) JOB_FIELDS is kept empty so nothing tries to add them.

   Field ids differ per company and do not exist until Settings, Connections,
   "Set up billing and crew fields" creates them, so the app looks them up by
   name and keeps the answer for an hour. */

export const PAVE = "https://api.jobtread.com/pave";

export const CUSTOMER_FIELDS = [
  { name: "Invoice Email", type: "emailAddress" },
  { name: "Invoice Cut-off", type: "text" },
  { name: "PO Required", type: "boolean" },
  { name: "Subcontract Number Required", type: "boolean" },
  { name: "Holdback %", type: "number" },
  { name: "Billing Portal", type: "option", options: ["Email", "Ariba", "Textura"] },
  { name: "Client Template Required", type: "text" },
  { name: "Billing Notes", type: "text" }
];
export const JOB_FIELDS = [];
export const ALL_FIELDS = [
  ...CUSTOMER_FIELDS.map(f => ({ ...f, targetType: "customer" })),
  ...JOB_FIELDS.map(f => ({ ...f, targetType: "job" }))
];

export async function pave(query, grantKey) {
  const r = await fetch(PAVE, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } })
  });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) {
    const e = new Error(`JobTread refused the request: ${body.message || body.raw || "HTTP " + r.status}`.slice(0, 400));
    e.jobtread = String(body.message || body.raw || "");
    throw e;
  }
  return body;
}

/* name|targetType -> id, for every custom field in the company. */
export async function fieldIds(s, c, force) {
  const key = "jt-field-ids";
  const hit = await s.get(key, { type: "json" }).catch(() => null);
  if (hit && !force && Date.now() - hit.at < 3600000) return hit.map;
  const res = await pave({ organization: { $: { id: c.organizationId }, customFields: { $: { size: 100 }, nodes: { id: {}, name: {}, targetType: {}, type: {} } } } }, c.grantKey);
  const map = {};
  for (const f of (res.organization && res.organization.customFields && res.organization.customFields.nodes) || []) map[f.name + "|" + f.targetType] = f.id;
  try { await s.setJSON(key, { at: Date.now(), map }); } catch (e) {}
  return map;
}

/* The cut-off rule as written ("25", "Month end", "5 working days before month
   end") to the next date it falls on, from the given day. */
export function nextCutoff(rule, from) {
  const r = String(rule || "").trim().toLowerCase();
  if (!r) return null;
  const d0 = new Date(from.getFullYear(), from.getMonth(), from.getDate());
  const lastDay = (y, m) => new Date(y, m + 1, 0);
  const pick = fn => { for (let k = 0; k < 3; k++) { const y = d0.getFullYear(), m = d0.getMonth() + k; const d = fn(new Date(y, m, 1).getFullYear(), new Date(y, m, 1).getMonth()); if (d && d >= d0) return d; } return null; };
  const n = r.match(/^(\d{1,2})(st|nd|rd|th)?$/);
  if (n) { const day = Math.min(31, Math.max(1, +n[1])); return pick((y, m) => new Date(y, m, Math.min(day, lastDay(y, m).getDate()))); }
  if (/month\s*end|end of (the )?month/.test(r) && !/working/.test(r)) return pick((y, m) => lastDay(y, m));
  const w = r.match(/(\d+)\s*working days? before (the )?(end of (the )?month|month\s*end)/);
  if (w) return pick((y, m) => { let d = lastDay(y, m), left = +w[1]; while (left > 0) { d = new Date(d.getFullYear(), d.getMonth(), d.getDate() - 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; } return d; });
  return null;
}
