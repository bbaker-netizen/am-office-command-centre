/* A&M - a person's own inboxes, for their assistant.

   Each person connects their own work inbox (craig@amabatement.com,
   amir@amabatement.com), and can add more than one. Google sign-in, with two
   permissions only: read mail (gmail.readonly) and write drafts
   (gmail.compose). The app never sends from a person's inbox: drafts wait in
   their Gmail for them to send.

   Tokens are kept in the app's store under "inbox-<account id>", never sent
   to a phone. Uses the same Google app as the robots' mailbox
   (GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET). The sign-in comes back to
   /api/inbox?action=callback, which has to be listed as a redirect address
   on that Google app. INBOX_DOMAINS (default amabatement.com) limits which
   addresses can be connected; INBOX_EXTRA can name single addresses outside
   it. Craig and Amir, and only they, can also add a personal Gmail (see
   allowedAddress). */

import { withLock } from "./_lock.mjs";

/* gmail.compose covers drafts AND sending a draft the person approved.
   calendar.events (2026-11-17) lets the assistant show today's meetings and
   answer an invite when the person presses Accept or Decline. An inbox
   connected before that date has no calendar permission until it is
   connected again; hasCalendar says which. */
export const CAL_SCOPE = "https://www.googleapis.com/auth/calendar.events";
export const SCOPES = ["openid", "email", "https://www.googleapis.com/auth/gmail.readonly", "https://www.googleapis.com/auth/gmail.compose", CAL_SCOPE];
export const hasCalendar = inbox => !!inbox && String(inbox.scope || "").split(/\s+/).includes(CAL_SCOPE);
const API = "https://gmail.googleapis.com/gmail/v1/users/me";
export const KEY = id => "inbox-" + id;

/* Which addresses a person may connect.
   - A&M work inboxes (INBOX_DOMAINS): anyone, for their own assistant.
   - Single named addresses outside it (INBOX_EXTRA): anyone.
   - A personal Gmail (INBOX_PERSONAL_DOMAINS, default gmail.com): only the
     accounts named in INBOX_PERSONAL_USERS, by their command centre sign-in
     address. Default: Craig and Amir, nobody else (Bruce, 2026-11-17).
   - Never the robots' mailbox.
   `account` is the signed-in person's account (their email is what counts). */
const listOf = (v, d) => String(v === undefined || v === "" ? d : v).split(",").map(x => x.trim().toLowerCase()).filter(Boolean);
export function personalAllowed(account) {
  const who = listOf(process.env.INBOX_PERSONAL_USERS, "craig@amabatement.com,amir@amabatement.com");
  return !!account && account.active !== false && who.includes(String(account.email || "").trim().toLowerCase());
}
export function allowedAddress(email, account) {
  const e = String(email || "").toLowerCase().trim();
  if (!/^[^\s@]+@[^\s@]+$/.test(e)) return false;
  const domains = listOf(process.env.INBOX_DOMAINS, "amabatement.com");
  const extra = listOf(process.env.INBOX_EXTRA, "");
  const personal = listOf(process.env.INBOX_PERSONAL_DOMAINS, "gmail.com");
  const robots = (process.env.MAILBOX || "automation@amabatement.com").toLowerCase();
  if (e === robots) return false;
  if (extra.includes(e) || domains.some(d => e.endsWith("@" + d))) return true;
  return personal.some(d => e.endsWith("@" + d)) && personalAllowed(account);
}

export async function readInboxes(s, userId) { return ((await s.get(KEY(userId), { type: "json" })) || { inboxes: [] }).inboxes || []; }
export async function writeInboxes(s, userId, list) { await s.setJSON(KEY(userId), { inboxes: list }); }

async function refresh(t) {
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, grant_type: "refresh_token", refresh_token: t.refresh_token }).toString() });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error("Google refused " + t.email + ": " + (b.error_description || b.error || r.status) + ". Connect it again under My day."); e.code = "INBOX_EXPIRED"; throw e; }
  return { ...t, access_token: b.access_token, expires_at: Date.now() + (b.expires_in || 3600) * 1000 };
}

/* A working access token for one of a person's inboxes. */
export async function tokenFor(s, userId, email) {
  return withLock(s, "inbox-" + userId, async () => {
    const list = await readInboxes(s, userId);
    const i = list.findIndex(x => x.email === email);
    if (i < 0) throw new Error(email + " is not connected.");
    let t = list[i];
    if (!(t.access_token && Date.now() < (t.expires_at || 0) - 120000)) { t = await refresh(t); list[i] = t; await writeInboxes(s, userId, list); }
    return t.access_token;
  });
}

export async function gmail(token, path, opts = {}) {
  const r = await fetch(API + path, { ...opts, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(opts.headers || {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Gmail said no: " + ((b.error && b.error.message) || r.status));
  return b;
}

const header = (m, name) => { const h = ((m.payload && m.payload.headers) || []).find(x => x.name.toLowerCase() === name.toLowerCase()); return h ? h.value : ""; };
const b64 = s => Buffer.from(String(s || "").replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
function plainText(part) {
  if (!part) return "";
  if (part.mimeType === "text/plain" && part.body && part.body.data) return b64(part.body.data);
  for (const p of part.parts || []) { const t = plainText(p); if (t) return t; }
  if (part.mimeType === "text/html" && part.body && part.body.data) return b64(part.body.data).replace(/<style[\s\S]*?<\/style>/gi, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
  return "";
}

/* New inbox mail: sender, subject, a short body. Promotions and social are
   skipped. Looks back three days and past what has been sorted already, so a
   busy inbox is caught up over a few passes, newest first, and nothing is
   left behind because it arrived between two sorts. */
export async function recentMail(token, { afterSec, max = 15, skip = [], days = 3 } = {}) {
  const q = "in:inbox -category:promotions -category:social" + (afterSec ? " after:" + afterSec : " newer_than:" + days + "d");
  const seen = new Set(skip), ids = [];
  let pageToken = "";
  for (let page = 0; page < 3 && ids.length < max; page++) {
    const list = await gmail(token, "/messages?maxResults=100&q=" + encodeURIComponent(q) + (pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""));
    for (const m of list.messages || []) if (!seen.has(m.id) && ids.length < max) ids.push(m.id);
    pageToken = list.nextPageToken || "";
    if (!pageToken) break;
  }
  const out = [];
  for (const id of ids) {
    const m = await gmail(token, "/messages/" + id + "?format=full");
    out.push({ id: m.id, threadId: m.threadId, from: header(m, "From"), to: header(m, "To"), cc: header(m, "Cc"), subject: header(m, "Subject"), date: header(m, "Date"),
      messageId: header(m, "Message-ID") || header(m, "Message-Id"), snippet: m.snippet || "", body: plainText(m.payload).slice(0, 2500), unread: (m.labelIds || []).includes("UNREAD") });
  }
  return out;
}

/* One message in full, for drafting a reply. */
export async function getMessage(token, id) {
  const m = await gmail(token, "/messages/" + encodeURIComponent(id) + "?format=full");
  return { id: m.id, threadId: m.threadId, from: header(m, "From"), subject: header(m, "Subject"), messageId: header(m, "Message-ID") || header(m, "Message-Id"), snippet: m.snippet || "", body: plainText(m.payload).slice(0, 4000) };
}

/* Has anyone at this address written since a date? (for the chase) */
export async function heardFrom(token, address, sinceDate) {
  const q = "from:" + address + " after:" + sinceDate.replace(/-/g, "/");
  const list = await gmail(token, "/messages?maxResults=1&q=" + encodeURIComponent(q));
  return (list.messages || []).length > 0;
}

export function rawMessage({ to, cc, subject, body, inReplyTo, replyTo }) {
  const enc = v => /[^\x20-\x7e]/.test(v) ? "=?UTF-8?B?" + Buffer.from(v, "utf8").toString("base64") + "?=" : v;
  const lines = ["To: " + to, ...(cc ? ["Cc: " + cc] : []), ...(replyTo ? ["Reply-To: " + replyTo] : []), "Subject: " + enc(subject), ...(inReplyTo ? ["In-Reply-To: " + inReplyTo, "References: " + inReplyTo] : []),
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")];
  return Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/* A draft in the person's own Gmail, as a reply in the thread when there is one. */
export async function makeDraft(token, { to, cc, subject, body, threadId, inReplyTo, replyTo }) {
  const enc = v => /[^\x20-\x7e]/.test(v) ? "=?UTF-8?B?" + Buffer.from(v, "utf8").toString("base64") + "?=" : v;
  const lines = ["To: " + to, ...(cc ? ["Cc: " + cc] : []), ...(replyTo ? ["Reply-To: " + replyTo] : []), "Subject: " + enc(subject), ...(inReplyTo ? ["In-Reply-To: " + inReplyTo, "References: " + inReplyTo] : []),
    "MIME-Version: 1.0", "Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "", Buffer.from(body, "utf8").toString("base64")];
  const raw = Buffer.from(lines.join("\r\n"), "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const d = await gmail(token, "/drafts", { method: "POST", body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
  return { draftId: d.id, link: "https://mail.google.com/mail/u/0/#drafts" };
}

/* ------------------------------------------------------------ the thread
   What has happened in the conversation since this email: has the person
   already answered, and has someone else at A&M answered. This is what stops
   "needs you" being raised on mail that is already dealt with. */
export async function threadInfo(token, threadId, messageId, mine, companyDomains) {
  const t = await gmail(token, "/threads/" + encodeURIComponent(threadId) + "?format=metadata&metadataHeaders=From&metadataHeaders=Date");
  return readThread(t, messageId, mine, companyDomains);
}
export function readThread(t, messageId, mine, companyDomains) {
  const msgs = (t && t.messages) || [];
  const me = new Set((mine || []).map(x => String(x).toLowerCase()));
  const doms = (companyDomains || []).map(x => String(x).toLowerCase());
  const i = msgs.findIndex(m => m.id === messageId);
  const later = i < 0 ? [] : msgs.slice(i + 1);
  const who = m => addressOf(header(m, "From"));
  const isMe = m => (m.labelIds || []).includes("SENT") || me.has(who(m));
  const othersAfter = [...new Set(later.filter(m => !isMe(m) && doms.some(d => who(m).endsWith("@" + d))).map(m => (header(m, "From").split("<")[0] || who(m)).replace(/"/g, "").trim()))];
  return { count: msgs.length, repliedAfter: later.some(isMe), othersAfter, newerFromSender: later.some(m => !isMe(m) && who(m) === (i >= 0 ? who(msgs[i]) : "")) };
}

/* The person's own recent sent mail, so drafts sound like them. */
export async function sentSamples(token, n = 5) {
  const list = await gmail(token, "/messages?maxResults=" + (n * 3) + "&q=" + encodeURIComponent("in:sent newer_than:45d -in:chats"));
  const out = [];
  for (const m of (list.messages || [])) {
    if (out.length >= n) break;
    const f = await gmail(token, "/messages/" + m.id + "?format=full");
    const body = plainText(f.payload).split(/\nOn .{10,80} wrote:|\n-{2,} ?Forwarded message|\nFrom: .+\nSent: /)[0].replace(/\s+\n/g, "\n").trim();
    if (body.length > 40 && body.length < 1500) out.push(body.slice(0, 700));
  }
  return out;
}

/* Change a draft the person edited, then send it. Sending happens only when
   they press Approve and send; nothing in the app sends on a timer. */
export async function updateDraft(token, draftId, { to, cc, subject, body, threadId, inReplyTo }) {
  const raw = rawMessage({ to, cc, subject, body, inReplyTo });
  await gmail(token, "/drafts/" + encodeURIComponent(draftId), { method: "PUT", body: JSON.stringify({ message: { raw, ...(threadId ? { threadId } : {}) } }) });
}
export async function sendDraft(token, draftId) {
  const r = await gmail(token, "/drafts/send", { method: "POST", body: JSON.stringify({ id: draftId }) });
  return { id: r.id, threadId: r.threadId };
}
export async function sendNow(token, { to, cc, subject, body }) {
  const r = await gmail(token, "/messages/send", { method: "POST", body: JSON.stringify({ raw: rawMessage({ to, cc, subject, body }) }) });
  return { id: r.id, threadId: r.threadId };
}

/* ------------------------------------------------------------ the calendar */
const CAL = "https://www.googleapis.com/calendar/v3/calendars/primary/events";
async function cal(token, path, opts = {}) {
  const r = await fetch(CAL + path, { ...opts, headers: { authorization: "Bearer " + token, "content-type": "application/json", ...(opts.headers || {}) } });
  const b = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error("Google Calendar said no: " + ((b.error && b.error.message) || r.status));
  return b;
}
export function readEvent(e) {
  const self = (e.attendees || []).find(a => a.self);
  return { id: e.id, title: e.summary || "(no title)", start: (e.start && (e.start.dateTime || e.start.date)) || "", end: (e.end && (e.end.dateTime || e.end.date)) || "", allDay: !!(e.start && e.start.date && !e.start.dateTime),
    where: e.location || "", organizer: (e.organizer && (e.organizer.displayName || e.organizer.email)) || "", mine: !!(e.organizer && e.organizer.self), status: self ? self.responseStatus : (e.organizer && e.organizer.self ? "accepted" : ""),
    people: (e.attendees || []).length, link: e.htmlLink || "", meet: e.hangoutLink || "" };
}
/* Events between two moments, in order, with any that overlap marked. */
export async function calEvents(token, fromIso, toIso) {
  const q = new URLSearchParams({ timeMin: fromIso, timeMax: toIso, singleEvents: "true", orderBy: "startTime", maxResults: "50" });
  const list = ((await cal(token, "?" + q)).items || []).filter(e => e.status !== "cancelled").map(readEvent).filter(e => e.status !== "declined");
  return markClashes(list);
}
export function markClashes(list) {
  const timed = list.filter(e => !e.allDay);
  for (const a of timed) a.clash = timed.some(b => b !== a && b.start < a.end && a.start < b.end);
  return list;
}
/* Accept, decline or maybe: only the person's own answer changes. */
export async function calRespond(token, eventId, status) {
  const e = await cal(token, "/" + encodeURIComponent(eventId));
  const attendees = (e.attendees || []).map(a => a.self ? { ...a, responseStatus: status } : a);
  if (!attendees.some(a => a.self)) throw new Error("You are not on the guest list for that meeting.");
  await cal(token, "/" + encodeURIComponent(eventId) + "?sendUpdates=all", { method: "PATCH", body: JSON.stringify({ attendees }) });
  return { ok: true };
}

export const addressOf = from => { const m = String(from || "").match(/<([^>]+)>/); return (m ? m[1] : String(from || "")).trim().toLowerCase(); };
