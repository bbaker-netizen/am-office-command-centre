/* A&M - counting wrong guesses, shared by the shop's PIN sign-in and the
   command centre's email and password sign-in.

   Moved out of auth.mjs in v53 so both doors count the same way: per person,
   on the server, where it cannot be skipped, and per network address so one
   machine cannot work through everybody's names in turn. */

import { update } from "./_lock.mjs";

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

export async function pinHash(pin, salt) {
  const data = new TextEncoder().encode(String(salt) + ":" + String(pin));
  return hex(await globalThis.crypto.subtle.digest("SHA-256", data));
}

/* Compared all the way through rather than stopping at the first difference. */
export function same(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/* Five is generous for cold hands on a small keypad, or a password typed with
   caps lock on. After that the wait grows, because somebody who has been wrong
   ten times in a row is not fumbling. */
export function waitFor(n) {
  if (n < 5) return 0;
  if (n < 10) return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

export async function readFails(s, key) {
  return (await s.get(key, { type: "json" })) || { n: 0, until: 0 };
}

/* Counted with a write that fails if somebody else counted in between, so a
   burst of guesses sent all at once cannot all see the same count. */
export async function addFail(s, key) {
  return update(s, key, cur => {
    const n = ((cur && cur.n) || 0) + 1;
    return { n, until: Date.now() + waitFor(n) };
  });
}

export async function clearFails(s, key) {
  await s.setJSON(key, { n: 0, until: 0 });
}

export function lockedFor(f) {
  if (!f || !f.until || Date.now() >= f.until) return 0;
  return Math.max(1, Math.ceil((f.until - Date.now()) / 60000));
}

/* Thirty wrong in an hour from one address, and that address waits an hour.
   The address is scrambled before it is stored. */
export async function ipKey(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  if (!ip) return "";
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("am:" + ip.split(",")[0].trim()));
  return "authfail-ip-" + [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
export async function ipBlocked(s, key) {
  if (!key) return false;
  const v = await s.get(key, { type: "json" });
  return !!(v && v.n >= 30 && Date.now() - v.since < 3600000);
}
export async function ipFail(s, key) {
  if (!key) return;
  try {
    await update(s, key, cur => (!cur || Date.now() - cur.since > 3600000) ? { n: 1, since: Date.now() } : { n: cur.n + 1, since: cur.since });
  } catch (e) {}
}

/* Checks one shop person's four digits against the catalog, with the same
   counting the shop's own sign-in uses. Used by the command centre's first-time
   setup, where an owner proves who they are with the PIN they already have.
   Returns { ok, user } or { ok:false, status, error, message }. */
export async function checkShopPin(s, req, nameOrId, pin) {
  const ik = await ipKey(req);
  if (await ipBlocked(s, ik)) return { ok: false, status: 429, error: "locked", message: "Too many wrong tries from this connection. Wait an hour." };
  const catalog = await s.get("catalog", { type: "json" });
  const users = (catalog && Array.isArray(catalog.users)) ? catalog.users : [];
  const user = users.find(u => u && u.active !== false && (u.id === nameOrId || u.name === nameOrId));
  const nope = { ok: false, status: 401, error: "auth", message: "That name and PIN do not match." };
  if (!user || !user.id) { await ipFail(s, ik); return nope; }
  const fk = "authfail-" + user.id;
  const mins = lockedFor(await readFails(s, fk));
  if (mins) return { ok: false, status: 429, error: "locked", message: `Too many wrong tries. Wait ${mins} minute${mins === 1 ? "" : "s"}.` };
  if (!/^\d{4}$/.test(String(pin || "")) || !(user.pin && user.pin.hash && user.pin.salt)) { await addFail(s, fk); await ipFail(s, ik); return nope; }
  if (!same(await pinHash(pin, user.pin.salt), user.pin.hash)) { await addFail(s, fk); await ipFail(s, ik); return nope; }
  await clearFails(s, fk);
  return { ok: true, user };
}
