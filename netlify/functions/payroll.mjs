/* A&M - the payroll page's server.

   GET  /api/payroll?action=report&start=YYYY-MM-DD   the split for one pay period
   GET  /api/payroll?action=settings                  periods, overhead jobs, account choices
   GET  /api/payroll?action=lists                     QuickBooks accounts, classes and locations to choose from
   POST /api/payroll { action:"settings", settings }  save the choices
   POST /api/payroll { action:"journal", start, costs, post }
        Without post: shows the journal entry the costs would make.
        With post:true: posts it to QuickBooks, once per pay period.
   POST /api/payroll { action:"forget", start }       clears the posted record, after the entry was deleted in QuickBooks

   Accounts with Payroll ticked only, because it shows what people are paid.
   Payroll is its own area from v71. Money no longer opens it.
   Saving settings and posting need an account that can make changes.

   Reads JobTread with A&M's key, the same one the command centre uses. Writes
   to QuickBooks only when a person presses Post, through the same Intuit app
   connection (Workplaces Bookkeeping Agent, accounting permission). Nothing is
   ever written to JobTread.

   Hours are not sent into QuickBooks as time activities yet. QuickBooks needs
   to be told which pay type each hour is (regular or overtime) and that list is
   only open to apps with Intuit's payroll permission. Sent without it, overtime
   would come in as regular time and people would be paid wrong. */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit } from "./_accounts.mjs";
import { query, qboPost, readTokens } from "./_qbo.mjs";
import { withDefaults, periodFor, buildReport, buildJournal, COS_BUCKETS } from "./_payroll.mjs";

const STORE = "am-inventory";
const PAVE = "https://api.jobtread.com/pave";
const SETTINGS_KEY = "payroll-settings";
const POSTED = start => "payroll-posted-" + start;
const store = () => getStore({ name: STORE, consistency: "strong" });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

async function pave(query, grantKey) {
  const r = await fetch(PAVE, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ query: { $: { grantKey }, ...query } }) });
  const text = await r.text();
  let body; try { body = JSON.parse(text); } catch { body = { raw: text }; }
  if (!r.ok) throw new Error(`JobTread refused the request: ${body.message || body.raw || "HTTP " + r.status}`.slice(0, 300));
  return body;
}

async function readEntries(s, period) {
  const c = (await s.get("jobtread-key", { type: "json" })) || {};
  if (!c.grantKey || !c.organizationId) { const e = new Error("JobTread is not connected yet. The office connects it in Settings, JobTread link."); e.status = 409; throw e; }
  const out = []; let page = null, guard = 0;
  do {
    const args = { size: 50, where: { and: [["startedAt", ">=", period.startUtc], ["startedAt", "<", period.endUtc]] } };
    if (page) args.page = page;
    const res = await pave({ organization: { $: { id: c.organizationId }, timeEntries: { $: args, nextPage: {}, nodes: {
      id: {}, minutes: {}, type: {}, isApproved: {}, startedAt: {}, endedAt: {},
      user: { id: {}, name: {} },
      costItem: { name: {}, costCode: { number: {}, name: {} } },
      job: { id: {}, number: {}, name: {}, location: { city: {} },
        customFieldValues: { $: { where: [["customField", "name"], "Estimating branch"] }, nodes: { value: {} } } }
    } } } }, c.grantKey);
    const te = res && res.organization && res.organization.timeEntries;
    if (!te) throw new Error("JobTread did not return the timesheets.");
    out.push(...(te.nodes || []));
    page = te.nextPage || null;
  } while (page && ++guard < 60);
  return out;
}

async function readSettings(s) { return withDefaults(await s.get(SETTINGS_KEY, { type: "json" })); }

function cleanSettings(incoming, existing) {
  const s = withDefaults(existing);
  const i = incoming || {};
  if (/^\d{4}-\d{2}-\d{2}$/.test(i.anchor || "")) s.anchor = i.anchor;
  if ([7, 14].includes(Number(i.periodDays))) s.periodDays = Number(i.periodDays);
  if (Number(i.otMultiplier) >= 1 && Number(i.otMultiplier) <= 3) s.otMultiplier = Number(i.otMultiplier);
  if (i.overheadJobs && typeof i.overheadJobs === "object") {
    const o = {};
    for (const [k, v] of Object.entries(i.overheadJobs)) { const kk = String(k).trim(), vv = String(v || "").trim(); if (kk && vv) o[kk.slice(0, 30)] = vv.slice(0, 40); }
    if (Object.keys(o).length) s.overheadJobs = o;
  }
  const pick = m => m && m.accountId ? { accountId: String(m.accountId), accountName: String(m.accountName || ""), classId: m.classId ? String(m.classId) : "", className: String(m.className || ""), departmentId: m.departmentId ? String(m.departmentId) : "", departmentName: String(m.departmentName || "") } : null;
  if (i.map && typeof i.map === "object") {
    const m = {};
    for (const b of COS_BUCKETS) { const v = pick(i.map[b]); if (v) m[b] = v; }
    s.map = m;
  }
  if ("credit" in i) s.credit = pick(i.credit);
  return s;
}

async function lists() {
  const all = async (sql, key) => { const r = await query(sql); return (r && r.QueryResponse && r.QueryResponse[key]) || []; };
  const [accounts, classes, departments] = await Promise.all([
    all("select * from Account where Active = true maxresults 1000", "Account"),
    all("select * from Class where Active = true maxresults 1000", "Class").catch(() => []),
    all("select * from Department where Active = true maxresults 1000", "Department").catch(() => [])
  ]);
  return {
    accounts: accounts.map(a => ({ id: a.Id, name: a.FullyQualifiedName || a.Name, type: a.AccountType })).sort((a, b) => a.name.localeCompare(b.name)),
    classes: classes.map(c => ({ id: c.Id, name: c.FullyQualifiedName || c.Name })).sort((a, b) => a.name.localeCompare(b.name)),
    departments: departments.map(d => ({ id: d.Id, name: d.FullyQualifiedName || d.Name })).sort((a, b) => a.name.localeCompare(b.name))
  };
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (!sees(u, "payroll")) return json({ error: "role", message: "Payroll is for accounts that have Payroll ticked. Ask an admin if you need it." }, 403);

  try {
    if (req.method === "GET") {
      const url = new URL(req.url);
      const action = url.searchParams.get("action") || "report";
      const settings = await readSettings(s);
      if (action === "settings") return json({ settings });
      if (action === "lists") return json(await lists());
      if (action === "report") {
        const period = periodFor(url.searchParams.get("start"), settings);
        const report = buildReport(await readEntries(s, period), settings, period);
        const posted = await s.get(POSTED(period.start), { type: "json" });
        const t = await readTokens().catch(() => null);
        return json({ report, posted: posted || null, quickbooks: !!(t && t.refresh_token), settings, readAt: new Date().toISOString() });
      }
      return json({ error: "Unknown action." }, 400);
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);

    const body = await req.json().catch(() => ({}));
    const settings = await readSettings(s);
    const changes = body.action === "settings" || body.action === "forget" || (body.action === "journal" && body.post);
    if (changes && !canEdit(u)) return json({ error: "role", message: "Your account can look at payroll but not change settings or post. Ask an admin if you need to." }, 403);
    if (body.action === "settings") {
      const next = cleanSettings(body.settings, settings);
      next.updatedBy = req.amUser.name; next.updatedAt = new Date().toISOString();
      await s.setJSON(SETTINGS_KEY, next);
      return json({ settings: next });
    }
    if (body.action === "journal") {
      /* Worked out again here from JobTread, never trusted from the page. */
      const period = periodFor(body.start, settings);
      const report = buildReport(await readEntries(s, period), settings, period);
      const j = buildJournal(report, body.costs || {}, settings);
      const posted = await s.get(POSTED(period.start), { type: "json" });
      if (!body.post) return json({ journal: j, posted: posted || null });
      if (posted) return json({ error: "already_posted", message: `This pay period was already posted to QuickBooks by ${posted.by} (journal entry ${posted.docNumber}). Delete it in QuickBooks first, then press Clear the posted record.`, posted }, 409);
      if (report.open.some(o => !o.temp)) return json({ error: "open", message: "Somebody is still clocked in for this period. Fix their clock-out in JobTread first." }, 409);
      if (!j.ok) return json({ error: "not_ready", message: j.errors[0] || "Nothing to move.", journal: j }, 400);
      const res = await qboPost("journalentry", j.payload);
      const je = res && res.JournalEntry;
      const rec = { start: period.start, end: period.end, id: je && je.Id, docNumber: j.docNumber, moved: j.moved, lines: j.lines, perEmployee: j.perEmployee, unapprovedHours: report.totals.unapproved, by: req.amUser.name, at: new Date().toISOString() };
      await s.setJSON(POSTED(period.start), rec);
      return json({ posted: rec, journal: j });
    }
    if (body.action === "forget") {
      const period = periodFor(body.start, settings);
      await s.delete(POSTED(period.start));
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    const notConnected = e.code === "NOT_CONNECTED" || e.status === 409;
    return json({ error: notConnected ? "not_connected" : "upstream", message: e.message }, notConnected ? 409 : 502);
  }
};

export const config = { path: "/api/payroll" };
