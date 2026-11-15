/* Sticky notes board. Run: node --import ./test/support/use-fake-blobs.mjs test/notes.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { applyNote, emptyBoard, freeSpot, cleanText, MAX_TEXT } from "../netlify/functions/_notes.mjs";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/notes.mjs";
let n = 0; const ok = m => { n++; console.log("ok", m); };
const now = "2026-11-15T21:00:00Z";

let b = emptyBoard();
let r = applyNote(b, { action:"add", text:"  Call the bank about the line  ", colour:"cyan" }, now); b = r.board;
assert.equal(r.result.note.text, "Call the bank about the line"); assert.equal(r.result.note.colour, "cyan"); assert.equal(r.result.note.z, 1);
assert.ok(r.result.note.x >= 0 && r.result.note.x <= 1); assert.ok(Math.abs(r.result.note.rot) <= 3);
r = applyNote(b, { action:"add", text:"Second", colour:"purple" }, now); b = r.board;
assert.equal(r.result.note.colour, "yellow"); assert.notDeepEqual([b.notes[0].x, b.notes[0].y], [b.notes[1].x, b.notes[1].y]);
assert.equal(applyNote(b, { action:"add", text:"   " }, now).error, "bad");
assert.equal(cleanText("x".repeat(MAX_TEXT + 1)).ok, false);
ok("adding a note: trimmed, coloured (unknown colours become yellow), placed in a free spot, empty refused, long refused");

const id = b.notes[0].id;
r = applyNote(b, { action:"update", id, x: 1.7, y: -20, colour:"pink" }, now); b = r.board;
assert.equal(r.result.note.x, 1); assert.equal(r.result.note.y, 0); assert.equal(r.result.note.colour, "pink"); assert.equal(r.result.note.z, 3);
r = applyNote(b, { action:"update", id, text:"Call BMO Friday" }, now); assert.equal(r.result.note.text, "Call BMO Friday");
assert.equal(applyNote(b, { action:"update", id:"nope", text:"x" }, now).status, 404);
ok("moving keeps a note on the board and brings it to the top; editing words and colour works");

r = applyNote(b, { action:"remove", id }, now); b = r.board; const gone = r.result.note;
assert.equal(b.notes.length, 1);
r = applyNote(b, { action:"restore", note: gone }, now); b = r.board;
assert.equal(b.notes.length, 2); assert.equal(r.result.note.id, id); assert.equal(r.result.note.text, "Call BMO Friday");
r = applyNote(b, { action:"arrange", spots:[{ id, x:0, y:24 }, { id:b.notes[0].id, x:0.5, y:24 }] }, now);
assert.equal(r.board.notes.find(x => x.id === id).x, 0);
ok("throw away, then undo puts the same note back; tidy up places every note");

const full = { notes: Array.from({ length:150 }, (_, i) => ({ id:"x"+i, text:"a", x:0, y:i })), z:150 };
assert.equal(applyNote(full, { action:"add", text:"one more" }, now).error, "full");
const spot = freeSpot({ notes:[{ x:0, y:24 }] }); assert.ok(!(spot.x === 0 && spot.y === 24));
ok("a full board says so; the free spot skips a taken one");

process.env.MASTER_ADMINS = "";
const s = getStore({ name:"am-inventory", consistency:"strong" });
const mk = (id, level) => ({ id, name:"Person " + id, email:id + "@example.test", areas:["office"], level, pwv:"1" });
await s.setJSON(ACCOUNTS, { accounts:{ a1: mk("a1","admin"), b1: mk("b1","view") }, settings:{ idleHours:8 } });
const tok = a => signToken(s, { k:"acct", a, v:"1", t:Date.now(), m:0 });
const call = async (who, body, extra = {}) => { const r = await handler(new Request("https://site/api/notes", body ? { method:"POST", headers:{ authorization:"Bearer " + await tok(who), "content-type":"application/json", ...extra }, body: JSON.stringify(body) } : { headers:{ authorization:"Bearer " + await tok(who), ...extra } })); return { status:r.status, body: await r.json() }; };
let x = await call("b1", { action:"add", text:"Order filters" });
assert.equal(x.status, 200);
assert.equal((await call("b1")).body.notes.length, 1);
assert.equal((await call("a1")).body.notes.length, 0);
ok("each person has their own board, and a view-only account can still keep notes");
const va = await call("a1", null, { "x-am-view-as":"b1" });
assert.equal(va.status, 200); assert.equal(va.body.notes.length, 1); assert.equal(va.body.viewAs, true);
const vaPost = await call("a1", { action:"add", text:"sneaky" }, { "x-am-view-as":"b1" });
assert.equal(vaPost.status, 403);
assert.equal((await call("b1")).body.notes.length, 1);
ok("viewing as someone shows their board but cannot change it");

console.log(`\n${n} sticky note checks pass`);
