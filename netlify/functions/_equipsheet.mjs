/* A&M - the equipment Google Sheet as the master list of machines (Craig,
   2026-11-20: "as soon as a new entry is made in the sheet the application is
   updated as a new item... checking to ensure each new item is added in
   sequence... an auto ongoing check").

   The sheet: "AM_equipment_list_-_2026-09-22" in Craig's Drive, one tab, a
   header row, then one machine per row: tag (column A, no header), Machine,
   Group, Unit number, Serial, In-shop?, Make and model, Status, Notes, ...

   What the check does, every 15 minutes in working hours and on "Check now":
   - A row whose tag is not in the app yet is a new machine. It is added if it
     passes every check; otherwise it is held, with the reason, until the
     sheet is fixed or an admin presses Add anyway.
   - The checks: a tag in the house form; a name and a group; the tag agrees
     with the unit number (AMV-9118 is unit #9118); the serial is not already
     on another machine; and the number follows on from the last one with the
     same letters (AMV-8040 after AMV-8039, not AMV-8041). A tag or serial
     already in use is never added, Add anyway or not.
   - Changes to rows already in the app (serial, model, name, group, unit
     number, status) are listed for a person to confirm. Never applied here.
   - Machines in the app but not on the sheet are listed, so nothing drifts.
   - A tag taken off the list in the app (deleted) is never put back.
   Machines are added to the shop's catalog with the same "only if nobody
   saved since" rule the phones use, so a phone's save is never overwritten. */

export const CATALOG = "catalog";
export const KEY = "equipment-sheet";
const TAG = /^[A-Za-z0-9]+(-[A-Za-z0-9]+)*$/;
const norm = v => String(v == null ? "" : v).replace(/\s+/g, " ").trim();
const low = v => norm(v).toLowerCase();
const alnum = v => String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const noSerial = v => !norm(v) || /^(n\/?a|none|-+|unknown|tbd)$/i.test(norm(v));
/* A long serial that Excel or Sheets turned into a short number, like
   2.41E+14 or 3.5202E+12. The real digits are gone, so it is never copied onto
   a machine: the sheet's own copy (AM_equipment_list, 2026-11-25) had these on
   puck vacuums and dehumidifiers, and "Use the sheet's values" would have
   written them over the good serials. */
export const mangledSerial = v => /^\d(\.\d+)?e\+\d+$/i.test(norm(v));   /* 3.5202E+12, never a real serial like 7017E00025 */

/* The sheet's link or id, to its id. */
export function sheetIdFrom(text) {
  const t = String(text || "").trim();
  const m = t.match(/\/spreadsheets\/d\/([A-Za-z0-9_-]{20,80})/) || t.match(/^([A-Za-z0-9_-]{20,80})$/);
  return m ? m[1] : "";
}

/* CSV as Google exports it: quoted fields, commas and line breaks inside quotes. */
export function parseCsv(text) {
  const rows = []; let row = [], f = "", q = false;
  const s = String(text || "").replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { f += '"'; i++; } else q = false; } else f += c; continue; }
    if (c === '"') q = true;
    else if (c === ",") { row.push(f); f = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(f); rows.push(row); row = []; f = ""; }
    else f += c;
  }
  if (f !== "" || row.length) { row.push(f); rows.push(row); }
  return rows;
}

/* Which column is which, read from the header row, so a column moved or added
   on the sheet does not scramble the machines. */
export function columns(header) {
  const h = (header || []).map(low);
  const find = (...names) => h.findIndex(x => names.some(n => x === n || x.startsWith(n)));
  const tagNamed = find("tag", "code", "id");
  return {
    tag: tagNamed >= 0 ? tagNamed : 0,
    name: find("machine", "name", "item"), group: find("group", "category"), unitNo: find("unit number", "unit no", "unit #", "unit"),
    serial: find("serial"), model: find("make and model", "make", "model"), status: find("status"), notes: find("notes"), inShop: find("in-shop", "in shop")
  };
}
export function readRows(csvText) {
  const all = parseCsv(csvText);
  if (!all.length) return { rows: [], problem: "The sheet is empty." };
  const c = columns(all[0]);
  if (c.name < 0 || c.group < 0) return { rows: [], problem: "The sheet's first row needs a Machine column and a Group column." };
  const get = (r, i) => (i >= 0 ? norm(r[i]) : "");
  const rows = all.slice(1).map((r, i) => ({ line: i + 2, tag: get(r, c.tag), name: get(r, c.name), group: get(r, c.group), unitNo: get(r, c.unitNo), serial: get(r, c.serial), model: get(r, c.model), status: get(r, c.status), notes: get(r, c.notes) }))
    .filter(r => r.tag || r.name || r.group || r.serial);
  return { rows };
}

const statusOf = s => !norm(s) || /^in service$|^active$/i.test(norm(s)) ? "Active" : norm(s);
const prefixNum = tag => { const m = /^([A-Za-z]+)-(\d+)$/.exec(String(tag)); return m ? { p: m[1].toUpperCase(), n: parseInt(m[2], 10) } : null; };

/* What a check would do. Pure: the sheet's rows, the app's catalog, the tags an
   admin has said to add anyway. */
export function plan(rows, catalog, approved = []) {
  const units = (catalog && catalog.units) || [];
  const deleted = new Set(Object.keys(((catalog && catalog.deleted) || {}).units || {}).map(x => x.toUpperCase()));
  const byTag = new Map(units.map(u => [String(u.id).toUpperCase(), u]));
  const serials = new Map(units.filter(u => !noSerial(u.serial)).map(u => [alnum(u.serial), u.id]));
  /* A machine the app has with no serial will take the sheet's serial at
     this check, so that serial counts as taken for any new row too. */
  for (const r of rows) { const u = byTag.get(String(r.tag || "").toUpperCase()); if (u && noSerial(u.serial) && !noSerial(r.serial) && !mangledSerial(r.serial) && !serials.has(alnum(r.serial))) serials.set(alnum(r.serial), u.id); }
  const ok = new Set((approved || []).map(x => String(x).toUpperCase()));
  const max = {};
  for (const id of [...byTag.keys(), ...deleted]) { const pn = prefixNum(id); if (pn) max[pn.p] = Math.max(max[pn.p] || 0, pn.n); }
  const seen = new Set();
  const out = { add: [], held: [], changed: [], appOnly: [], deletedOnSheet: [], badSerial: [] };

  for (const r of rows) {
    const T = r.tag.toUpperCase();
    /* The same tag on two rows: the first one counts, the second is held. */
    if (r.tag && seen.has(T)) { out.held.push({ tag: r.tag, line: r.line, name: r.name, group: r.group, why: [`${r.tag} is on the sheet twice`], canApprove: false }); continue; }
    if (byTag.has(T)) {
      const u = byTag.get(T), diffs = [];
      const cmp = (label, sheet, app) => { if (low(sheet) !== low(app) && !(noSerial(sheet) && noSerial(app))) diffs.push({ field: label, sheet: norm(sheet), app: norm(app) }); };
      cmp("Name", r.name, u.name); cmp("Group", r.group, u.group); cmp("Unit number", r.unitNo, u.unitNo);
      if (mangledSerial(r.serial)) { if (low(r.serial) !== low(u.serial)) out.badSerial.push({ tag: u.id, line: r.line, sheet: norm(r.serial), app: norm(u.serial) }); }
      else cmp("Serial", r.serial, u.serial);
      cmp("Make and model", r.model, u.model);
      if (statusOf(r.status) !== statusOf(u.status)) diffs.push({ field: "Status", sheet: r.status || "In service", app: u.status || "Active" });
      if (diffs.length) out.changed.push({ tag: u.id, line: r.line, diffs });
      seen.add(T); continue;
    }
    if (deleted.has(T)) { out.deletedOnSheet.push({ tag: r.tag, line: r.line }); seen.add(T); continue; }

    const why = [], never = [];
    if (!r.tag) never.push("it has no tag in column A");
    else if (!TAG.test(r.tag)) never.push(`"${r.tag}" is not a tag (letters and numbers with a hyphen, like AMV-8040)`);
    if (!r.name) why.push("it has no Machine name");
    if (!r.group) why.push("it has no Group");
    if (r.tag && r.unitNo && TAG.test(r.tag)) {
      const suffix = alnum(r.tag.split("-").slice(1).join("-")), no = alnum(r.unitNo);
      if (no && suffix && suffix !== no && !suffix.endsWith(no)) why.push(`the tag ${r.tag} and unit number ${r.unitNo} do not agree`);
    }
    if (mangledSerial(r.serial)) never.push(`serial ${r.serial} is in the spreadsheet's short number form, so the real digits are lost. Type the serial again as text, starting with an apostrophe`);
    else if (!noSerial(r.serial) && serials.has(alnum(r.serial))) never.push(`serial ${r.serial} is already on ${serials.get(alnum(r.serial))}`);
    const pn = prefixNum(r.tag);
    if (pn && max[pn.p] && pn.n > max[pn.p] + 1) why.push(`${r.tag} skips ${pn.p}-${max[pn.p] + 1}${pn.n > max[pn.p] + 2 ? " to " + pn.p + "-" + (pn.n - 1) : ""}: the last ${pn.p} is ${pn.p}-${max[pn.p]}`);
    if (r.tag) seen.add(T);

    if (never.length || (why.length && !ok.has(T))) {
      out.held.push({ tag: r.tag, line: r.line, name: r.name, group: r.group, why: never.concat(why), canApprove: !never.length });
      continue;
    }
    const unit = { id: r.tag, kind: "unit", group: r.group, name: r.name, unitNo: r.unitNo, serial: noSerial(r.serial) ? "" : r.serial, model: r.model,
      status: statusOf(r.status), dop: /negative air|vacuum|scrubber|hepa/i.test(r.group + " " + r.name), home: "SHOP", source: "Equipment sheet, row " + r.line };
    out.add.push(unit);
    if (pn) max[pn.p] = Math.max(max[pn.p] || 0, pn.n);
    if (!noSerial(r.serial)) serials.set(alnum(r.serial), r.tag);
    byTag.set(T, unit);
  }
  for (const u of units) if (!seen.has(String(u.id).toUpperCase()) && !out.add.some(a => a.id === u.id)) out.appOnly.push({ tag: u.id, name: u.name, group: u.group });
  return out;
}

/* ------------------------------------------------------------- running it */
export async function readSheetCsv(token, fileId) {
  const r = await fetch("https://www.googleapis.com/drive/v3/files/" + encodeURIComponent(fileId) + "/export?mimeType=text%2Fcsv", { headers: { authorization: "Bearer " + token } });
  if (!r.ok) { const b = await r.json().catch(() => ({})); const e = new Error("Google said: " + ((b.error && b.error.message) || "HTTP " + r.status)); e.status = r.status; throw e; }
  return r.text();
}

/* Add the machines to the catalog, only if nobody saved it since it was read.
   Tried a few times, so a phone saving at the same moment wins and the check
   simply goes again on top of it. */
export async function addToCatalog(s, units, by, now = new Date().toISOString()) {
  if (!units.length) return { added: [], rev: null };
  for (let tries = 0; tries < 4; tries++) {
    const got = await s.getWithMetadata(CATALOG, { type: "json" });
    if (!got || !got.data) throw new Error("The shop's list is not on the server yet.");
    const cat = got.data;
    const have = new Set((cat.units || []).map(u => String(u.id).toUpperCase()));
    const fresh = units.filter(u => !have.has(String(u.id).toUpperCase())).map(u => ({ ...u, addedBy: by, addedAt: now }));
    if (!fresh.length) return { added: [], rev: cat.meta && cat.meta.rev };
    const rev = ((cat.meta && cat.meta.rev) || 0) + 1;
    const doc = { ...cat, units: (cat.units || []).concat(fresh), meta: { ...(cat.meta || {}), rev, savedAt: now } };
    const w = await s.setJSON(CATALOG, doc, { onlyIfMatch: got.etag });
    if (w && w.modified) return { added: fresh.map(u => u.id), rev };
  }
  throw new Error("The shop's list kept changing while the check was adding machines. It tries again at the next check.");
}

/* "Use the sheet's values": what a person confirmed, written onto the machines.
   Only the listed fields, never the tag; the status "In service" is the app's
   "Active". */
const FIELD = { "Name": "name", "Group": "group", "Unit number": "unitNo", "Serial": "serial", "Make and model": "model", "Status": "status" };
export async function applyChanges(s, changed, tags, by, now = new Date().toISOString()) {
  const want = tags && tags.length ? new Set(tags.map(t => String(t).toUpperCase())) : null;
  const list = (changed || []).filter(c => !want || want.has(String(c.tag).toUpperCase()));
  if (!list.length) return { updated: [] };
  for (let tries = 0; tries < 4; tries++) {
    const got = await s.getWithMetadata(CATALOG, { type: "json" });
    if (!got || !got.data) throw new Error("The shop's list is not on the server yet.");
    const cat = got.data, updated = [];
    const units = (cat.units || []).map(u => {
      const c = list.find(x => String(x.tag).toUpperCase() === String(u.id).toUpperCase());
      if (!c) return u;
      const next = { ...u };
      for (const d of c.diffs) { const k = FIELD[d.field]; if (k) next[k] = k === "status" ? statusOf(d.sheet) : d.sheet; }
      next.dop = u.dop || /negative air|vacuum|scrubber|hepa/i.test(next.group + " " + next.name);
      next.editedBy = by; next.editedAt = now;
      updated.push(u.id);
      return next;
    });
    if (!updated.length) return { updated: [] };
    const w = await s.setJSON(CATALOG, { ...cat, units, meta: { ...(cat.meta || {}), rev: ((cat.meta && cat.meta.rev) || 0) + 1, savedAt: now } }, { onlyIfMatch: got.etag });
    if (w && w.modified) return { updated };
  }
  throw new Error("The shop's list kept changing. Try again in a moment.");
}

const FILLABLE = ["Serial", "Make and model", "Unit number", "Name", "Group"];
export function splitFills(changed, cat) {
  const used = new Map((cat.units || []).filter(u => !noSerial(u.serial)).map(u => [alnum(u.serial), String(u.id).toUpperCase()]));
  const fills = [], rest = [];
  for (const c of changed || []) {
    const f = [], r = [];
    for (const d of c.diffs) {
      const blankApp = d.field === "Serial" ? noSerial(d.app) : !String(d.app || "").trim();
      const hasSheet = d.field === "Serial" ? !noSerial(d.sheet) : !!String(d.sheet || "").trim();
      const clash = d.field === "Serial" && used.has(alnum(d.sheet)) && used.get(alnum(d.sheet)) !== String(c.tag).toUpperCase();
      if (FILLABLE.includes(d.field) && blankApp && hasSheet && !clash) { f.push(d); if (d.field === "Serial") used.set(alnum(d.sheet), String(c.tag).toUpperCase()); }
      else r.push(d);
    }
    if (f.length) fills.push({ ...c, diffs: f });
    if (r.length) rest.push({ ...c, diffs: r });
  }
  return { fills, rest };
}

/* One check. apply false shows what it would do without changing anything. */
export async function runCheck(s, { token, apply, by = "Equipment sheet" }) {
  const cfg = (await s.get(KEY, { type: "json" })) || {};
  if (!cfg.fileId) throw new Error("No equipment sheet is connected.");
  const { rows, problem } = readRows(await readSheetCsv(token, cfg.fileId));
  if (problem) throw new Error(problem);
  const cat = (await s.get(CATALOG, { type: "json" })) || { units: [] };
  const p = plan(rows, cat, cfg.approved || []);
  let added = [];
  if (apply && p.add.length) added = (await addToCatalog(s, p.add, by)).added;
  /* Blanks are filled on their own (Craig, 2026-11-20: "it still says 50
     without serial numbers"). Where the app has nothing (no serial, no make
     and model, no unit number) and the sheet has it, the sheet's value goes
     straight in on every check. Only real disagreements, where both have a
     value and they differ, wait for a person. A serial already on another
     machine is never copied. */
  const { fills, rest } = splitFills(p.changed, cat);
  let filled = [];
  if (apply && fills.length) filled = (await applyChanges(s, fills, null, by)).updated;
  const changed = apply ? rest : p.changed;
  const result = { at: new Date().toISOString(), applied: !!apply, rows: rows.length, added, wouldAdd: apply ? [] : p.add.map(u => u.id),
    filled, wouldFill: apply ? [] : fills.map(f => f.tag), fillCount: fills.length,
    held: p.held, badSerial: p.badSerial, changed: changed.slice(0, 100), changedCount: changed.length, appOnly: p.appOnly.slice(0, 200), appOnlyCount: p.appOnly.length, deletedOnSheet: p.deletedOnSheet };
  Object.defineProperty(result, "changedAll", { value: changed, enumerable: false });
  return result;
}
