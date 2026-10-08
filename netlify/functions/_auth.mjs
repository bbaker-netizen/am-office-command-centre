/* A&M Inventory - who is asking.

   This replaces the shared shop code. The shop code was one secret that
   everybody held, which meant it could say "somebody from A&M" and nothing
   more. It could not tell Jen from Craig, and it could not be taken away from
   one person who had left without being taken away from all eight.

   What is here instead: each person proves who they are once, with their own
   PIN, and the server hands that phone a token belonging to that one person.
   Every request after that carries the token. Taking somebody's access away is
   now a switch next to their name, and it lands on their phone the next time it
   speaks to the office.

   WHY THE PIN HASHES ARE NO LONGER SENT TO PHONES
   The catalog used to travel with every user's `pin.salt` and `pin.hash` in it,
   and every phone got the whole thing. A PIN is four digits. Ten thousand
   guesses against a known salt is a few milliseconds of work, so anybody
   holding that catalog held everybody's PIN. The hashes now stay on the server.
   A phone is told its own, and only its own, so it can still unlock itself in a
   basement with no signal.

   THE ONE PROPERTY THIS FILE IS BUILT AROUND, RESTATED
   The old gate failed open until somebody set an environment variable, so that
   a deploy could never lock out a crew. That was the right instinct and it is
   kept, but it is no longer permanent: this gate is open only while NOBODY has
   a PIN. The moment the office issues the first one, the gate is real and it
   cannot quietly fall open again. So this can be deployed in the middle of a
   shift and change nothing, and it arms itself when the office is ready. */

import { getStore } from "@netlify/blobs";

const STORE = "am-inventory";
const CATALOG = "catalog";
const AUTH_INDEX = "auth-index";
const SECRET_KEY = "auth-secret";
const ARMED_KEY = "auth-armed";

/* How long a phone stays signed in before it has to type its PIN again with a
   bar of signal. Long enough that nobody is caught out on a two-week job in the
   bush, short enough that a lost phone stops working on its own. */
const TOKEN_DAYS = Number(process.env.TOKEN_DAYS || 30);

export const authStore = () => getStore({ name: STORE, consistency: "strong" });

const enc = new TextEncoder();
const dec = new TextDecoder();

function b64url(input) {
  const arr = input instanceof Uint8Array ? input : new Uint8Array(input);
  let s = "";
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromB64url(str) {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const pad = s.length % 4 ? "=".repeat(4 - (s.length % 4)) : "";
  const bin = atob(s + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/* The signing key. Preferred from the environment so it survives a store wipe
   and can be rotated deliberately; generated into the store on first use if
   nobody has set one, because a missing key must not be the thing that decides
   whether eight people can work. Rotating it signs everybody out, which is the
   correct behaviour for a key that is suspected of having leaked. */
let _key = null;
async function signingKey(s) {
  if (_key) return _key;
  let secret = process.env.AUTH_SECRET;
  if (!secret) {
    secret = await s.get(SECRET_KEY, { type: "text" });
    if (!secret) {
      secret = b64url(globalThis.crypto.getRandomValues(new Uint8Array(32)));
      await s.set(SECRET_KEY, secret);
    }
  }
  _key = await globalThis.crypto.subtle.importKey(
    "raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]
  );
  return _key;
}

export async function signToken(s, payload) {
  const k = await signingKey(s);
  const body = b64url(enc.encode(JSON.stringify(payload)));
  const sig = await globalThis.crypto.subtle.sign("HMAC", k, enc.encode(body));
  return body + "." + b64url(sig);
}

export async function readToken(s, tok) {
  const parts = String(tok || "").split(".");
  if (parts.length !== 2) return null;
  try {
    const k = await signingKey(s);
    const ok = await globalThis.crypto.subtle.verify(
      "HMAC", k, fromB64url(parts[1]), enc.encode(parts[0])
    );
    if (!ok) return null;
    return JSON.parse(dec.decode(fromB64url(parts[0])));
  } catch (e) { return null; }
}

/* A small standing summary of who may sign in, kept beside the catalog and
   rebuilt whenever the catalog is saved. The catalog itself is three hundred
   kilobytes and every request would otherwise have to read all of it just to
   answer "is this person still allowed", including the event pushes coming off
   a phone on one bar of signal. */
export function buildAuthIndex(catalog) {
  const users = {};
  let anyPins = false;
  for (const u of (catalog?.users || [])) {
    if (!u || !u.id) continue;
    const hasPin = !!(u.pin && u.pin.hash);
    if (hasPin) anyPins = true;
    users[u.id] = { active: u.active !== false, pv: u.pinSetAt || "", hasPin, name: u.name || "" };
  }
  return { users, anyPins, builtAt: new Date().toISOString() };
}

export async function writeAuthIndex(s, catalog) {
  const idx = buildAuthIndex(catalog);
  await s.setJSON(AUTH_INDEX, idx);
  /* Once anybody has had a PIN the gate stays shut for good, even if a later
     save arrives with nobody's PIN in it. Before 2026-10 a single catalog save
     with an empty people list switched the whole app back to open. */
  if (idx.anyPins) { try { await s.setJSON(ARMED_KEY, { at: new Date().toISOString() }); } catch (e) {} }
  return idx;
}

export async function isArmed(s, idx) {
  if (process.env.AUTH_REQUIRED === "1") return true;
  if (idx && idx.anyPins) return true;
  try { return !!(await s.get(ARMED_KEY, { type: "json" })); } catch (e) { return true; }
}

/* WHO COUNTS AS THE OFFICE
   Set OFFICE_USERS in Netlify to the names (or ids) of the people allowed to
   change people, PINs, settings, the JobTread and QuickBooks connections, and to
   wipe history. Comma separated, case does not matter: "Jen Garrison,Craig,Max".
   It lives in Netlify rather than in the app's own data on purpose: nobody can
   promote themselves from a phone. If it is not set, everybody signed in is
   treated as office, which is how the app behaved before, and the office screen
   says so. */
const listOf = name => String(process.env[name] || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
export function officeList() { return listOf("OFFICE_USERS").concat(listOf("OWNER_USERS")); }
const inList = (list, user) => !!user && (list.includes(String(user.name || "").toLowerCase()) || list.includes(String(user.id || "").toLowerCase()));
export function isOffice(user) {
  const list = officeList();
  if (!list.length) return true;
  return inList(list, user);
}

/* WHAT EACH PERSON SEES IN THE COMMAND CENTRE
   OWNER_USERS   everything, every tab, including money.       e.g. "Craig Williams"
   OFFICE_USERS  estimating, dispatch, money and records.       e.g. "Jen Garrison"
   FIELD_USERS   projects, sites, closeout and equipment.        e.g. "Amir Faiz,Ryan,Pat,George"
   Everybody else is crew: the scanning screens and nothing more.
   Unlike the office check above, nobody gets the command centre by default:
   until these are set in Netlify, it is closed to everyone. */
export function roleOf(user) {
  if (!user) return "crew";
  if (inList(listOf("OWNER_USERS"), user)) return "owner";
  if (inList(listOf("OFFICE_USERS"), user)) return "office";
  if (inList(listOf("FIELD_USERS"), user)) return "field";
  return "crew";
}

export function requireOffice(req) {
  if (!req.amUser) return null;            /* gate is open: nobody has a PIN yet */
  if (isOffice(req.amUser)) return null;
  return refuse("office", "Only the office can do that. Ask Jen.", 403);
}

export async function readAuthIndex(s) {
  let idx = await s.get(AUTH_INDEX, { type: "json" });
  if (!idx) {
    /* First run after this went out, or the summary was lost. Rebuild it from
       the catalog rather than refusing everybody. */
    const cat = await s.get(CATALOG, { type: "json" });
    idx = buildAuthIndex(cat || {});
    try { await s.setJSON(AUTH_INDEX, idx); } catch (e) {}
  }
  return idx;
}

function refuse(reason, message, status = 401) {
  return new Response(JSON.stringify({ error: reason, message }), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

/* Returns null to let the request through, or the Response to send back.
   Also hands the caller who it decided this was, on `req.amUser`, so an
   endpoint can record the real person rather than trusting a name in a body. */
export async function authGate(req, s = authStore(), opts = {}) {
  const idx = await readAuthIndex(s);

  /* Nobody has ever been issued a PIN, so the office has not started yet and
     this is the app exactly as it was. See the note at the top of this file.
     Once armed, it never opens again on its own. */
  if (!idx.anyPins && !(await isArmed(s, idx))) return null;

  let tok = "";
  const h = req.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(h)) tok = h.replace(/^Bearer\s+/i, "").trim();
  if (!tok) tok = req.headers.get("x-am-token") || "";
  /* Only where a header genuinely cannot be sent. A token in a web address
     ends up in logs and browser history. */
  if (!tok && opts.allowQueryToken) {
    try { tok = new URL(req.url).searchParams.get("token") || ""; } catch (e) {}
  }
  if (!tok) return refuse("auth", "Sign in on this phone before it can reach the office.");

  const claim = await readToken(s, tok);
  if (!claim || !claim.u) return refuse("auth", "This phone needs to sign in again.");
  if (!claim.t || Date.now() - Number(claim.t) > TOKEN_DAYS * 86400000) {
    return refuse("auth", "It has been a while. Sign in again with your PIN.");
  }

  const who = idx.users[claim.u];
  if (!who) return refuse("auth", "That person is no longer set up in the app.");
  if (!who.active) return refuse("auth", "That account has been switched off in the office.");

  /* A reset PIN invalidates every token issued against the old one, which is
     what makes "reset their PIN" a real way to cut somebody off a phone you
     cannot physically get hold of. */
  if ((who.pv || "") !== (claim.p || "")) {
    return refuse("auth", "Your PIN was changed in the office. Sign in with the new one.");
  }

  req.amUser = { id: claim.u, name: who.name };
  req.amUser.office = isOffice(req.amUser);
  req.amUser.role = roleOf(req.amUser);
  return null;
}

/* Everything a phone is allowed to know about the people list. The PIN never
   leaves the server, so this is what the catalog looks like on the way out. */
export function stripSecrets(catalog) {
  if (!catalog) return catalog;
  /* An earlier version kept the JobTread key in the catalog settings. It lives
     in its own blob now, but a copy left behind here would go to every phone. */
  if (catalog.settings && catalog.settings.jobtread && catalog.settings.jobtread.grantKey) {
    catalog = { ...catalog, settings: { ...catalog.settings, jobtread: { ...catalog.settings.jobtread, grantKey: "" } } };
  }
  if (!Array.isArray(catalog.users)) return catalog;
  return {
    ...catalog,
    users: catalog.users.map(u => {
      if (!u || !u.pin) return u;
      const { pin, ...rest } = u;
      /* Kept, because the sign-in screen has to know who to offer and the app
         tells somebody without one to go and see the office. What is dropped is
         the salt and the hash, which are the parts worth stealing. */
      return { ...rest, hasPin: !!(pin && pin.hash) };
    })
  };
}

/* The reverse, on the way back in. A phone has not been given anybody's PIN,
   so a catalog it saves cannot be allowed to decide what the PINs are: without
   this, the first save from any phone would wipe all eight and lock the shop
   out of its own app. Newly issued PINs are the one exception, and they arrive
   as a complete `pin` object from the office screen. */
export function mergeSecrets(incoming, existing, opts = {}) {
  if (!incoming || !Array.isArray(incoming.users)) {
    /* A save with no people list at all keeps the people who were there. */
    if (incoming && existing && Array.isArray(existing.users)) return { ...incoming, users: existing.users };
    return incoming;
  }
  const office = opts.office !== false;
  const was = new Map();
  for (const u of (existing?.users || [])) if (u && u.id) was.set(u.id, u);
  const keepOld = (rest, old) => old && old.pin
    ? { ...rest, pin: old.pin, pinSetAt: old.pinSetAt, pinSetBy: old.pinSetBy }
    : { ...rest, pinSetAt: old ? old.pinSetAt : undefined, pinSetBy: old ? old.pinSetBy : undefined };

  let users = incoming.users.map(u => {
    if (!u) return u;
    const { hasPin, pin, ...rest } = u;
    const old = rest.id ? was.get(rest.id) : null;
    if (!office) {
      /* A crew phone can add a name, nothing more. It cannot issue or change a
         PIN, switch anybody on or off, or rename them, because any of those
         would let one person sign in as another. */
      if (old) return { ...keepOld({ ...rest, active: old.active, name: old.name, role: old.role }, old) };
      return { ...rest, active: true };
    }
    if (pin && pin.hash) return { ...rest, pin };       // freshly issued by the office, take it
    if (old && old.pin) return { ...rest, pin: old.pin, pinSetAt: rest.pinSetAt || old.pinSetAt, pinSetBy: rest.pinSetBy || old.pinSetBy };
    return rest;
  });

  /* Nobody but the office takes a person off the list. */
  if (!office) {
    const ids = new Set(users.filter(Boolean).map(u => u.id).filter(Boolean));
    for (const [id, old] of was) if (!ids.has(id)) users.push(old);
  }

  const out = { ...incoming, users };
  /* Settings are the office's: lock time, the reset stamp, the connections.
     So is taking a person off the list on every phone. */
  if (!office && existing) {
    out.settings = existing.settings;
    const dead = { ...((incoming.deleted) || {}) };
    if (existing.deleted && existing.deleted.users) dead.users = existing.deleted.users; else delete dead.users;
    out.deleted = dead;
  }
  return out;
}
