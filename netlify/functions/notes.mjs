/* A&M - sticky notes board (My day, Sticky notes).
   GET  /api/notes                     this person's board
   POST /api/notes { action, ... }     add, update, remove, restore, arrange (see _notes.mjs)
   Who: everyone with an account, each on their own board. Viewing as someone
   shows their board, look only (accountGate refuses changes while viewing as).
   Notes never leave the board unless the person presses "Put on my list",
   which goes through the assistant (/api/assistant), not through here. */
import { getStore } from "@netlify/blobs";
import { accountGate } from "./_accounts.mjs";
import { update } from "./_lock.mjs";
import { applyNote, emptyBoard, COLOURS, MAX_NOTES } from "./_notes.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const keyFor = id => "notes-" + String(id).replace(/[^A-Za-z0-9_-]/g, "");

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser, key = keyFor(u.id);

  if (req.method === "GET") {
    const board = (await s.get(key, { type: "json" })) || emptyBoard();
    return json({ notes: board.notes || [], colours: COLOURS, max: MAX_NOTES, viewAs: !!u.viewAs });
  }
  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  const b = await req.json().catch(() => ({}));
  let out = null;
  try {
    await update(s, key, cur => {
      const r = applyNote(cur ? JSON.parse(JSON.stringify(cur)) : emptyBoard(), b, new Date().toISOString());
      out = r;
      return r.error ? (cur || emptyBoard()) : r.board;
    });
  } catch (e) { return json({ error: "busy", message: e.message || "Could not save that. Try again." }, 503); }
  if (out.error) return json({ error: out.error, message: out.message }, out.status || 400);
  return json({ ok: true, ...out.result });
};

export const config = { path: "/api/notes" };
