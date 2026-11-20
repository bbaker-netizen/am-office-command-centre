/* A&M - accounts for the command centre.

   The shop keeps its names and four-digit PINs. They suit a crew member with
   gloves on, on a phone in a basement, and they stay exactly as they were.

   The command centre is different. It shows money, every job and the robots'
   emails, and it is used at a desk. So from v53 it has its own accounts: a work
   email and a password, one per person, created by an admin inside the app.

   Each account has:
     areas   what the person sees: office, money, payroll, field, assistants
             (payroll is its own area from v71, separate from money, so a
             person can run payroll without seeing the company's numbers)
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

import { ROLE_KEYS, roleFromTitle, roleFromAreas } from "./_roles.mjs";
import { authStore, signToken, readToken } from "./_auth.mjs";
import { withLock } from "./_lock.mjs";

export const ACCOUNTS = "app-accounts";
export const ACCOUNTS_LOG = "app-accounts-log";
export const AREAS = ["office", "money", "payroll", "field", "assistants"];
export const LEVELS = ["view", "edit", "admin"];
export const PRESETS = {
  company:    { label: "Whole company", areas: ["office", "money", "payroll", "field", "assistants"] },
  office:     { label: "Office",        areas: ["office", "money", "payroll", "assistants"] },
  estimating: { label: "Estimating",    areas: ["office", "assistants"] },
  field:      { label: "Field",         areas: ["field"] }
};
export const IDLE_CHOICES = [1, 4, 8, 12];
/* Personal assistants (Bruce's brief, 2026-11-15). "exec" for leadership,
   "project" for project managers and field leads (built, held back until
   Craig and Amir switch it on for staff), "none". Craig and Amir start as
   executive assistants and open on their briefing. */
/* From 2026-11-20 every person has one, for their position (Craig: "Each
   person needs an assistant regardless"). See _roles.mjs. "none" is still
   accepted from older saves, but means "pick it from the job title". */
export const ASSISTANTS = [...ROLE_KEYS, "none"];
/* The master admin (Bruce, 2026-11-15): one level above admin. Named only in
   Netlify (MASTER_ADMINS, comma-separated email addresses), so nobody can
   make themselves master from inside the app. Only a master admin can:
   - see another person's email while viewing as them (View as);
   - change, reset, invite, switch off or remove a master admin's account.
   Admins (Craig, Amir) keep View as, but without anyone's mail. */
export function isMaster(a) {
  const list = String(process.env.MASTER_ADMINS || "").split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
  return !!a && a.active !== false && a.level === "admin" && list.includes(String(a.email || "").trim().toLowerCase());
}
export const LANDINGS = ["brief", "overview"];
const EXEC_START = ["craig@amabatement.com", "amir@amabatement.com"];
export function assistantOf(a) {
  if (!a) return "none";
  if (ROLE_KEYS.includes(a.assistant)) return a.assistant;
  if (EXEC_START.includes(String(a.email || "").toLowerCase())) return "exec";
  return roleFromTitle(a.title) || roleFromAreas(a.areas);
}
/* Walkthroughs a person has seen or put away, kept on their account so the
   tour does not open again on another computer, in another browser, or after
   a browser forgets what it was told. Key: which walkthrough. Value: when. */
export const TOUR_KEY = /^[a-z0-9][a-z0-9.\-]{0,59}$/;
/* Before 2026-11-20 (v92) "seen" was kept only in one browser, so some
   people (Amir) were shown the walkthrough over and over. Anyone who had
   already signed in before v92 went live has been shown it, so it counts as
   seen for them on every computer. Craig asked, 2026-11-20. Not What's new:
   that is once per release and is marked as it opens. */
export const TOURS_KEPT_FROM = "2026-11-20T18:53:43Z";
export const MAIN_TOUR = "command-tour.v1";
export function signedInBeforeTours(a) {
  if (!a) return false;
  if (a.lastSignIn && a.lastSignIn < TOURS_KEPT_FROM) return true;
  return !!(a.pwv && a.pwv < TOURS_KEPT_FROM && !a.mustChange && a.lastSignIn);
}
export function toursOf(a) {
  const t = a && a.tours, out = {};
  if (t && typeof t === "object") for (const k of Object.keys(t)) if (TOUR_KEY.test(k) && typeof t[k] === "string") out[k] = t[k];
  if (!out[MAIN_TOUR] && signedInBeforeTours(a)) out[MAIN_TOUR] = "before " + TOURS_KEPT_FROM.slice(0, 10);
  return out;
}
export function landingOf(a) {
  if (a && LANDINGS.includes(a.landing)) return a.landing;
  return assistantOf(a) === "exec" ? "brief" : "overview";
}
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
  return splitPayroll({ accounts: d.accounts || {}, settings: { idleHours: 8, ...(d.settings || {}) } });
}
/* Before v71, payroll came with Money. So nobody loses it on the day it splits,
   every account that saw Money is given Payroll too, once. The flag in settings
   stops it running again, so an admin can then untick Payroll for a Money
   person and it stays unticked. It is saved with the next change to accounts. */
export function splitPayroll(doc) {
  if (doc.settings.payrollSplit) return doc;
  for (const a of Object.values(doc.accounts)) {
    const areas = Array.isArray(a.areas) ? a.areas : [];
    if (areas.includes("money") && !areas.includes("payroll")) a.areas = AREAS.filter(x => areas.includes(x) || x === "payroll");
  }
  doc.settings.payrollSplit = true;
  return doc;
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
    lastSignIn: a.lastSignIn || "", passwordSetAt: a.pwv || "", claude: !!a.claude, assistant: assistantOf(a), landing: landingOf(a), master: isMaster(a),
    /* The invite's dates only. The link itself is never stored, only a scramble of it. */
    invite: a.invite ? { sentAt: a.invite.at || "", expires: a.invite.exp || "", by: a.invite.by || "", emailed: !!a.invite.emailed } : null
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
  req.amUser = userOf(a, settings);
  /* View as: an admin sees the command centre exactly as another person sees
     it, to check what they see and sort out their access. Look only: anything
     but a plain read is refused on the server, whatever the page does, and the
     person's own Google Drive and sign-in steps are never opened. */
  const viewAs = String(req.headers.get("x-am-view-as") || "").trim();
  if (viewAs) {
    const real = req.amUser;
    const why = viewAsProblem(real, accounts[viewAs], req.method, req.url);
    if (why) return refuse(why.error, why.message, why.status);
    req.amReal = real;
    req.amUser = { ...userOf(accounts[viewAs], settings), edit: false, admin: false, master: false, claude: false, shownLevel: accounts[viewAs].level, viewAs: { byId: real.id, byName: real.name, mail: !!real.master } };
  }
  return null;
}

/* The person a token stands for, as every function sees them. */
export function userOf(a, settings = {}) {
  const areas = (a.areas || []).filter(x => AREAS.includes(x));
  const u = {
    kind: "account", id: a.id, name: a.name, email: a.email, title: a.title || "", areas, level: a.level,
    edit: a.level === "edit" || a.level === "admin", admin: a.level === "admin",
    office: areas.includes("office"), mustChange: !!a.mustChange, idleHours: settings.idleHours,
    claude: !!a.claude, assistant: assistantOf(a), landing: landingOf(a), projectLive: !!settings.projectAssistantLive, master: isMaster(a),
    tours: toursOf(a)
  };
  u.role = areas.includes("office") && areas.includes("field") ? "owner" : areas.includes("office") ? "office" : areas.includes("field") ? "field" : "none";
  return u;
}

/* Why a View as request is refused, or null when it may go ahead. */
const VIEW_AS_NEVER = ["start", "connect", "callback", "disconnect", "forget", "login", "setup", "password"];
export function viewAsProblem(real, target, method, url) {
  if (!real || !real.admin) return { error: "role", message: "Only an admin can view the command centre as someone else.", status: 403 };
  if (!target || target.active === false) return { error: "view_as", message: "That person's account is not there or is switched off.", status: 404 };
  if (isMaster(target) && !real.master) return { error: "role", message: "That is the master admin's account. Only the master admin can view it.", status: 403 };
  const m = String(method || "GET").toUpperCase();
  const name = String(target.name || "that person").split(" ")[0];
  if (m !== "GET" && m !== "HEAD") return { error: "view_only", message: `You are viewing as ${name}. Nothing can be changed while you do. Go back to yourself first.`, status: 403 };
  let path = "", action = "";
  try { const u = new URL(url, "https://x"); path = u.pathname; action = u.searchParams.get("action") || u.searchParams.get("get") || ""; } catch (e) {}
  if (/^\/api\/drive\b/.test(path)) return { error: "view_only", message: `Google Drive is ${name}'s own, so it is not opened while you view as them.`, status: 403 };
  if (VIEW_AS_NEVER.includes(action)) return { error: "view_only", message: `That step is not available while you view as ${name}.`, status: 403 };
  return null;
}

export const sees = (u, ...any) => !!u && Array.isArray(u.areas) && any.some(x => u.areas.includes(x));
export const canEdit = u => !!(u && u.edit);
export const isAdmin = u => !!(u && u.admin);
export const forbid = message => refuse("role", message, 403);
