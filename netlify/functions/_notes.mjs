/* A&M - sticky notes board: the rules, kept apart from the web handler so
   they can be tested on their own.

   Each person has one board of their own ("notes-<account id>"). A note is
   a few words in handwriting on a coloured square that can be dragged
   anywhere on the board. Where it sits is kept as:
     x  0 to 1, how far across the board (so it fits a phone and a computer)
     y  pixels down from the top of the board
   z is the stacking order: the note moved or added last sits on top.
   Nothing here is sent anywhere. */

export const COLOURS = ["yellow", "cyan", "pink", "green", "orange", "white"];
export const MAX_NOTES = 150;
export const MAX_TEXT = 400;
const MAX_Y = 6000;

export function emptyBoard() { return { notes: [], z: 0 }; }

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const num = v => (v === null || v === undefined || v === "" || isNaN(Number(v))) ? null : Number(v);

export function cleanText(t) {
  const s = String(t === undefined || t === null ? "" : t).replace(/\r/g, "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  if (!s) return { ok: false, message: "Write something on the note first." };
  if (s.length > MAX_TEXT) return { ok: false, message: "That is a lot for a sticky note. Keep it under " + MAX_TEXT + " letters, or put it on your list." };
  return { ok: true, value: s };
}
export function cleanColour(c) { return COLOURS.includes(c) ? c : "yellow"; }

/* A new note with no spot of its own goes to the next free place in a loose
   grid, starting top left, so a fresh board fills like a real desk. */
export function freeSpot(board, cols = 4) {
  const taken = board.notes.map(n => ({ x: n.x, y: n.y }));
  for (let i = 0; i < 400; i++) {
    const c = i % cols, r = Math.floor(i / cols);
    const x = cols === 1 ? 0 : c / (cols - 1), y = 24 + r * 230;
    if (!taken.some(t => Math.abs(t.x - x) < 0.12 && Math.abs(t.y - y) < 120)) return { x, y };
  }
  return { x: Math.random(), y: 24 };
}

function newId() { return "n" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }
const tilt = () => Math.round((Math.random() * 6 - 3) * 10) / 10;

/* Apply one change. Returns { board, result } or { error, status }. */
export function applyNote(board, b, nowIso) {
  board = board && Array.isArray(board.notes) ? board : emptyBoard();
  board.z = Number(board.z) || board.notes.reduce((m, n) => Math.max(m, n.z || 0), 0);
  const find = id => board.notes.find(n => n.id === String(id || ""));
  switch (b.action) {
    case "add": {
      if (board.notes.length >= MAX_NOTES) return { status: 400, error: "full", message: "The board is full (" + MAX_NOTES + " notes). Throw a few away first." };
      const t = cleanText(b.text); if (!t.ok) return { status: 400, error: "bad", message: t.message };
      const x = num(b.x), y = num(b.y);
      const spot = x === null || y === null ? freeSpot(board, clamp(Number(b.cols) || 4, 1, 8)) : { x: clamp(x, 0, 1), y: clamp(y, 0, MAX_Y) };
      const note = { id: newId(), text: t.value, colour: cleanColour(b.colour), x: spot.x, y: spot.y, rot: tilt(), z: ++board.z, at: nowIso, upd: nowIso, source: b.source === "voice" ? "voice" : "typed" };
      board.notes.push(note);
      return { board, result: { note } };
    }
    case "update": {
      const n = find(b.id); if (!n) return { status: 404, error: "gone", message: "That note is not on the board any more." };
      if (b.text !== undefined) { const t = cleanText(b.text); if (!t.ok) return { status: 400, error: "bad", message: t.message }; n.text = t.value; }
      if (b.colour !== undefined) n.colour = cleanColour(b.colour);
      if (num(b.x) !== null) n.x = clamp(num(b.x), 0, 1);
      if (num(b.y) !== null) n.y = clamp(num(b.y), 0, MAX_Y);
      if (b.top !== false) n.z = ++board.z;
      n.upd = nowIso;
      return { board, result: { note: n } };
    }
    case "remove": {
      const n = find(b.id); if (!n) return { board, result: { note: null } };
      board.notes = board.notes.filter(x => x.id !== n.id);
      return { board, result: { note: n } };
    }
    case "restore": {
      const n = b.note || {}; const t = cleanText(n.text); if (!t.ok) return { status: 400, error: "bad", message: t.message };
      if (find(n.id)) return { board, result: { note: find(n.id) } };
      if (board.notes.length >= MAX_NOTES) return { status: 400, error: "full", message: "The board is full." };
      const back = { id: String(n.id || newId()).slice(0, 40), text: t.value, colour: cleanColour(n.colour), x: clamp(num(n.x) ?? 0, 0, 1), y: clamp(num(n.y) ?? 24, 0, MAX_Y), rot: clamp(num(n.rot) ?? 0, -4, 4), z: ++board.z, at: n.at || nowIso, upd: nowIso, source: n.source === "voice" ? "voice" : "typed" };
      board.notes.push(back);
      return { board, result: { note: back } };
    }
    case "arrange": {
      for (const p of Array.isArray(b.spots) ? b.spots.slice(0, MAX_NOTES) : []) {
        const n = find(p.id); if (!n) continue;
        if (num(p.x) !== null) n.x = clamp(num(p.x), 0, 1);
        if (num(p.y) !== null) n.y = clamp(num(p.y), 0, MAX_Y);
      }
      return { board, result: { ok: true } };
    }
    default: return { status: 400, error: "bad", message: "Unknown change." };
  }
}
