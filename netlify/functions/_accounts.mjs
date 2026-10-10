/* A&M - accounts for the command centre.

   The shop keeps its names and four-digit PINs. They suit a crew member with
   gloves on, on a phone in a basement, and they stay exactly as they were.

   The command centre is different. It shows money, every job and the robots'
   emails, and it is used at a desk. So from v53 it has its own accounts: a work
   email and a password, one per person, created by an admin inside the app.

   Each account has:
     areas   what the person sees: office, money, field, assistants
     level   what the person can do: view, edit (make changes), admin (also
             manage people and access)
   The responsibility names on the People and access page (Whole company,
   Office, Estimating, Field) are only shortcuts for a set of areas.

   WHERE IT LIVES
   One small record in the app's store, "app-accounts". Passwords are never
   stored, only a slow one-way scramble of them (PBKDF2, 600,000 rounds, its own
   random salt per person). Nobody, including an admin, can read a password
   back. An admin can only issue a new temporary one.

   TOKENS
   A signed-in browser holds a token signed with the same key as the shop's,
   but shaped differently ({k:"acct"}). The shop's gate refuses these and this
   gate refuses the shop's, so a shop PIN can never open the command centre
   and an account can never stand in for a PIN on the shop's endpoints.
   Changing or resetting a password, or switching an account off, ends every
   token that person holds, on every device, at their next click. */

import { authStore, signToken, readToken } from "./_auth.mjs";
import { withLock } from "./_lock.mjs";

export const ACCOUNTS = "app-accounts";
export const ACCOUNTS_LOG = "app-accounts-log";
export const AREAS = ["office", "money", "field", "assistants"];
export const LEVELS = ["view", "edit", "admin"];
export const PRESETS = {
  company:    { label: "Whole company", areas: ["office", "money", "field", "assistants"] },
  office:     { label: "Office",        areas: ["office", "money", "assistants"] },
  estimating: { label: "Estimating",    areas: ["office", "assistants"] },
  field:      { label: "Field",         areas: ["field"] }
};
export const IDLE_CHOICES = [1, 4, 8, 12];
const ITER = Number(process.env.PW_ITER || 600000);
const ACCOUNT_DAYS = Number(process.env.ACCOUNT_DAYS || 14);
export const MIN_PW = 10;

const enc = new TextEncoder();
const b64url = buf => {
  const arr = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = ""; for (const b of arr) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const fromB64url = str => {
  const s = String(str || "").replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(s + (s.length % 4 ? "=".repeat(4 - (s.length % 4)) : ""));
  const out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
};

export function presetOf(areas) {
  const a = [...(areas || [])].sort().join(",");
  for (const [k, p] of Object.entries(PRESETS)) if ([...p.areas].sort().join(",") === a) return k;
  return "custom";
}
export const presetLabel = areas => { const k = presetOf(areas); return k === "custom" ? "Custom" : PRESETS[k].label; };

export const normEmail = e => String(e || "").trim().toLowerCase();
export const okEmail = e => /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[a-z]{2,}$/i.test(e) && e.length <= 120;

/* ------------------------------------------------------------- passwords */
export async function hashPassword(pw, salt = b64url(globalThis.crypto.getRandomValues(new Uint8Array(16))), iter = ITER) {
  const key = await globalThis.crypto.subtle.importKey("raw", enc.encode(String(pw).normalize("NFKC")), "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt: fromB64url(salt), iterations: iter }, key, 256);
  return { salt, hash: b64url(bits), iter };
}
export async function checkPassword(pw, rec) {
  if (!rec || !rec.salt || !rec.hash) return false;
  const got = await hashPassword(pw, rec.salt, rec.iter || ITER);
  const a = got.hash, b = rec.hash;
  if (a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
export const needsRehash = rec => !rec || (rec.iter || 0) < ITER;

/* What a password has to be. Long rather than clever: a short sentence is
   easier to remember and harder to guess than "P@ssw0rd1". */
export function passwordProblem(pw, acc) {
  const p = String(pw || "");
  if (p.length < MIN_PW) return `Use at least ${MIN_PW} characters. A short sentence works well.`;
  if (p.length > 200) return "That is too long. Keep it under 200 characters.";
  if (/^(.)\1+$/.test(p)) return "That is one character repeated. Choose something harder to guess.";
  const low = p.toLowerCase();
  if (acc && acc.email && (low === acc.email || low === acc.email.split("@")[0])) return "Do not use your email address as your password.";
  if (["password12", "password123", "1234567890", "qwertyuiop", "amabatement", "a&mabatement", "abatement1", "letmein123", "welcome123"].includes(low)) return "That one is on every list of common passwords. Choose another.";
  return "";
}

/* Temporary passwords an admin reads out or hands over. No letters that look
   alike (no 0/o, 1/l/i), in three groups so it can be read over the phone. */
export function tempPassword() {
  const A = "abcdefghjkmnpqrstuvwxyz23456789";
  const r = globalThis.crypto.getRandomValues(new Uint8Array(12));
  const c = [...r].map(x => A[x % A.length]).join("");
  return c.slice(0, 4) + "-" + c.slice(4, 8) + "-" + c.slice(8, 12);
}

/* ------------------------------------------------------------- the store */
export const accountsStore = authStore;
export async function readAccounts(s) {
  const d = (await s.get(ACCOUNTS, { type: "json" })) || {};
  return { accounts: d.accounts || {}, settings: { idleHours: 8, ...(d.settings || {}) } };
}
/* Every change goes through here, one writer at a time. */
export async function changeAccounts(s, fn) {
  return withLock(s, "accounts", async () => {
    const doc = await readAccounts(s);
    const out = await fn(doc);
    await s.setJSON(ACCOUNTS, { accounts: doc.accounts, settings: doc.settings, updatedAt: new Date().toISOString() });
    return out;
  });
}
export async function logAccount(s, entry) {
  try {
    const l = (await s.get(ACCOUNTS_LOG, { type: "json" })) || { entries: [] };
    l.entries.unshift({ at: new Date().toISOString(), ...entry });
    l.entries = l.entries.slice(0, 300);
    await s.setJSON(ACCOUNTS_LOG, l);
  } catch (e) {}
}

/* What leaves the server about an account. Never the password scramble. */
export function publicAccount(a) {
  if (!a) return null;
  return {
    id: a.id, email: a.email, name: a.name, title: a.title || "", areas: a.areas || [], level: a.level,
    responsibility: presetOf(a.areas), responsibilityLabel: presetLabel(a.areas),
    active: a.active !== false, mustChange: !!a.mustChange, createdAt: a.createdAt || "", createdBy: a.createdBy || "",
    lastSignIn: a.lastSignIn || "", passwordSetAt: a.pwv || "", claude: !!a.claude
  };
}
export const activeAdmins = accounts => Object.values(accounts).filter(a => a.active !== false && a.level === "admin");

/* ---------------------------------------------------------------- tokens */
export async function accountToken(s, a) {
  return signToken(s, { k: "acct", a: a.id, v: a.pwv || "", t: Date.now(), m: a.mustChange ? 1 : 0 });
}

function refuse(error, message, status = 401) {
  return new Response(JSON.stringify({ error, message }), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}

/* The command centre's gate. Returns null to let the request through, or the
   Response to send back, and puts who it is on req.amUser.
   opts.allowMustChange lets through a person still on a temporary password,
   which only the change-password call does. */
export async function accountGate(req, s = authStore(), opts = {}) {
  let tok = "";
  const h = req.headers.get("authorization") || "";
  if (/^Bearer\s+/i.test(h)) tok = h.replace(/^Bearer\s+/i, "").trim();
  if (!tok) return refuse("auth", "Sign in with your email and password.");
  const claim = await readToken(s, tok);
  if (!claim || claim.k !== "acct" || !claim.a) return refuse("auth", "Sign in with your email and password.");
  if (!claim.t || Date.now() - Number(claim.t) > ACCOUNT_DAYS * 86400000) return refuse("auth", "It has been a while. Sign in again.");
  const { accounts, settings } = await readAccounts(s);
  const a = accounts[claim.a];
  if (!a) return refuse("auth", "That account no longer exists. Ask an admin.");
  if (a.active === false) return refuse("auth", "That account has been switched off. Ask an admin.");
  if ((a.pwv || "") !== (claim.v || "")) return refuse("auth", "Your password was changed. Sign in again.");
  if ((claim.m || a.mustChange) && !opts.allowMustChange) return refuse("must_change", "Choose your own password before you carry on.", 403);
  const areas = (a.areas || []).filter(x => AREAS.includes(x));
  req.amUser = {
    kind: "account", id: a.id, name: a.name, email: a.email, title: a.title || "", areas, level: a.level,
    edit: a.level === "edit" || a.level === "admin", admin: a.level === "admin",
    office: areas.includes("office"), mustChange: !!a.mustChange, idleHours: settings.idleHours,
    claude: !!a.claude
  };
  req.amUser.role = areas.includes("office") && areas.includes("field") ? "owner" : areas.includes("office") ? "office" : areas.includes("field") ? "field" : "none";
  return null;
}

export const sees = (u, ...any) => !!u && Array.isArray(u.areas) && any.some(x => u.areas.includes(x));
export const canEdit = u => !!(u && u.edit);
export const isAdmin = u => !!(u && u.admin);
export const forbid = message => refuse("role", message, 403);
