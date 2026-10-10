/* A&M - the emails the morning robots write, checked and sent from the app.

   The robots never send anything themselves. They write drafts into one mailbox,
   automation@amabatement.com. This lists those drafts in the app, lets the
   office read each one, and sends or discards it with one press. Gmail does the
   sending, so the email leaves from that mailbox exactly as written, and a copy
   sits in its Sent folder.

   GET  /api/mail?action=status            is it connected, and to which mailbox
   GET  /api/mail?action=connect&mode=url  office only: where to sign in to Google
   GET  /api/mail?action=callback          Google sends the office back here
   GET  /api/mail?action=list              the drafts waiting
   GET  /api/mail?action=get&id=...        one draft, in full
   POST /api/mail {action:"send", id}      send it
   POST /api/mail {action:"discard", id}   throw it away
   POST /api/mail {action:"disconnect"}

   Set in Netlify: GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI
   (https://<site>/api/mail?action=callback), and MAILBOX if it is not
   automation@amabatement.com. The connection refuses any other mailbox, so a
   person cannot accidentally connect their own inbox. Every email sent from here
   carries Reply-To: estimating@amabatement.com (REPLY_TO to change it). */

import { getStore } from "@netlify/blobs";
import { accountGate, sees, canEdit, isAdmin } from "./_accounts.mjs";
import { withLock } from "./_lock.mjs";

const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const TOKENS = "google-tokens", STATE = "google-state", LOG = "mail-log";
const SCOPE = "https://www.googleapis.com/auth/gmail.compose";
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
const mailbox = () => (process.env.MAILBOX || "automation@amabatement.com").toLowerCase();

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
}
const missingEnv = () => ["GOOGLE_CLIENT_ID", "GOOGLE_CLIENT_SECRET", "GOOGLE_REDIRECT_URI"].filter(k => !process.env[k]);

async function tokenCall(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }).toString()
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google refused the sign-in: " + (b.error_description || b.error || r.status));
  return b;
}
async function access(s) {
  let t = await s.get(TOKENS, { type: "json" });
  if (!t || !t.refresh_token) { const e = new Error("The robots' mailbox is not connected yet. The office connects it once."); e.code = "NOT_CONNECTED"; throw e; }
  const ok = x => x.access_token && Date.now() < (x.expires_at || 0) - 120000;
  if (ok(t)) return t.access_token;
  return withLock(s, "google-refresh", async () => {
    t = await s.get(TOKENS, { type: "json" });
    if (ok(t)) return t.access_token;
    const f = await tokenCall({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    const next = { ...t, access_token: f.access_token, expires_at: Date.now() + (f.expires_in || 3600) * 1000, refresh_token: f.refresh_token || t.refresh_token };
    await s.setJSON(TOKENS, next);
    return next.access_token;
  });
}
async function gmail(s, path, opts = {}) {
  const token = await access(s);
  const r = await fetch(API + path, { ...opts, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(opts.headers || {}) } });
  if (r.status === 204) return {};
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("Gmail said no: " + ((b.error && b.error.message) || r.status)); e.status = r.status; throw e; }
  return b;
}
const header = (msg, name) => (((msg && msg.payload && msg.payload.headers) || []).find(h => h.name.toLowerCase() === name.toLowerCase()) || {}).value || "";
function b64(s) { return Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
function plainText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body && part.body.data) return b64(part.body.data);
  for (const p of (part.parts || [])) { const t = plainText(p); if (t) return t; }
  if (part.mimeType === "text/html" && part.body && part.body.data) return b64(part.body.data).replace(/<br\s*\/?>/gi, "\n").replace(/<\/p>/gi, "\n\n").replace(/<[^>]+>/g, "").replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");
  return "";
}
/* Gmail's "reply-to" setting only applies to mail typed in Gmail itself. Mail
   sent through the Gmail API ignores it, so a client's reply came back to the
   robots' mailbox. Before sending, the app writes the Reply-To line into the
   draft itself. A draft that already names its own Reply-To is left alone.
   REPLY_TO in Netlify changes the address; REPLY_TO=none turns this off. */
const replyTo = () => String(process.env.REPLY_TO || "estimating@amabatement.com").trim();
function toB64url(str) { return Buffer.from(str, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function fromB64url(str) { return Buffer.from(String(str || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8"); }
export function withReplyTo(raw, addr) {
  if (!addr || addr.toLowerCase() === "none") return null;
  const m = raw.match(/\r?\n\r?\n/);
  const head = m ? raw.slice(0, m.index) : raw;
  if (/^reply-to\s*:/im.test(head)) return null;
  const nl = raw.includes("\r\n") ? "\r\n" : "\n";
  return "Reply-To: " + addr + nl + raw;
}
async function setReplyTo(s, id) {
  const d = await gmail(s, `/drafts/${id}?format=raw`);
  if (!d.message || !d.message.raw) return;
  const next = withReplyTo(fromB64url(d.message.raw), replyTo());
  if (!next) return;
  const message = { raw: toB64url(next) };
  if (d.message.threadId) message.threadId = d.message.threadId;
  await gmail(s, `/drafts/${id}`, { method: "PUT", body: JSON.stringify({ id, message }) });
}

async function log(s, entry) {
  try {
    const d = (await s.get(LOG, { type: "json" })) || { entries: [] };
    d.entries.unshift({ at: new Date().toISOString(), ...entry });
    d.entries = d.entries.slice(0, 500);
    await s.setJSON(LOG, d);
  } catch (e) {}
}

export default async (req) => {
  const url = new URL(req.url);
  const s = store();
  let action = url.searchParams.get("action") || "status";
  let body = {};
  if (req.method === "POST") { try { body = await req.json(); } catch { return json({ error: "Body was not valid JSON." }, 400); } action = body.action || action; }

  /* The callback comes back from Google and cannot carry a sign-in. It is held
     to a one-time state that only a signed-in admin can have started. */
  if (action === "callback") {
    const saved = await s.get(STATE, { type: "json" });
    const state = url.searchParams.get("state");
    if (!saved || !state || saved.state !== state || Date.now() - saved.at > 600000) return new Response("That Google sign-in did not match the request that started it. Start again from the app.", { status: 400 });
    try { await s.delete(STATE); } catch (e) {}
    const t = await tokenCall({ grant_type: "authorization_code", code: url.searchParams.get("code") || "", redirect_uri: process.env.GOOGLE_REDIRECT_URI });
    const prof = await fetch(API + "/profile", { headers: { authorization: "Bearer " + t.access_token } }).then(r => r.json()).catch(() => ({}));
    if (String(prof.emailAddress || "").toLowerCase() !== mailbox()) {
      return new Response(`That was ${prof.emailAddress || "an unknown mailbox"}. The app only connects ${mailbox()}. Sign in as that account and try again.`, { status: 400 });
    }
    await s.setJSON(TOKENS, { refresh_token: t.refresh_token, access_token: t.access_token, expires_at: Date.now() + (t.expires_in || 3600) * 1000, email: prof.emailAddress, connectedBy: saved.by, connectedAt: new Date().toISOString() });
    return new Response(`<!doctype html><meta charset=utf-8><body style="font-family:Arial;padding:2rem"><h2>${mailbox()} connected</h2><p>Close this tab and go back to the A&amp;M app.</p>`, { status: 200, headers: { "content-type": "text/html" } });
  }

  const denied = await accountGate(req, s);
  if (denied) return denied;
  /* Reading the drafts needs the Assistants area; sending or throwing one away
     also needs an account that can make changes; connecting or disconnecting
     the mailbox is for an admin. */
  if (!sees(req.amUser, "assistants")) return json({ error: "role", message: "The assistants' emails are not in your section. Ask an admin if you need them." }, 403);
  if ((action === "send" || action === "discard") && !canEdit(req.amUser)) return json({ error: "role", message: "Your account can read these but not send them." }, 403);
  if ((action === "connect" || action === "disconnect") && !isAdmin(req.amUser)) return json({ error: "role", message: "Connecting the mailbox is for an admin." }, 403);

  try {
    if (action === "status") {
      const t = await s.get(TOKENS, { type: "json" });
      return json({ connected: !!(t && t.refresh_token), mailbox: mailbox(), connectedAt: t && t.connectedAt, missingEnv: missingEnv() });
    }
    if (action === "connect") {
      const miss = missingEnv(); if (miss.length) return json({ error: "setup", message: "Missing in Netlify: " + miss.join(", ") }, 400);
      const state = crypto.randomUUID();
      await s.setJSON(STATE, { state, at: Date.now(), by: req.amUser.name });
      const q = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: process.env.GOOGLE_REDIRECT_URI, response_type: "code", scope: SCOPE, access_type: "offline", prompt: "consent", state, login_hint: mailbox() });
      return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + q });
    }
    if (action === "disconnect") { await s.delete(TOKENS); await log(s, { action: "disconnect", by: req.amUser.name }); return json({ ok: true }); }
    if (action === "list") {
      const list = await gmail(s, "/drafts?maxResults=100");
      const ids = (list.drafts || []).map(d => d.id);
      const out = [];
      for (let i = 0; i < ids.length; i += 5) {           /* five at a time, kind to Gmail's limits */
        const got = await Promise.all(ids.slice(i, i + 5).map(id =>
          gmail(s, `/drafts/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=To&metadataHeaders=Cc&metadataHeaders=Date`).catch(() => null)));
        for (const d of got) if (d && d.message) out.push({
          id: d.id, messageId: d.message.id, threadId: d.message.threadId, subject: header(d.message, "Subject"),
          to: header(d.message, "To"), cc: header(d.message, "Cc"), date: d.message.internalDate ? new Date(Number(d.message.internalDate)).toISOString() : header(d.message, "Date"),
          snippet: d.message.snippet || ""
        });
      }
      return json({ mailbox: mailbox(), drafts: out });
    }
    if (action === "get") {
      const id = url.searchParams.get("id") || "";
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return json({ error: "bad_id" }, 400);
      const d = await gmail(s, `/drafts/${id}?format=full`);
      return json({ id: d.id, subject: header(d.message, "Subject"), to: header(d.message, "To"), cc: header(d.message, "Cc"), text: plainText(d.message && d.message.payload).slice(0, 20000) });
    }
    if (action === "send" || action === "discard") {
      const id = String(body.id || "");
      if (!/^[A-Za-z0-9_-]{1,80}$/.test(id)) return json({ error: "bad_id" }, 400);
      const meta = await gmail(s, `/drafts/${id}?format=metadata&metadataHeaders=Subject&metadataHeaders=To`).catch(() => null);
      if (action === "send") {
        await setReplyTo(s, id);
        await gmail(s, "/drafts/send", { method: "POST", body: JSON.stringify({ id }) });
      }
      else await gmail(s, `/drafts/${id}`, { method: "DELETE" });
      await log(s, { action, by: req.amUser.name, id, subject: meta ? header(meta.message, "Subject") : "", to: meta ? header(meta.message, "To") : "" });
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    if (e.code === "NOT_CONNECTED") return json({ error: "not_connected", message: e.message }, 409);
    return json({ error: "upstream", message: e.message }, 502);
  }
};

export const config = { path: "/api/mail" };
