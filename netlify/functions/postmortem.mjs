/* A&M - job post-mortems.

   At the end of a job, Craig, Jen or Amir runs a post-mortem with everyone who
   worked on it. Four perspectives are scored 1 to 10 on four lines each:
   Financial, Operational, Client, and Employees and subcontractors. Each
   perspective scores out of 10, the job scores out of 40, and the meeting ends
   with what to keep doing and commitments that have an owner and a date.

   The numbers are not typed in where a system already holds them:
     JobTread    the plan (the job budget from the approved estimate: price,
                 cost by type, labour hours), the crew's timesheets (actual
                 labour hours, labour cost, days on site, who worked), supplier
                 bills entered against the job, daily logs, and the job fields
     QuickBooks  every invoice whose number carries the job number (PRO-26-00675,
                 PRO-26-00675P2, PRO-26-00675HB), before GST, and what is unpaid
   Anything a system does not hold yet can be typed in on the page, and the
   page says which figures were typed and by whom.

   The post-mortem itself is the record of the meeting, so it lives here, in the
   app. When it is finished the app can post a pinned internal note on the job
   in JobTread, so the lessons sit with the job for whoever quotes the next one.

   GET  /api/postmortem?action=list                  every post-mortem, summarised
   GET  /api/postmortem?action=get&jobId=...         one post-mortem in full
   GET  /api/postmortem?action=facts&jobId=...       plan and actuals from the systems
   POST /api/postmortem {action:"save", record}      save (draft or finished)
   POST /api/postmortem {action:"note", jobId}       post the summary to JobTread
   POST /api/postmortem {action:"commitment", jobId, index, done}

   Owner, office and field leads only. Crew never see this. */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit } from "./_accounts.mjs";
import { withLock } from "./_lock.mjs";
import { query as qboQuery } from "./_qbo.mjs";

const PAVE = "https://api.jobtread.com/pave";
const KEY = "postmortems";
const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const PERSPECTIVES = ["fin", "ops", "cli", "emp"];
const FIGURES = ["price", "labourCost", "labourHours", "materials", "subs", "equipment", "disposal", "other", "days", "crew", "rework"];
const TZ = "America/Edmonton";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const str = (v, n) => String(v == null ? "" : v).slice(0, n);
const num = v => { if (v === "" || v === null || v === undefined) return null; const n = Number(v); return isFinite(n) ? Math.round(n * 100) / 100 : null; };
const day = v => /^\d{4}-\d{2}-\d{2}$/.test(String(v || "")) ? String(v) : "";
const okId = v => /^[A-Za-z0-9_-]{2,40}$/.test(String(v || ""));

/* ---------------------------------------------------------------- scoring */
export function sectionScore(list) {
  const s = (list || []).filter(x => typeof x === "number");
  return s.length === 4 ? Math.round((s.reduce((a, b) => a + b, 0) / 4) * 10) / 10 : null;
}
export function totals(rec) {
  const per = {}; PERSPECTIVES.forEach(p => { per[p] = sectionScore(rec.scores && rec.scores[p]); });
  const all = PERSPECTIVES.every(p => per[p] !== null);
  const total = all ? Math.round(PERSPECTIVES.reduce((a, p) => a + per[p], 0) * 10) / 10 : null;
  return { per, total, grade: grade(total) };
}
export function grade(t) {
  if (t === null || t === undefined) return "";
  return t >= 34 ? "Strong" : t >= 28 ? "Solid" : t >= 22 ? "Watch" : "Problem";
}

/* Only known fields are kept, each to a sensible length, so nothing odd can be
   stored and shown to the next person. */
function clean(r, me, old) {
  const scores = {}, learned = {};
  for (const p of PERSPECTIVES) {
    const a = Array.isArray(r.scores && r.scores[p]) ? r.scores[p] : [];
    scores[p] = [0, 1, 2, 3].map(i => { const n = Number(a[i]); return Number.isInteger(n) && n >= 1 && n <= 10 ? n : null; });
    learned[p] = str(r.learned && r.learned[p], 1500);
  }
  const figures = {};
  for (const k of FIGURES) {
    const f = r.figures && r.figures[k];
    if (f && num(f.value) !== null) {
      const was = old && old.figures && old.figures[k];
      const same = was && was.value === num(f.value);
      figures[k] = { value: num(f.value), by: same ? was.by : me + (f.fromPlan ? ", from the plan" : ""), at: same ? was.at : new Date().toISOString() };
    }
  }
  const keep = (Array.isArray(r.keep) ? r.keep : []).slice(0, 5).map(x => str(x, 300)).filter(Boolean);
  const commitments = (Array.isArray(r.commitments) ? r.commitments : []).slice(0, 12).map(c => ({
    kind: ["start", "stop", "change"].includes(c && c.kind) ? c.kind : "change",
    what: str(c && c.what, 400), owner: str(c && c.owner, 60), due: day(c && c.due), done: !!(c && c.done),
    doneAt: c && c.done ? (str(c.doneAt, 30) || new Date().toISOString()) : ""
  })).filter(c => c.what);
  return {
    jobId: str(r.jobId, 40), number: str(r.number, 30), name: str(r.name, 160), client: str(r.client, 160), pm: str(r.pm, 60),
    jobType: str(r.jobType, 60),
    status: r.status === "finished" ? "finished" : "draft",
    facilitator: str(r.facilitator, 60), date: day(r.date), attendees: (Array.isArray(r.attendees) ? r.attendees : []).slice(0, 20).map(x => str(x, 60)).filter(Boolean),
    standout: str(r.standout, 120), scores, learned, figures, keep, commitments,
    snapshot: r.snapshot && typeof r.snapshot === "object" ? JSON.parse(JSON.stringify(r.snapshot).slice(0, 20000) || "{}") : (old && old.snapshot) || null,
    createdBy: (old && old.createdBy) || me, createdAt: (old && old.createdAt) || new Date().toISOString(),
    updatedBy: me, updatedAt: new Date().toISOString(),
    finishedAt: r.status === "finished" ? ((old && old.finishedAt) || new Date().toISOString()) : "",
    notePostedAt: (old && old.notePostedAt) || ""
  };
}
function summary(r) {
  const t = totals(r);
  return { jobId: r.jobId, number: r.number, name: r.name, client: r.client, pm: r.pm, jobType: r.jobType, status: r.status, facilitator: r.facilitator,
    date: r.date, updatedAt: r.updatedAt, updatedBy: r.updatedBy, per: t.per, total: t.total, grade: t.grade,
    margin: r.snapshot && r.snapshot.margin, commitments: r.commitments, notePostedAt: r.notePostedAt };
}

/* ---------------------------------------------------------------- JobTread */
async function pave(q, grantKey) {
  const r = await fetch(PAVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: { $: { grantKey }, ...q } }) });
  const text = await r.text(); let b; try { b = JSON.parse(text); } catch { b = { raw: text }; }
  if (!r.ok) throw new Error(("JobTread refused the request: " + (b.message || b.raw || "HTTP " + r.status)).slice(0, 300));
  return b;
}
const TYPES = [["materials", "Materials and supplies"], ["subs", "Subcontractor"], ["equipment", "Equipment"], ["disposal", "Disposal"]];
const localDate = iso => new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

async function jobFacts(c, jobId) {
  const budget = w => ({ _: "costItems", $: { where: { and: [[["document", "id"], null], ...w] } }, cost: { _: "sum", $: "cost" } });
  const billed = w => ({ _: "costItems", $: { where: { and: [[["document", "type"], "vendorBill"], ...w] } }, cost: { _: "sum", $: "cost" } });
  const q = { job: { $: { id: jobId },
    id: {}, number: {}, name: {}, createdAt: {}, closedOn: {}, actualCost: {},
    location: { address: {}, account: { name: {} } },
    customFieldValues: { $: { size: 60 }, nodes: { value: {}, customField: { name: {} } } },
    bAll: { _: "costItems", $: { where: [["document", "id"], null] }, cost: { _: "sum", $: "cost" }, price: { _: "sum", $: "price" }, count: {} },
    bLab: budget([[["costType", "name"], "Labour"]]),
    bHrs: { _: "costItems", $: { where: { and: [[["document", "id"], null], [["costType", "name"], "Labour"], [["unit", "name"], "Hours"]] } }, q: { _: "sum", $: "quantity" } },
    vAll: { _: "costItems", $: { where: [["document", "type"], "vendorBill"] }, cost: { _: "sum", $: "cost" }, count: {} },
    orders: { _: "documents", $: { where: { and: [["type", "customerOrder"], ["status", "approved"]] }, size: 20 }, nodes: { name: {}, number: {}, price: {}, cost: {}, issueDate: {} } },
    dailyLogs: { count: {} },
    timeEntries: { minutes: { _: "sum", $: "minutes" }, cost: { _: "sum", $: "cost" }, count: {} }
  } };
  for (const [k, t] of TYPES) { q.job["b_" + k] = budget([[["costType", "name"], t]]); q.job["v_" + k] = billed([[["costType", "name"], t]]); }
  const res = await pave(q, c.grantKey);
  const j = res && res.job;
  if (!j) throw new Error("JobTread did not return that job.");

  /* Timesheets, page by page, for days on site, crew per day and who worked. */
  const entries = []; let page = null, guard = 0;
  do {
    const a = { size: 100 }; if (page) a.page = page;
    const r = await pave({ job: { $: { id: jobId }, timeEntries: { $: a, nextPage: {}, nodes: { startedAt: {}, minutes: {}, cost: {}, user: { name: {} } } } } }, c.grantKey);
    const te = r && r.job && r.job.timeEntries; if (!te) break;
    entries.push(...(te.nodes || [])); page = te.nextPage || null;
  } while (page && ++guard < 30);

  const f = {}; ((j.customFieldValues && j.customFieldValues.nodes) || []).forEach(x => { if (x.customField) f[x.customField.name] = x.value; });
  const days = {}, people = {};
  for (const e of entries) {
    if (!e.startedAt) continue;
    const d = localDate(e.startedAt), who = (e.user && e.user.name) || "Unknown";
    (days[d] = days[d] || new Set()).add(who);
    people[who] = (people[who] || 0) + (Number(e.minutes) || 0);
  }
  const dayList = Object.keys(days).sort();
  const crewAvg = dayList.length ? Math.round(dayList.reduce((a, d) => a + days[d].size, 0) / dayList.length * 10) / 10 : null;
  const labourMin = Number(j.timeEntries && j.timeEntries.minutes) || 0;
  const tempMin = Object.entries(people).filter(([n]) => /\(.*\)/.test(n)).reduce((a, [, m]) => a + m, 0);
  const orders = ((j.orders && j.orders.nodes) || []).slice().sort((a, b) => String(a.issueDate || "").localeCompare(String(b.issueDate || "")));

  const plan = {
    price: num(j.bAll && j.bAll.price), cost: num(j.bAll && j.bAll.cost), lines: (j.bAll && j.bAll.count) || 0,
    labourCost: num(j.bLab && j.bLab.cost), labourHours: num(j.bHrs && j.bHrs.q),
    days: num(f["Estimated Days of Work"]), crew: num(f["Number of Guys Required"]), start: String(f["Expected Date of Project Start"] || "").slice(0, 10)
  };
  for (const [k] of TYPES) plan[k] = num(j["b_" + k] && j["b_" + k].cost);
  plan.other = plan.cost !== null ? num(plan.cost - [plan.labourCost, plan.materials, plan.subs, plan.equipment, plan.disposal].reduce((a, b) => a + (b || 0), 0)) : null;
  if (plan.other !== null && Math.abs(plan.other) < 2) plan.other = 0;

  const actual = {
    cost: num(j.actualCost), labourCost: num(j.timeEntries && j.timeEntries.cost), labourHours: num(labourMin / 60),
    days: dayList.length || null, crew: crewAvg, firstDay: dayList[0] || "", lastDay: dayList[dayList.length - 1] || "",
    entries: (j.timeEntries && j.timeEntries.count) || 0, billsCount: (j.vAll && j.vAll.count) || 0, billsCost: num(j.vAll && j.vAll.cost),
    tempShare: labourMin ? Math.round(tempMin / labourMin * 100) : null,
    people: Object.entries(people).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([name, m]) => ({ name, hours: Math.round(m / 6) / 10 }))
  };
  for (const [k] of TYPES) actual[k] = (j.vAll && j.vAll.count) ? num(j["v_" + k] && j["v_" + k].cost) || 0 : null;
  if (actual.cost !== null) {
    const known = (actual.labourCost || 0) + [actual.materials, actual.subs, actual.equipment, actual.disposal].reduce((a, b) => a + (b || 0), 0);
    actual.other = (j.vAll && j.vAll.count) ? num(Math.max(0, actual.cost - known)) : null;
  }

  return {
    job: { id: j.id, number: j.number || "", name: j.name || "", client: (j.location && j.location.account && j.location.account.name) || "",
      address: (j.location && j.location.address) || "", createdAt: j.createdAt, closedOn: j.closedOn,
      status: f["Status"] || "", pm: f["Project Manager"] || "", jobType: f["Job Type"] || "", riskLevel: f["Risk Level"] || "",
      nopFiled: f["NOP Filed Date and Time"] || "", branch: f["Estimating branch"] || "" },
    plan, actual, dailyLogs: (j.dailyLogs && j.dailyLogs.count) || 0,
    estimates: orders.map((o, i) => ({ name: o.name, number: o.number, price: num(o.price), cost: num(o.cost), date: o.issueDate || "", change: i > 0 }))
  };
}

/* -------------------------------------------------------------- QuickBooks */
/* Every invoice whose number carries the job number, with nothing but letters
   after it (P2, HB, E, -CONT) so 26-00675 never picks up 26-006751. */
export function matchInvoice(doc, number) {
  if (!number) return false;
  const i = String(doc || "").toUpperCase().indexOf(String(number).toUpperCase());
  if (i < 0) return false;
  const before = String(doc).charAt(i - 1), after = String(doc).charAt(i + number.length);
  return !/\d/.test(before) && !/\d/.test(after);
}
async function invoiceFacts(number, since) {
  const from = since ? String(since).slice(0, 10) : "2025-01-01";
  const found = []; let start = 1, guard = 0;
  while (guard++ < 10) {
    const res = await qboQuery(`select * from Invoice where TxnDate >= '${from}' startposition ${start} maxresults 1000`);
    const list = (res && res.QueryResponse && res.QueryResponse.Invoice) || [];
    for (const inv of list) if (matchInvoice(inv.DocNumber, number)) {
      const tax = Number(inv.TxnTaxDetail && inv.TxnTaxDetail.TotalTax) || 0;
      found.push({ doc: inv.DocNumber, date: inv.TxnDate, due: inv.DueDate || "", total: num(inv.TotalAmt), beforeGst: num((Number(inv.TotalAmt) || 0) - tax),
        unpaid: num(inv.Balance), holdback: /HB$/i.test(String(inv.DocNumber || "").trim()) });
    }
    if (list.length < 1000) break;
    start += 1000;
  }
  found.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return {
    list: found, billed: num(found.reduce((a, x) => a + (x.beforeGst || 0), 0)), unpaid: num(found.reduce((a, x) => a + (x.unpaid || 0), 0)),
    holdback: num(found.filter(x => x.holdback).reduce((a, x) => a + (x.beforeGst || 0), 0)), firstDate: found.length ? found[0].date : ""
  };
}

/* ------------------------------------------------------------ JobTread note */
export function noteText(r) {
  const t = totals(r), L = { fin: "Financial", ops: "Operational", cli: "Client", emp: "Employees and subcontractors" };
  const lines = [`Post-mortem ${r.date || ""}, run by ${r.facilitator || "the office"}.`, `Score ${t.total === null ? "not finished" : t.total + " out of 40, " + t.grade}.`];
  for (const p of PERSPECTIVES) lines.push(`${L[p]}: ${t.per[p] === null ? "not scored" : t.per[p] + " out of 10"}.${r.learned[p] ? " Learned: " + r.learned[p] : ""}`);
  if (r.keep.length) lines.push("Keep doing: " + r.keep.join("; ") + ".");
  r.commitments.forEach(c => lines.push(`${c.kind === "start" ? "Start" : c.kind === "stop" ? "Stop" : "Change"}: ${c.what} (${c.owner || "no owner"}, by ${c.due || "no date"}).`));
  if (r.attendees.length) lines.push("In the room: " + r.attendees.join(", ") + ".");
  lines.push("Full post-mortem in the A&M Office Command Centre, Field, Post mortem.");
  return lines.join("\n").slice(0, 4000);
}

/* ---------------------------------------------------------------- handler */
export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  if (!sees(req.amUser, "office", "field")) return json({ error: "role", message: "Post-mortems are for the office and the field. Ask an admin if you need them." }, 403);
  const me = req.amUser.name;
  const url = new URL(req.url);
  let action = url.searchParams.get("action") || "list", body = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { return json({ error: "bad_json" }, 400); } action = body.action || ""; }
  if (req.method === "POST" && !canEdit(req.amUser)) return json({ error: "role", message: "Your account can read post-mortems but not change them." }, 403);

  try {
    const all = (await s.get(KEY, { type: "json" })) || { records: {} };
    if (action === "list") return json({ records: Object.values(all.records).map(summary) });
    if (action === "get") {
      const id = url.searchParams.get("jobId");
      if (!okId(id)) return json({ error: "bad_job" }, 400);
      return json({ record: all.records[id] || null });
    }
    if (action === "facts") {
      const id = url.searchParams.get("jobId");
      if (!okId(id)) return json({ error: "bad_job" }, 400);
      const cacheKey = "pm-facts-" + id, fresh = url.searchParams.get("fresh") === "1";
      const hit = await s.get(cacheKey, { type: "json" });
      if (hit && !fresh && Date.now() - hit.at < 600000) return json({ ...hit.data, storedAt: hit.at });
      const out = { errors: {} };
      const c = (await s.get("jobtread-key", { type: "json" })) || {};
      if (!c.grantKey) out.errors.jobtread = "JobTread is not connected yet. Connect it in Settings.";
      else { try { Object.assign(out, await jobFacts(c, id)); } catch (e) { out.errors.jobtread = e.message; } }
      if (out.job && out.job.number) {
        try { out.invoices = await invoiceFacts(out.job.number, out.job.createdAt); } catch (e) { out.errors.quickbooks = e.message; }
      }
      const at = Date.now();
      if (out.job) { try { await s.setJSON(cacheKey, { at, data: out }); } catch (e) {} }
      return json({ ...out, storedAt: at });
    }
    if (action === "save") {
      const r = body.record || {};
      if (!okId(r.jobId)) return json({ error: "bad_job", message: "That job id does not look right." }, 400);
      const saved = await withLock(s, "postmortems", async () => {
        const doc = (await s.get(KEY, { type: "json" })) || { records: {} };
        const rec = clean(r, me, doc.records[r.jobId]);
        doc.records[r.jobId] = rec;
        await s.setJSON(KEY, doc);
        return rec;
      });
      return json({ ok: true, record: saved, summary: summary(saved) });
    }
    if (action === "commitment") {
      if (!okId(body.jobId)) return json({ error: "bad_job" }, 400);
      const saved = await withLock(s, "postmortems", async () => {
        const doc = (await s.get(KEY, { type: "json" })) || { records: {} };
        const rec = doc.records[body.jobId]; const c = rec && rec.commitments[Number(body.index)];
        if (!c) return null;
        c.done = !!body.done; c.doneAt = c.done ? new Date().toISOString() : "";
        rec.updatedBy = me; rec.updatedAt = new Date().toISOString();
        await s.setJSON(KEY, doc); return rec;
      });
      return saved ? json({ ok: true, summary: summary(saved) }) : json({ error: "not_found" }, 404);
    }
    if (action === "note") {
      if (!okId(body.jobId)) return json({ error: "bad_job" }, 400);
      const rec = all.records[body.jobId];
      if (!rec || rec.status !== "finished") return json({ error: "not_finished", message: "Finish the post-mortem before posting it to JobTread." }, 400);
      const c = (await s.get("jobtread-key", { type: "json" })) || {};
      if (!c.grantKey) return json({ error: "not_connected", message: "JobTread is not connected yet." }, 409);
      await pave({ createComment: { $: { targetType: "job", targetId: rec.jobId, name: "Post-mortem " + (rec.date || ""), message: noteText(rec),
        isPinned: true, isVisibleToInternalRoles: true, isVisibleToCustomerRoles: false, isVisibleToVendorRoles: false }, createdComment: { id: {} } } }, c.grantKey);
      await withLock(s, "postmortems", async () => {
        const doc = (await s.get(KEY, { type: "json" })) || { records: {} };
        if (doc.records[rec.jobId]) { doc.records[rec.jobId].notePostedAt = new Date().toISOString(); await s.setJSON(KEY, doc); }
      });
      try {
        const log = (await s.get("jobtread-log", { type: "json" })) || { entries: [] };
        log.entries.unshift({ at: new Date().toISOString(), action: "postmortemNote", by: me, jobId: rec.jobId });
        log.entries = log.entries.slice(0, 300); await s.setJSON("jobtread-log", log);
      } catch (e) {}
      return json({ ok: true });
    }
    return json({ error: "unknown_action" }, 400);
  } catch (e) {
    return json({ error: "upstream", message: e.message }, 502);
  }
};

export const config = { path: "/api/postmortem" };
