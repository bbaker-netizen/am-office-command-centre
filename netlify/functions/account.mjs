/* A&M - signing in to the command centre, and the People and access page.

   GET  /api/account?action=status     is there an account yet (anyone may ask)
   POST {action:"login", email, password}
   POST {action:"setup", shopName, pin, name, email, password}
                                        the very first account only, see below
   GET  /api/account?action=me          who this browser is signed in as
   POST {action:"password", current, next}
   Admins only:
   GET  /api/account?action=list
   POST {action:"create" | "update" | "reset" | "remove" | "settings", ...}

   THE FIRST ACCOUNT
   Nobody can be given an account until an admin exists, and nobody is an admin
   until they have an account. That knot is cut once, by an owner proving who
   they are with the shop name and PIN they already have (an owner is a name in
   OWNER_USERS in Netlify). It creates one account, for that person, with the
   whole company and admin. The moment any account exists, setup refuses for
   good. There is no code or secret to leave lying around. */

import { authStore, roleOf } from "./_auth.mjs";
import { readFails, addFail, clearFails, lockedFor, ipKey, ipBlocked, ipFail, checkShopPin } from "./_pin.mjs";
import {
  AREAS, LEVELS, PRESETS, IDLE_CHOICES, ACCOUNTS_LOG, normEmail, okEmail, hashPassword, checkPassword, needsRehash,
  passwordProblem, tempPassword, readAccounts, changeAccounts, logAccount, publicAccount, activeAdmins,
  accountToken, accountGate, isAdmin
} from "./_accounts.mjs";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const bad = (message, status = 400, error = "bad") => json({ error, message }, status);

async function emailKey(email) {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("acct:" + email));
  return "acctfail-" + [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
const cleanText = (v, max) => String(v == null ? "" : v).replace(/[\u0000-\u001f<>]/g, "").trim().slice(0, max);
const newId = () => "a-" + [...globalThis.crypto.getRandomValues(new Uint8Array(6))].map(b => b.toString(16).padStart(2, "0")).join("");
const byEmail = (accounts, email) => Object.values(accounts).find(a => a.email === email);

/* What a person may see. At least one of office, money or field, because the
   assistants on their own have nothing to show beside them. */
function cleanAreas(list) {
  const a = [...new Set((Array.isArray(list) ? list : []).filter(x => AREAS.includes(x)))];
  if (!a.some(x => ["office", "money", "field"].includes(x))) return null;
  return AREAS.filter(x => a.includes(x));
}

/* A scramble of nothing, so a wrong email takes as long to refuse as a wrong
   password, and the answer time cannot be used to find out who has an account. */
let DUMMY = null;
const dummy = async () => DUMMY || (DUMMY = await hashPassword("not-a-password-at-all", "QU1hYmF0ZW1lbnQtZHVtbXk"));

export default async (req) => {
  const s = authStore();
  const url = new URL(req.url);
  let action = url.searchParams.get("action") || "", body = {};
  if (req.method === "POST") {
    try { body = await req.json(); } catch { return bad("Body was not valid JSON."); }
    action = String(body.action || "");
  } else if (req.method !== "GET") return bad("Use GET or POST.", 405);

  try {
    /* ------------------------------------------------------------ status */
    if (action === "status") {
      const { accounts } = await readAccounts(s);
      return json({ ready: Object.keys(accounts).length > 0 });
    }

    /* ------------------------------------------------------------- login */
    if (action === "login") {
      const ik = await ipKey(req);
      if (await ipBlocked(s, ik)) return bad("Too many wrong tries from this connection. Wait an hour, or ask an admin.", 429, "locked");
      const email = normEmail(body.email), pw = String(body.password || "");
      if (!email || !pw) return bad("Type your email and your password.", 400, "auth");
      const fk = await emailKey(email);
      const mins = lockedFor(await readFails(s, fk));
      if (mins) return bad(`Too many wrong tries. Wait ${mins} minute${mins === 1 ? "" : "s"}, or ask an admin to reset your password.`, 429, "locked");
      const { accounts, settings } = await readAccounts(s);
      const a = byEmail(accounts, email);
      const nope = () => bad("That email and password do not match.", 401, "auth");
      if (!a) { await checkPassword(pw, await dummy()); await addFail(s, fk); await ipFail(s, ik); return nope(); }
      if (!(await checkPassword(pw, a.pw))) { await addFail(s, fk); await ipFail(s, ik); return nope(); }
      if (a.active === false) return bad("This account has been switched off. Ask an admin.", 403, "off");
      await clearFails(s, fk);
      const fresh = needsRehash(a.pw) ? await hashPassword(pw) : null;
      const saved = await changeAccounts(s, doc => {
        const x = doc.accounts[a.id]; if (!x) return a;
        x.lastSignIn = new Date().toISOString();
        if (fresh) x.pw = fresh;
        return x;
      });
      return json({ token: await accountToken(s, saved), account: publicAccount(saved), mustChange: !!saved.mustChange, idleHours: settings.idleHours });
    }

    /* ------------------------------------------------------------- setup */
    if (action === "setup") {
      const { accounts } = await readAccounts(s);
      if (Object.keys(accounts).length) return bad("The command centre is already set up. Sign in with your email and password.", 403, "ready");
      const name = cleanText(body.name, 80), email = normEmail(body.email), pw = String(body.password || "");
      if (!name) return bad("Type your full name.");
      if (!okEmail(email)) return bad("That email address does not look right.");
      const prob = passwordProblem(pw, { email }); if (prob) return bad(prob);
      const shop = await checkShopPin(s, req, String(body.shopName || ""), String(body.pin || ""));
      if (!shop.ok) return bad(shop.message, shop.status, shop.error);
      if (roleOf(shop.user) !== "owner") return bad("Only an owner can set up the first account. Owners are the names in OWNER_USERS in Netlify.", 403, "role");
      const pwRec = await hashPassword(pw);
      const made = await changeAccounts(s, doc => {
        if (Object.keys(doc.accounts).length) return null;
        const now = new Date().toISOString();
        const a = { id: newId(), email, name, title: "Owner", areas: [...PRESETS.company.areas], level: "admin", active: true,
          pw: pwRec, pwv: now, mustChange: false, createdAt: now, createdBy: shop.user.name + " (first setup, shop PIN)", lastSignIn: now };
        doc.accounts[a.id] = a; return a;
      });
      if (!made) return bad("Somebody else set it up a moment ago. Sign in with your email and password.", 409, "ready");
      await logAccount(s, { by: made.name, action: "setup", who: made.name, detail: "First account, set up with " + shop.user.name + "'s shop PIN" });
      return json({ token: await accountToken(s, made), account: publicAccount(made), mustChange: false, idleHours: 8 });
    }

    /* Everything below needs a signed-in account. */
    const denied = await accountGate(req, s, { allowMustChange: action === "me" || action === "password" });
    if (denied) return denied;
    const me = req.amUser;

    if (action === "me") {
      const { accounts, settings } = await readAccounts(s);
      return json({ account: publicAccount(accounts[me.id]), idleHours: settings.idleHours });
    }

    /* ---------------------------------------------------------- password */
    if (action === "password") {
      const cur = String(body.current || ""), next = String(body.next || "");
      const { accounts } = await readAccounts(s);
      const a = accounts[me.id];
      const fk = await emailKey(a.email);
      const mins = lockedFor(await readFails(s, fk));
      if (mins) return bad(`Too many wrong tries. Wait ${mins} minute${mins === 1 ? "" : "s"}.`, 429, "locked");
      if (!(await checkPassword(cur, a.pw))) { await addFail(s, fk); return bad("Your current password is not right.", 400, "current"); }
      const prob = passwordProblem(next, a); if (prob) return bad(prob);
      if (next === cur) return bad("The new password has to be different from the old one.");
      await clearFails(s, fk);
      const pwRec = await hashPassword(next);
      const saved = await changeAccounts(s, doc => {
        const x = doc.accounts[me.id];
        x.pw = pwRec; x.pwv = new Date().toISOString(); x.mustChange = false;
        return x;
      });
      await logAccount(s, { by: me.name, action: "password", who: me.name, detail: a.mustChange ? "Chose their own password" : "Changed their password" });
      return json({ ok: true, token: await accountToken(s, saved), account: publicAccount(saved) });
    }

    /* ------------------------------------------------------------ admins */
    if (!isAdmin(me)) return bad("Only an admin can manage people and access.", 403, "role");

    if (action === "list") {
      const { accounts, settings } = await readAccounts(s);
      const log = (await s.get(ACCOUNTS_LOG, { type: "json" })) || { entries: [] };
      const list = Object.values(accounts).map(publicAccount).sort((a, b) => (a.active === b.active ? a.name.localeCompare(b.name) : a.active ? -1 : 1));
      return json({ accounts: list, settings, log: log.entries.slice(0, 40), me: me.id,
        presets: Object.fromEntries(Object.entries(PRESETS).map(([k, p]) => [k, { label: p.label, areas: p.areas }])), idleChoices: IDLE_CHOICES });
    }

    if (action === "create") {
      const name = cleanText(body.name, 80), email = normEmail(body.email), title = cleanText(body.title, 80);
      const areas = cleanAreas(body.areas), level = String(body.level || "");
      if (!name) return bad("Type the person's full name.");
      if (!okEmail(email)) return bad("That email address does not look right.");
      if (!areas) return bad("Tick at least one of Office, Money or Field.");
      if (!LEVELS.includes(level)) return bad("Choose what they can do.");
      const temp = tempPassword(), pwRec = await hashPassword(temp);
      const made = await changeAccounts(s, doc => {
        if (byEmail(doc.accounts, email)) return null;
        const now = new Date().toISOString();
        const a = { id: newId(), email, name, title, areas, level, active: true, pw: pwRec, pwv: now, mustChange: true, createdAt: now, createdBy: me.name, lastSignIn: "" };
        doc.accounts[a.id] = a; return a;
      });
      if (!made) return bad("Somebody already has an account with that email.", 409, "taken");
      await logAccount(s, { by: me.name, action: "create", who: made.name, detail: publicAccount(made).responsibilityLabel + ", " + levelWord(level) });
      return json({ ok: true, account: publicAccount(made), temp });
    }

    if (action === "update") {
      const id = String(body.id || "");
      const out = await changeAccounts(s, doc => {
        const x = doc.accounts[id]; if (!x) return { err: bad("That account is not there any more.", 404, "not_found") };
        const was = publicAccount(x);
        const next = { ...x };
        if (body.name !== undefined) { const n = cleanText(body.name, 80); if (!n) return { err: bad("Type the person's full name.") }; next.name = n; }
        if (body.title !== undefined) next.title = cleanText(body.title, 80);
        if (body.email !== undefined) {
          const e = normEmail(body.email);
          if (!okEmail(e)) return { err: bad("That email address does not look right.") };
          const other = byEmail(doc.accounts, e); if (other && other.id !== id) return { err: bad("Somebody already has an account with that email.", 409, "taken") };
          next.email = e;
        }
        if (body.areas !== undefined) { const a = cleanAreas(body.areas); if (!a) return { err: bad("Tick at least one of Office, Money or Field.") }; next.areas = a; }
        if (body.level !== undefined) { if (!LEVELS.includes(body.level)) return { err: bad("Choose what they can do.") }; next.level = body.level; }
        if (body.active !== undefined) next.active = !!body.active;
        /* Nobody locks themselves out, and the app never ends up with nobody
           who can let people in. */
        if (id === me.id && next.level !== "admin") return { err: bad("You cannot take admin away from yourself. Ask another admin to do it.", 400, "self") };
        if (id === me.id && next.active === false) return { err: bad("You cannot switch off your own account. Ask another admin to do it.", 400, "self") };
        const admins = activeAdmins({ ...doc.accounts, [id]: next });
        if (!admins.length) return { err: bad("That would leave nobody who can manage people. Make someone else an admin first.", 400, "last_admin") };
        next.updatedAt = new Date().toISOString(); next.updatedBy = me.name;
        doc.accounts[id] = next;
        return { was, now: publicAccount(next) };
      });
      if (out.err) return out.err;
      await logAccount(s, { by: me.name, action: "update", who: out.now.name, detail: changeWords(out.was, out.now) });
      return json({ ok: true, account: out.now });
    }

    if (action === "reset") {
      const id = String(body.id || "");
      if (id === me.id) return bad("To change your own password, use Change my password.", 400, "self");
      const temp = tempPassword(), pwRec = await hashPassword(temp);
      const out = await changeAccounts(s, doc => {
        const x = doc.accounts[id]; if (!x) return null;
        x.pw = pwRec; x.pwv = new Date().toISOString(); x.mustChange = true; x.updatedAt = x.pwv; x.updatedBy = me.name;
        return x;
      });
      if (!out) return bad("That account is not there any more.", 404, "not_found");
      try { await clearFails(s, await emailKey(out.email)); } catch (e) {}
      await logAccount(s, { by: me.name, action: "reset", who: out.name, detail: "New temporary password; signed out everywhere" });
      return json({ ok: true, account: publicAccount(out), temp });
    }

    if (action === "remove") {
      const id = String(body.id || "");
      if (id === me.id) return bad("You cannot remove your own account.", 400, "self");
      const out = await changeAccounts(s, doc => {
        const x = doc.accounts[id]; if (!x) return { err: bad("That account is not there any more.", 404, "not_found") };
        if (x.lastSignIn) return { err: bad("This person has signed in before, so the account stays for the record. Switch it off instead.", 400, "used") };
        delete doc.accounts[id];
        if (!activeAdmins(doc.accounts).length) { doc.accounts[id] = x; return { err: bad("That would leave nobody who can manage people.", 400, "last_admin") }; }
        return { name: x.name };
      });
      if (out.err) return out.err;
      await logAccount(s, { by: me.name, action: "remove", who: out.name, detail: "Removed before first sign-in" });
      return json({ ok: true });
    }

    if (action === "settings") {
      const h = Number(body.idleHours);
      if (!IDLE_CHOICES.includes(h)) return bad("Choose one of " + IDLE_CHOICES.join(", ") + " hours.");
      await changeAccounts(s, doc => { doc.settings.idleHours = h; });
      await logAccount(s, { by: me.name, action: "settings", who: "", detail: "Sign out after " + h + " hour" + (h === 1 ? "" : "s") + " without use" });
      return json({ ok: true, settings: { idleHours: h } });
    }

    return bad("Unknown action.", 400, "unknown");
  } catch (e) {
    if (e && e.code === "BUSY") return bad(e.message, 503, "busy");
    return bad("Something went wrong on the server: " + (e && e.message), 500, "server");
  }
};

const levelWord = l => l === "admin" ? "admin" : l === "edit" ? "can make changes" : "view only";
function changeWords(a, b) {
  const out = [];
  if (a.name !== b.name) out.push("name to " + b.name);
  if (a.email !== b.email) out.push("email to " + b.email);
  if (a.title !== b.title) out.push("title to " + (b.title || "none"));
  if (a.areas.join() !== b.areas.join()) out.push("sees " + b.responsibilityLabel + " (" + b.areas.join(", ") + ")");
  if (a.level !== b.level) out.push(levelWord(b.level));
  if (a.active !== b.active) out.push(b.active ? "switched on" : "switched off");
  return out.length ? "Changed " + out.join("; ") : "No change";
}

export const config = { path: "/api/account" };
