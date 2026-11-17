/* A&M - connecting a person's own inboxes to their assistant.

   GET  /api/inbox                       which inboxes this person has connected
   GET  /api/inbox?action=start&hint=..  where to sign in to Google (returns a URL);
                                         another=1 shows Google's account chooser
   POST /api/inbox { action:"remove", email }

   The Google sign-in comes back through the robots' mailbox callback
   (GOOGLE_REDIRECT_URI, /api/mail?action=callback), which hands it here when
   the state starts with "inbox.". So no new redirect address has to be added
   to the Google app. See _gmail.mjs for what is kept and why. */

import { getStore } from "@netlify/blobs";
import { accountGate, readAccounts } from "./_accounts.mjs";
import { SCOPES, readInboxes, writeInboxes, allowedAddress, personalAllowed, hasCalendar } from "./_gmail.mjs";
import { withLock } from "./_lock.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const STATE = n => "inbox-state-" + n;
const page = (title, text) => new Response(`<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width"><body style="font-family:Arial;padding:2rem;color:#1a1917"><h2>${title}</h2><p>${text}</p><p><a href="/command.html" style="color:#329dbb">Back to the command centre</a></p>`, { status: 200, headers: { "content-type": "text/html" } });
const missing = () => ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"].filter(k => !process.env[k]);

/* Called from mail.mjs when Google comes back with a state that starts "inbox.". */
export async function inboxCallback(url) {
  const s = store();
  const state = url.searchParams.get("state") || "", code = url.searchParams.get("code");
  const nonce = state.slice(6);
  const saved = await s.get(STATE(nonce), { type: "json" });
  await s.delete(STATE(nonce)).catch(() => {});
  if (!saved || Date.now() - saved.at > 600000 || !code) return page("That did not work", "The Google sign-in did not match a request from the app, or took longer than ten minutes. Start again from My day.");
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: process.env.GOOGLE_REDIRECT_URI, grant_type: "authorization_code", code }).toString() });
  const t = await r.json().catch(() => ({}));
  if (!r.ok || !t.refresh_token) return page("That did not work", "Google did not hand over a lasting sign-in. " + (t.error_description || t.error || "") + " Try again from My day.");
  const prof = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/profile", { headers: { authorization: "Bearer " + t.access_token } }).then(x => x.json()).catch(() => ({}));
  const email = String(prof.emailAddress || "").toLowerCase();
  /* Whose assistant this is decides what may be connected: A&M work inboxes
     for everyone, a personal Gmail for Craig and Amir only. */
  const { accounts } = await readAccounts(s);
  const account = accounts[saved.userId];
  if (!account || account.active === false) return page("Not connected", "That account is not active any more.");
  if (!allowedAddress(email, account)) return page("Not connected", `${email || "That inbox"} cannot be connected here. Only A&amp;M work inboxes can be added to an assistant, and never the robots' mailbox.${personalAllowed(account) ? "" : " A personal Gmail can be added by Craig and Amir only."} If Google signed you in to the wrong account, start again from My day with Add another inbox and pick the right one.`);
  await withLock(s, "inbox-" + saved.userId, async () => {
    const list = (await readInboxes(s, saved.userId)).filter(x => x.email !== email);
    list.push({ email, refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000, addedAt: new Date().toISOString(), scope: String(t.scope || "") });
    await writeInboxes(s, saved.userId, list);
  });
  return page(email + " is connected", "Your assistant sorts this inbox every half hour through the working day, puts what needs you at the top of My day with a reply drafted, and shows your meetings. Nothing is sent unless you press Approve and send.");
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser, url = new URL(req.url), action = url.searchParams.get("action") || "";
  if (req.method === "GET" && !action) {
    const list = await readInboxes(s, u.id);
    const { accounts } = await readAccounts(s);
    return json({ inboxes: list.map(x => ({ email: x.email, addedAt: x.addedAt, calendar: hasCalendar(x) })), ready: !missing().length, missing: missing(), personal: !u.viewAs && personalAllowed(accounts[u.id]) });
  }
  if (req.method === "GET" && action === "start") {
    if (missing().length) return json({ error: "setup", message: "Google sign-in is not set up in Netlify yet: " + missing().join(", ") }, 409);
    const nonce = crypto.randomUUID();
    await s.setJSON(STATE(nonce), { userId: u.id, at: Date.now() });
    /* The first inbox: Google is pointed at the person's own work address.
       "Add another inbox": Google shows its account chooser instead, so a
       second inbox (or Craig's and Amir's personal Gmail) can be picked and
       the browser's current account is not connected by mistake. */
    const another = url.searchParams.get("another") === "1";
    const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: process.env.GOOGLE_REDIRECT_URI, response_type: "code", scope: SCOPES.join(" "), access_type: "offline", prompt: another ? "select_account consent" : "consent", state: "inbox." + nonce });
    const hint = url.searchParams.get("hint") || (another ? "" : u.email || "");
    if (hint) q.set("login_hint", hint);
    return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + q });
  }
  if (req.method === "POST") {
    const b = await req.json().catch(() => ({}));
    if (b.action === "remove") {
      await withLock(s, "inbox-" + u.id, async () => writeInboxes(s, u.id, (await readInboxes(s, u.id)).filter(x => x.email !== String(b.email || "").toLowerCase())));
      return json({ ok: true });
    }
  }
  return json({ error: "bad", message: "Unknown request." }, 400);
};

export const config = { path: "/api/inbox" };
