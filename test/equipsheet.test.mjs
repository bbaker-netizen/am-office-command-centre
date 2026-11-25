/* The equipment Google Sheet as the master list (Craig, 2026-11-20).
   The rules on the real sheet (exported 2026-11-20), the sequence checks, and
   connect, start, add, hold, add anyway and use-the-sheet through the real
   endpoint, with stand-in Google calls.
   Run: node --import ./test/support/use-fake-blobs.mjs test/equipsheet.test.mjs */
import { strict as assert } from "node:assert";
import { readFileSync } from "node:fs";

process.env.AUTH_SECRET = "a-test-secret-that-is-long-enough-0123456789";
process.env.GOOGLE_CLIENT_ID = "cid"; process.env.GOOGLE_CLIENT_SECRET = "csec";
process.env.PW_ITER = "1000";
const { parseCsv, readRows, columns, plan, sheetIdFrom, addToCatalog } = await import("../netlify/functions/_equipsheet.mjs");
let n = 0; const ok = m => { n++; console.log("ok", m); };

/* ---------- reading ---------- */
assert.deepEqual(parseCsv('a,"b, c","say ""hi"""\r\n1,"two\nlines",3'), [["a", "b, c", 'say "hi"'], ["1", "two\nlines", "3"]]);
const header = ["", "Machine", "Group", "Unit number", "Serial", "In-shop?", "Make and model", "Status", "Notes", "", "Purchase date"];
assert.deepEqual(Object.values(columns(header)).slice(0, 7), [0, 1, 2, 3, 4, 6, 7]);
assert.equal(sheetIdFrom("https://docs.google.com/spreadsheets/d/1j-yXi2ppTvHviLPJU9AHGbVW1kobJQa6AgIavsuK-tM/edit?usp=sharing"), "1j-yXi2ppTvHviLPJU9AHGbVW1kobJQa6AgIavsuK-tM");
assert.equal(sheetIdFrom("not a link"), "");
assert.match(readRows("Tag,Thing\nA-1,x").problem, /Machine column and a Group column/);
ok("reads Google's CSV, finds the columns by their headings, and takes the sheet's link");

const fixture = readFileSync(new URL("./support/equipment-sheet-2026-11-20.csv", import.meta.url), "utf8");
const seed = JSON.parse(readFileSync(new URL("../public/seed.json", import.meta.url), "utf8"));
const { rows } = readRows(fixture);
assert.equal(rows.length, 558);
let p = plan(rows, seed);
assert.deepEqual(p.add.map(u => u.id), ["AMV-9118", "AMV-9119", "AMV-9120", "AMV-9121", "AMV-9122", "AMV-9123", "DEH-871", "DEH-872", "DEH-873", "DEH-874"]);
assert.equal(p.held.length, 0); assert.equal(p.appOnly.length, 0);
assert.equal(p.add[0].group, "Air Movers"); assert.equal(p.add[0].status, "Active"); assert.equal(p.add[0].home, "SHOP");
assert.ok(p.changed.length > 100);
ok("the real sheet against the app's starting list: 10 new machines, all in sequence, none held; the differences are listed, not applied");

/* ---------- the checks ---------- */
const cat = { units: [
  { id: "AMV-9123", group: "Air Movers", name: "Air Mover", unitNo: "#9123", serial: "S-1" },
  { id: "TVAC-1T", group: "Vacuums", name: "Tiger Vacuum", unitNo: "#1T", serial: "" }
], deleted: { units: { "AMV-9124": "2026-11-01" } } };
const R = (line, tag, extra = {}) => ({ line, tag, name: "Air Mover", group: "Air Movers", unitNo: "#" + tag.split("-")[1], serial: "", model: "", status: "In service", notes: "", ...extra });
p = plan([R(2, "AMV-9124"), R(3, "AMV-9125"), R(4, "AMV-9127")], cat);
assert.deepEqual(p.add.map(u => u.id), ["AMV-9125"]);
assert.deepEqual(p.deletedOnSheet.map(x => x.tag), ["AMV-9124"]);
assert.equal(p.held[0].tag, "AMV-9127"); assert.match(p.held[0].why[0], /AMV-9127 skips AMV-9126: the last AMV is AMV-9125/); assert.equal(p.held[0].canApprove, true);
ok("in sequence: AMV-9125 follows 9123 (9124 was taken off on purpose and is never put back); AMV-9127 skips 9126 and waits");

p = plan([R(5, "AMV-9124b".toUpperCase()), R(6, "AMV-9125", { serial: "s-1" }), R(7, "AMV-9126", { unitNo: "#9161" }), R(8, "", {}), R(9, "AMV 9127"), R(10, "TVAC-2T", { name: "" })], cat);
const why = Object.fromEntries(p.held.map(h => [h.line, h]));
assert.match(why[6].why.join(), /serial s-1 is already on AMV-9123/); assert.equal(why[6].canApprove, false);
assert.match(why[7].why.join(), /AMV-9126 and unit number #9161 do not agree/);
assert.match(why[8].why.join(), /no tag/); assert.equal(why[8].canApprove, false);
assert.match(why[9].why.join(), /is not a tag/);
assert.match(why[10].why.join(), /no Machine name/);
ok("a repeated serial, a tag that disagrees with its unit number, no tag, a broken tag, or no name: held with the reason");

p = plan([R(2, "AMV-9125"), R(3, "AMV-9125")], cat);
assert.equal(p.add.length, 1); assert.match(p.held[0].why[0], /on the sheet twice/);
p = plan([R(4, "AMV-9127")], cat, ["amv-9127"]);
assert.deepEqual(p.add.map(u => u.id), ["AMV-9127"]);
p = plan([R(6, "AMV-9125", { serial: "S-1" })], cat, ["AMV-9125"]);
assert.equal(p.add.length, 0);
ok("a tag twice on the sheet is held; Add anyway lets an out-of-sequence row in, but never a repeated tag or serial");

const { getStore } = await import("@netlify/blobs");
const s = getStore({ name: "am-inventory", consistency: "strong" });
await s.setJSON("catalog", { units: [...cat.units], meta: { rev: 7 }, settings: {} });
const realSet = s.setJSON.bind(s); let raced = false;
s.setJSON = async (k, v, o) => { if (k === "catalog" && o && o.onlyIfMatch && !raced) { raced = true; const c = await s.get("catalog", { type: "json" }); await realSet("catalog", { ...c, units: c.units.concat([{ id: "PHONE-1" }]), meta: { rev: 8 } }); } return realSet(k, v, o); };
const added = await addToCatalog(s, [{ id: "AMV-9125", kind: "unit" }], "Equipment sheet");
s.setJSON = realSet;
const after = await s.get("catalog", { type: "json" });
assert.deepEqual(added.added, ["AMV-9125"]); assert.ok(after.units.some(u => u.id === "PHONE-1")); assert.equal(after.meta.rev, 9);
ok("a phone saving at the same moment is kept: the check reads again and adds on top");

/* ---------- through the endpoint ---------- */
const { default: sheet } = await import("../netlify/functions/equipment-sheet.mjs");
const { default: sweep, config: sweepCfg } = await import("../netlify/functions/equipment-sheet-sweep.mjs");
const { hashPassword, ACCOUNTS, accountToken } = await import("../netlify/functions/_accounts.mjs");
const { saveToken } = await import("../netlify/functions/_drive.mjs");
const now = new Date().toISOString(), pw = await hashPassword("a good long password");
const acc = (id, name, level) => ({ id, email: name.split(" ")[0].toLowerCase() + "@amabatement.com", name, areas: ["office", "field"], level, active: true, pw, pwv: now, mustChange: false });
await s.setJSON(ACCOUNTS, { accounts: { c1: acc("c1", "Craig Williams", "admin"), m1: acc("m1", "Maxim Hahn", "edit"), v1: acc("v1", "Viewer Person", "view") }, settings: { idleHours: 8 } });
await s.setJSON("catalog", { units: [...cat.units], deleted: cat.deleted, meta: { rev: 1 }, settings: {} });
let sheetCsv = "Tag,Machine,Group,Unit number,Serial,In-shop?,Make and model,Status\nAMV-9123,Air Mover,Air Movers,#9123,S-1,,,In service\nTVAC-1T,Tiger Vacuum,Vacuums,#1T,,,,In service\nAMV-9125,Air Mover,Air Movers,#9125,S-25,,Actuvate,In service\n";
const realFetch = globalThis.fetch; let reads = 0;
globalThis.fetch = async (url, opt = {}) => {
  const u = String(url);
  if (u.startsWith("https://oauth2.googleapis.com/token")) return new Response(JSON.stringify({ access_token: "drive-tok", expires_in: 3600 }), { status: 200 });
  if (u.includes("/drive/v3/files/") && u.includes("/export")) { reads++; assert.equal(opt.headers.authorization, "Bearer drive-tok"); return new Response(sheetCsv, { status: 200 }); }
  return realFetch(url, opt);
};
const T = async id => accountToken(s, (await s.get(ACCOUNTS, { type: "json" })).accounts[id]);
const post = async (id, body) => { const r = await sheet(new Request("https://x/api/equipment-sheet", { method: "POST", headers: { authorization: "Bearer " + await T(id), "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const get = async id => (await sheet(new Request("https://x/api/equipment-sheet", { headers: { authorization: "Bearer " + await T(id) } }))).json();
const LINK = "https://docs.google.com/spreadsheets/d/1j-yXi2ppTvHviLPJU9AHGbVW1kobJQa6AgIavsuK-tM/edit?usp=sharing";

let r = await post("m1", { action: "connect", url: LINK });
assert.equal(r.status, 403);
r = await post("c1", { action: "connect", url: LINK });
assert.equal(r.status, 409); assert.match(r.body.message, /Connect Google Drive under My account first/);
await saveToken(s, "c1", "refresh-craig", "craig@amabatement.com");
r = await post("c1", { action: "connect", url: LINK });
assert.equal(r.status, 200); assert.deepEqual(r.body.result.wouldAdd, ["AMV-9125"]); assert.equal(r.body.result.applied, false);
assert.equal((await s.get("catalog", { type: "json" })).units.length, 2);
ok("only an admin connects it, with their own Google Drive; the first read shows what it would add and adds nothing");

let g = await get("m1");
assert.equal(g.connected, true); assert.equal(g.auto, false); assert.equal(g.connectedByName, "Craig Williams");
r = await post("c1", { action: "start" });
assert.deepEqual(r.body.result.added, ["AMV-9125"]);
let c = await s.get("catalog", { type: "json" });
assert.ok(c.units.find(u => u.id === "AMV-9125" && u.model === "Actuvate" && u.addedBy === "Equipment sheet (Craig Williams)"));
assert.equal(c.settings.equipmentSheet.link, "https://docs.google.com/spreadsheets/d/1j-yXi2ppTvHviLPJU9AHGbVW1kobJQa6AgIavsuK-tM/edit");
ok("Start adds what passes, keeps checking, and tells the shop where the master list is");

sheetCsv += "AMV-9126,Air Mover,Air Movers,#9126,S-26,,,In service\nAMV-9128,Air Mover,Air Movers,#9128,S-28,,,In service\nAMV-9129,Air Mover,Air Movers,#9129,S-25,,,In service\n";
r = await post("m1", { action: "check" });
assert.deepEqual(r.body.result.added, ["AMV-9126"]);
assert.deepEqual(r.body.result.held.map(h => h.tag), ["AMV-9128", "AMV-9129"]);
assert.equal((await post("v1", { action: "check" })).status, 403);
ok("a new row in sequence is added at the next check; one that skips a number, or repeats a serial, waits");

r = await post("m1", { action: "approve", tag: "AMV-9128" });
assert.equal(r.status, 403);
r = await post("c1", { action: "approve", tag: "AMV-9129" });
assert.equal(r.status, 409); assert.match(r.body.message, /cannot be added: serial S-25 is already on AMV-9125/);
r = await post("c1", { action: "approve", tag: "AMV-9128" });
assert.ok(r.body.result.added.includes("AMV-9128"));
ok("an admin adds the skipped one anyway; a repeated serial can only be fixed on the sheet");

sheetCsv = sheetCsv.replace("AMV-9123,Air Mover,Air Movers,#9123,S-1,,,In service", "AMV-9123,Air Mover,Air Movers,#9123,S-1-NEW,,Actuvate,Out of service");
r = await post("m1", { action: "check" });
assert.equal(r.body.result.changedCount, 1); assert.deepEqual(r.body.result.changed[0].diffs.map(d => d.field), ["Serial", "Status"]);
assert.deepEqual(r.body.result.filled, ["AMV-9123"]);
c = await s.get("catalog", { type: "json" });
assert.equal(c.units.find(u => u.id === "AMV-9123").serial, "S-1");
assert.equal(c.units.find(u => u.id === "AMV-9123").model, "Actuvate");
ok("a blank in the app (make and model) is filled from the sheet at the check, with no press");
r = await post("c1", { action: "useSheet", tags: ["AMV-9123"] });
assert.deepEqual(r.body.updated, ["AMV-9123"]);
c = await s.get("catalog", { type: "json" });
const u23 = c.units.find(u => u.id === "AMV-9123");
assert.equal(u23.serial, "S-1-NEW"); assert.equal(u23.status, "Out of service"); assert.equal(r.body.result.changedCount, 0);
ok("a changed row is listed, never applied on its own; Use the sheet writes it once an admin presses it");

/* A machine with no serial in the app gets the sheet's serial on its own;
   a serial already on another machine is never copied. */
c = await s.get("catalog", { type: "json" });
c.units.find(u => u.id === "AMV-9125").serial = ""; c.units.find(u => u.id === "TVAC-1T").serial = "";
await s.setJSON("catalog", c);
sheetCsv = sheetCsv.replace("TVAC-1T,Tiger Vacuum,Vacuums,#1T,,", "TVAC-1T,Tiger Vacuum,Vacuums,#1T,S-1-NEW,");
r = await post("m1", { action: "check" });
c = await s.get("catalog", { type: "json" });
assert.equal(c.units.find(u => u.id === "AMV-9125").serial, "S-25");
assert.equal(c.units.find(u => u.id === "TVAC-1T").serial || "", "");
assert.ok(r.body.result.changed.some(x => x.tag === "TVAC-1T" && x.diffs.some(d => d.field === "Serial")));
ok("a missing serial is filled from the sheet on its own; one already on another machine waits for a person");

c.units.push({ id: "HVAC-02", group: "Vacuums", name: "HEPA Vacuum" }); await s.setJSON("catalog", c);
r = await post("m1", { action: "check" });
assert.deepEqual(r.body.result.appOnly.map(x => x.tag), ["HVAC-02"]);
ok("a machine added in the shop but not on the sheet is listed");

assert.equal(sweepCfg.schedule, "*/15 12-23 * * 1-5");
const swept = await (await sweep()).text();
assert.match(swept, /Added 0, held 1\.|Outside working hours\./);
const readsBefore = reads;
await post("c1", { action: "stop" });
const swept2 = await (await sweep()).text();
assert.match(swept2, /No equipment sheet switched on|Outside working hours/); assert.equal(reads, readsBefore);
ok("the 15-minute check runs only in working hours and only while switched on");

await post("c1", { action: "disconnect" });
g = await get("c1"); assert.equal(g.connected, false);
c = await s.get("catalog", { type: "json" });
assert.ok(!c.settings.equipmentSheet); assert.ok(c.units.find(u => u.id === "AMV-9128"));
ok("disconnecting stops it and keeps every machine already added");

/* ---------- serials the spreadsheet shortened (2026-11-25) ---------- */
{
  const cat = { units: [
    { id: "PVAC-13", name: "Puck Vacuum", group: "Vacuums", unitNo: "#13", serial: "3520253201977", status: "Active" },
    { id: "PVAC-17", name: "Puck Vacuum", group: "Vacuums", unitNo: "#17", serial: "", status: "Active" } ] };
  const rows = readRows("Tag,Machine,Group,Unit number,Serial\nPVAC-13,Puck Vacuum,Vacuums,#13,3.5202E+12\nPVAC-17,Puck Vacuum,Vacuums,#17,3.52025E+12\nPVAC-18,Puck Vacuum,Vacuums,#18,3.52E+12\nPVAC-19,Puck Vacuum,Vacuums,#19, 100950429").rows;
  const q = plan(rows, cat);
  assert.deepEqual(q.badSerial.map(x => x.tag), ["PVAC-13", "PVAC-17"]);
  const { mangledSerial } = await import("../netlify/functions/_equipsheet.mjs");
  assert.equal(mangledSerial("7017E00025"), false); assert.equal(mangledSerial("2.41E+14"), true); assert.equal(mangledSerial("3.5202E+12"), true);
  assert.ok(!q.changed.some(c => c.diffs.some(d => d.field === "Serial")));
  assert.deepEqual(q.add.map(u => u.id), []);
  assert.equal(q.held[0].tag, "PVAC-18"); assert.equal(q.held[0].canApprove, false); assert.match(q.held[0].why[0], /short number form/);
  assert.equal(q.held[1].tag, "PVAC-19"); assert.match(q.held[1].why.join(" "), /skips|PVAC-18/);
  ok("a serial the spreadsheet shortened to 3.52E+12 is never copied onto a machine or used to add one, and is listed to retype");
}
{
  /* The same serial on two new rows: the first is added, the second waits. */
  const cat = { units: [{ id: "NEG-64", name: "Negative Air Machine", group: "Negative Air", unitNo: "#64", serial: "A1", status: "Active" }, { id: "PVAC-17", name: "Puck Vacuum", group: "Vacuums", unitNo: "#17", serial: "B1", status: "Active" }] };
  const rows = readRows("Tag,Machine,Group,Unit number,Serial\nNEG-65,Negative Air Machine,Negative Air,#65,204871\nPVAC-18,Puck Vacuum,Vacuums,#18,204871").rows;
  const q = plan(rows, cat);
  assert.deepEqual(q.add.map(u => u.id), ["NEG-65"]);
  assert.equal(q.held[0].tag, "PVAC-18"); assert.match(q.held[0].why[0], /already on NEG-65/); assert.equal(q.held[0].canApprove, false);
  ok("NEG-65 and PVAC-18 with one serial between them: the first is added, the second waits to be fixed on the sheet");
}

globalThis.fetch = realFetch;
console.log(`\n${n} equipment sheet checks passed`);
