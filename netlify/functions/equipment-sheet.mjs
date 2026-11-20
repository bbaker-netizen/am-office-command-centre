/* A&M - connecting the equipment Google Sheet, and running its check by hand
   (Craig, 2026-11-20). The rules are in _equipsheet.mjs; the 15-minute check
   is equipment-sheet-sweep.mjs.

   GET  /api/equipment-sheet                      what is connected, the last check
   POST { action:"connect", url }                 admins: read it with your Google Drive and show what it would add
   POST { action:"start" }                        admins: add what passes, and keep checking every 15 minutes
   POST { action:"check" }                        office or field, can make changes: check now
   POST { action:"approve", tag }                 admins: add a held row anyway (never a repeated tag or serial)
   POST { action:"useSheet", tags? }              admins: write the sheet's values onto machines that differ (all listed, or these)
   POST { action:"stop" } / { action:"disconnect" }   admins

   The sheet is read with the Google Drive connection of the admin who
   connected it (My account, Connect Google Drive: read only). */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit, isAdmin, logAccount } from "./_accounts.mjs";
import { accessToken, tokenInfo } from "./_drive.mjs";
import { withLock } from "./_lock.mjs";
import { KEY, CATALOG, sheetIdFrom, runCheck, applyChanges } from "./_equipsheet.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const bad = (message, s = 400, error = "bad") => json({ error, message }, s);
const sheetLink = id => "https://docs.google.com/spreadsheets/d/" + id + "/edit";

export async function readCfg(s) { return (await s.get(KEY, { type: "json" })) || {}; }
export const changeCfg = (s, fn) => withLock(s, KEY, async () => { const c = await readCfg(s); const out = await fn(c); await s.setJSON(KEY, c); return out; });

/* The shop shows where the master list is, so it says where to add machines. */
async function tellShop(s, link) {
  for (let i = 0; i < 4; i++) {
    const got = await s.getWithMetadata(CATALOG, { type: "json" }); if (!got || !got.data) return;
    const cat = got.data, settings = { ...(cat.settings || {}) };
    if (link) settings.equipmentSheet = { link }; else delete settings.equipmentSheet;
    const w = await s.setJSON(CATALOG, { ...cat, settings, meta: { ...(cat.meta || {}), rev: ((cat.meta && cat.meta.rev) || 0) + 1, savedAt: new Date().toISOString() } }, { onlyIfMatch: got.etag });
    if (w && w.modified) return;
  }
}

/* One check, with whose Drive it reads, saved as the last result. */
export async function checkNow(s, { apply, by }) {
  const cfg = await readCfg(s);
  if (!cfg.fileId) throw Object.assign(new Error("No equipment sheet is connected."), { status: 409 });
  let token;
  try { token = await accessToken(s, cfg.connectedBy); } catch (e) { token = null; }
  if (!token) {
    const msg = `${cfg.connectedByName || "The admin who connected it"} needs to connect Google Drive again under My account, so the sheet can be read.`;
    await changeCfg(s, c => { c.last = { at: new Date().toISOString(), error: msg }; });
    throw Object.assign(new Error(msg), { status: 409 });
  }
  try {
    const r = await runCheck(s, { token, apply, by });
    await changeCfg(s, c => { c.last = r; if (r.added && r.added.length) c.addedLog = r.added.map(t => ({ tag: t, at: r.at })).concat(c.addedLog || []).slice(0, 200); });
    return r;
  } catch (e) {
    await changeCfg(s, c => { c.last = { at: new Date().toISOString(), error: e.message }; });
    throw e;
  }
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (!sees(u, "office", "field")) return bad("The equipment list is for the office and field.", 403, "role");
  if (req.method === "GET") {
    const c = await readCfg(s);
    return json({ connected: !!c.fileId, link: c.fileId ? sheetLink(c.fileId) : "", auto: !!c.auto, connectedByName: c.connectedByName || "", connectedAt: c.at || "", last: c.last || null, approved: c.approved || [], addedLog: (c.addedLog || []).slice(0, 30),
      myDrive: !!(await tokenInfo(s, u.id)), admin: !!u.admin });
  }
  if (req.method !== "POST") return bad("Use GET or POST.", 405);
  const b = await req.json().catch(() => ({}));
  const A = String(b.action || "");
  const adminOnly = ["connect", "start", "approve", "useSheet", "stop", "disconnect"];
  if (adminOnly.includes(A) && !isAdmin(u)) return bad("Only an admin can do that.", 403, "role");
  try {
    if (A === "connect") {
      const fileId = sheetIdFrom(b.url);
      if (!fileId) return bad("Paste the sheet's link from Google Sheets (it has /spreadsheets/d/ in it).");
      if (!(await tokenInfo(s, u.id))) return bad("Connect Google Drive under My account first. The app reads the sheet with it, read only.", 409, "drive");
      await changeCfg(s, c => { Object.assign(c, { fileId, connectedBy: u.id, connectedByName: u.name, at: new Date().toISOString(), auto: false, approved: [] }); delete c.last; });
      const r = await checkNow(s, { apply: false, by: u.name });
      await logAccount(s, { by: u.name, action: "equipmentSheet", who: "", detail: "Connected the equipment sheet " + fileId });
      return json({ ok: true, result: r });
    }
    if (A === "start") {
      const cfg = await readCfg(s);
      await changeCfg(s, c => { c.auto = true; });
      await tellShop(s, cfg.fileId ? sheetLink(cfg.fileId) : "");
      return json({ ok: true, result: await checkNow(s, { apply: true, by: "Equipment sheet (" + u.name + ")" }) });
    }
    if (A === "check") {
      if (!canEdit(u)) return bad("Your account can look but not change things.", 403, "role");
      const cfg = await readCfg(s);
      return json({ ok: true, result: await checkNow(s, { apply: !!cfg.auto, by: "Equipment sheet (" + u.name + ")" }) });
    }
    if (A === "approve") {
      const tag = String(b.tag || "").trim();
      const cfg = await readCfg(s);
      const held = ((cfg.last && cfg.last.held) || []).find(h => h.tag.toUpperCase() === tag.toUpperCase());
      if (!held) return bad("That row is not waiting any more. Check again.", 404);
      if (!held.canApprove) return bad("That row cannot be added: " + held.why.join("; ") + ". Fix it on the sheet.", 409);
      await changeCfg(s, c => { c.approved = [...new Set([...(c.approved || []), tag.toUpperCase()])]; });
      await logAccount(s, { by: u.name, action: "equipmentSheet", who: "", detail: "Added " + tag + " anyway: " + held.why.join("; ") });
      return json({ ok: true, result: await checkNow(s, { apply: true, by: "Equipment sheet (" + u.name + ")" }) });
    }
    if (A === "useSheet") {
      /* Fresh from the sheet first, so what is written is what the sheet says now. */
      const r0 = await checkNow(s, { apply: false, by: u.name });
      const tags = Array.isArray(b.tags) ? b.tags.map(String).slice(0, 1000) : null;
      const out = await applyChanges(s, r0.changedAll || r0.changed, tags, "Equipment sheet (" + u.name + ")");
      await logAccount(s, { by: u.name, action: "equipmentSheet", who: "", detail: "Used the sheet's values on " + out.updated.length + " machine" + (out.updated.length === 1 ? "" : "s") });
      const r = await checkNow(s, { apply: (await readCfg(s)).auto, by: "Equipment sheet (" + u.name + ")" });
      return json({ ok: true, updated: out.updated, result: r });
    }
    if (A === "stop") { await changeCfg(s, c => { c.auto = false; }); return json({ ok: true }); }
    if (A === "disconnect") {
      await changeCfg(s, c => { for (const k of Object.keys(c)) delete c[k]; });
      await tellShop(s, "");
      return json({ ok: true });
    }
  } catch (e) { return bad(e.message, e.status || 502, "sheet"); }
  return bad("Unknown action.");
};

export const config = { path: "/api/equipment-sheet" };
