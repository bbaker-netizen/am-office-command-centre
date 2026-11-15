/* A&M - the weekly cash flow (Office, Cash flow).

   GET  /api/cashflow                 the weeks, worked out now
   GET  /api/cashflow?fresh=1         the same, reading QuickBooks again
   POST /api/cashflow { action, ... } change the plan (Money and Make changes):
     add      { item }                a planned payment or other money in
     update   { id, item }
     remove   { id }
     done     { key }                 tick: paid, or received ("I just paid this")
     undo     { key }
     place    { key, week }           put an invoice or bill in a week (Monday), "later", or null for its due date
     settings { limit, floor, graceDays }

   Who: anyone who sees Money reads it; changing it needs Make changes as well.
   What it reads: open invoices and bills from QuickBooks (with due dates),
   the bank balance Craig types under Money (bank-actual, see _bank.mjs), and
   the plan kept here ("cashflow-plan"). It writes to nothing but the plan.
   The first read with no plan copies Craig's planned payments from his sheet
   once (_cfseed.mjs). */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit } from "./_accounts.mjs";
import { qboGet, query as qboQuery } from "./_qbo.mjs";
import { readPayableDetail, readReceivableDetail, readBalanceSheet } from "./_qboreports.mjs";
import { KEY as BANK_KEY, readBankAccounts, lastEntryDate } from "./_bank.mjs";
import { buildCashFlow, openingBalance, cleanItem, weekZero, mondayOf, CATEGORIES } from "./_cashflow.mjs";
import { SEED_ITEMS, SEED_FROM } from "./_cfseed.mjs";
import { withLock } from "./_lock.mjs";
import { localDay } from "./_derive.mjs";

const STORE = "am-inventory", PLAN = "cashflow-plan", QCACHE = "cc-cache-cashflow-qbo";
const store = () => getStore({ name: STORE, consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function readPlan(s) {
  let p = await s.get(PLAN, { type: "json" });
  if (!p) {
    p = { items: SEED_ITEMS.map(x => ({ ...x })), done: {}, place: {}, settings: { limit: 750000, floor: 25000, graceDays: 14, reserveGrowth: 0 }, seededFrom: SEED_FROM, seededAt: new Date().toISOString(), log: [] };
    await s.setJSON(PLAN, p);
  }
  p.done = p.done || {}; p.place = p.place || {}; p.settings = { limit: 750000, floor: 25000, graceDays: 14, reserveGrowth: 0, ...(p.settings || {}) }; p.log = p.log || [];
  return p;
}

/* QuickBooks, kept five minutes so ten openings are one read. */
async function readQbo(s, fresh) {
  const hit = await s.get(QCACHE, { type: "json" });
  if (hit && Date.now() - hit.at < 300000 && !(fresh && Date.now() - hit.at > 20000)) return { ...hit.data, readAt: hit.at };
  const today = localDay();
  const invoices = readReceivableDetail(await qboGet("reports/AgedReceivableDetail", { report_date: today }));
  const bills = readPayableDetail(await qboGet("reports/AgedPayableDetail", { report_date: today }));
  let cash = null, lastEntry = null;
  try {
    cash = readBalanceSheet(await qboGet("reports/BalanceSheet", { start_date: today, end_date: today, accounting_method: "Accrual" })).cash;
    const accounts = readBankAccounts(await qboQuery("select * from Account where AccountType = 'Bank'"));
    if (accounts.length) {
      const from = new Date(Date.parse(today + "T12:00:00Z") - 60 * 86400000).toISOString().slice(0, 10);
      lastEntry = lastEntryDate(await qboGet("reports/GeneralLedger", { start_date: from, end_date: today, account: accounts.map(a => a.id).join(","), columns: "tx_date", accounting_method: "Accrual" }), today, accounts.map(a => a.name));
    }
  } catch (e) {}
  const data = { invoices, bills, cash, lastEntry };
  const at = Date.now();
  try { await s.setJSON(QCACHE, { at, data }); } catch (e) {}
  return { ...data, readAt: at };
}

/* Ticks and placements for invoices or bills QuickBooks no longer lists are
   dropped, so the plan does not fill up with old keys. Ticks on planned
   payments older than 26 weeks go too. */
function tidy(plan, q) {
  const live = new Set();
  for (const x of q.invoices || []) live.add(("inv:" + [x.type, x.num, x.customer, x.date].join("|")).toLowerCase());
  for (const x of q.bills || []) live.add(("bill:" + [x.type, x.num, x.vendor, x.date].join("|")).toLowerCase());
  const cutoff = new Date(Date.now() - 182 * 86400000).toISOString().slice(0, 10);
  let changed = false;
  for (const k of Object.keys(plan.done)) {
    if ((k.startsWith("inv:") || k.startsWith("bill:")) && !live.has(k)) { delete plan.done[k]; changed = true; }
    else if (k.startsWith("item:") && k.slice(-10) < cutoff) { delete plan.done[k]; changed = true; }
  }
  for (const k of Object.keys(plan.place)) if (!live.has(k)) { delete plan.place[k]; changed = true; }
  return changed;
}

export async function cashFlowFor(s, fresh) {
  const plan = await readPlan(s);
  const q = await readQbo(s, fresh);
  if (tidy(plan, q)) await s.setJSON(PLAN, plan).catch(() => {});
  const bank = (await s.get(BANK_KEY, { type: "json" })) || { history: [] };
  const today = localDay();
  const opening = openingBalance({ today, history: bank.history, qbo: { amount: q.cash, lastEntry: q.lastEntry } });
  const cf = buildCashFlow({ today, weeks: 4, ...plan.settings, opening, invoices: q.invoices, bills: q.bills, plan });
  return { ...cf, items: plan.items, categories: CATEGORIES, seededFrom: plan.seededFrom || "", readAt: q.readAt, log: plan.log.slice(0, 20) };
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (!sees(u, "money")) return json({ error: "role", message: "The cash flow is part of Money. Ask an admin if you need it." }, 403);

  if (req.method === "GET") {
    try { return json(await cashFlowFor(s, new URL(req.url).searchParams.get("fresh") === "1")); }
    catch (e) { const nc = e.code === "NOT_CONNECTED"; return json({ error: nc ? "not_connected" : "upstream", message: e.message }, nc ? 409 : 502); }
  }
  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  if (!canEdit(u)) return json({ error: "role", message: "Your account can look at the cash flow but not change it." }, 403);

  const b = await req.json().catch(() => ({}));
  const today = localDay();
  try {
    const result = await withLock(s, "cashflow-plan", async () => {
      const plan = await readPlan(s);
      const log = text => plan.log.unshift({ at: new Date().toISOString(), by: u.name, text });
      switch (b.action) {
        case "add": {
          const ck = cleanItem(b.item || {}, today); if (!ck.ok) return { status: 400, body: { error: "bad_value", message: ck.message } };
          const id = "i" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
          /* A repeating payment added today does not drag weeks of missed ones into this week. */
          const since = ck.value.every === "once" ? "" : weekZero(today);
          plan.items.push({ id, ...ck.value, since, createdBy: u.name, createdAt: new Date().toISOString() });
          log("Added " + ck.value.name + " $" + ck.value.amount + " (" + ck.value.every + " from " + ck.value.start + ")");
          break;
        }
        case "update": {
          const it = plan.items.find(x => x.id === b.id); if (!it) return { status: 404, body: { error: "missing", message: "That payment is not in the plan any more." } };
          const ck = cleanItem({ ...it, ...(b.item || {}) }, today); if (!ck.ok) return { status: 400, body: { error: "bad_value", message: ck.message } };
          Object.assign(it, ck.value, { estimate: false, updatedBy: u.name, updatedAt: new Date().toISOString() });
          log("Changed " + it.name + " to $" + it.amount + " (" + it.every + " from " + it.start + ")");
          break;
        }
        case "remove": {
          const i = plan.items.findIndex(x => x.id === b.id); if (i < 0) return { status: 404, body: { error: "missing", message: "That payment is not in the plan any more." } };
          log("Removed " + plan.items[i].name); plan.items.splice(i, 1);
          break;
        }
        case "done": case "undo": {
          const key = String(b.key || ""); if (!/^(item|inv|bill):/.test(key)) return { status: 400, body: { error: "bad", message: "Nothing to tick." } };
          if (b.action === "done") { plan.done[key] = { at: new Date().toISOString(), by: u.name }; log("Ticked " + (b.label || key)); }
          else { delete plan.done[key]; log("Unticked " + (b.label || key)); }
          break;
        }
        case "place": {
          const key = String(b.key || ""); if (!/^(inv|bill):/.test(key)) return { status: 400, body: { error: "bad", message: "Only an invoice or a bill can be moved to a week." } };
          const w = b.week;
          if (w === null || w === "" || w === undefined) delete plan.place[key];
          else if (w === "later") plan.place[key] = "later";
          else if (/^\d{4}-\d{2}-\d{2}$/.test(w)) plan.place[key] = mondayOf(w);
          else return { status: 400, body: { error: "bad", message: "Pick a week." } };
          log("Moved " + (b.label || key) + " to " + (w ? (w === "later" ? "later" : "week of " + mondayOf(w)) : "its due date"));
          break;
        }
        case "settings": {
          const n = (v, lo, hi) => { const x = Number(String(v).replace(/[$,\s]/g, "")); return isFinite(x) && x >= lo && x <= hi ? x : null; };
          const limit = n(b.limit ?? plan.settings.limit, 0, 20000000), floor = n(b.floor ?? plan.settings.floor, 0, 5000000), grace = n(b.graceDays ?? plan.settings.graceDays, 0, 60), growth = n(b.reserveGrowth ?? plan.settings.reserveGrowth ?? 0, 0, 500000);
          if (limit === null || floor === null || grace === null || growth === null) return { status: 400, body: { error: "bad_value", message: "Check the numbers." } };
          plan.settings = { limit, floor, graceDays: grace, reserveGrowth: growth };
          log("Settings: line $" + limit + ", keep $" + floor + " in reserve" + (growth ? ", growing $" + growth + " a week" : "") + ", roll bills and invoices due in the last " + grace + " days");
          break;
        }
        default: return { status: 400, body: { error: "bad", message: "Unknown change." } };
      }
      plan.log = plan.log.slice(0, 200);
      await s.setJSON(PLAN, plan);
      return null;
    });
    if (result) return json(result.body, result.status);
    return json(await cashFlowFor(s, false));
  } catch (e) { return json({ error: "upstream", message: e.message }, 502); }
};

export const config = { path: "/api/cashflow" };
