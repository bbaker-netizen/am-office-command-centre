/* A&M - Google Drive, read as each person (2026-10-10).

   Each person connects their own Google account once, read only. Every search
   and every file the app or Claude opens is then read as that person, so
   Google's own sharing decides what they see: no access in Drive, no access
   here. There is no company-wide key that can see everything.

   Uses the Google Cloud project the robots' mailbox already uses (Internal to
   amabatement.com, so only A&M Google accounts can connect, and Drive's
   read-only permission needs no Google review). Netlify needs the same
   GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET as the mailbox, and in Google
   Cloud the Drive API switched on and this address added as an authorized
   redirect: https://<the app's address>/api/drive?action=callback

   Each person's Google refresh token is kept encrypted with AUTH_SECRET in
   Netlify Blobs. Disconnect removes it and tells Google to cancel it; a
   switched-off account cannot reach it because every call checks the account. */

import { getStore } from "@netlify/blobs";

export const store = () => getStore({ name: "am-inventory", consistency: "strong" });
const KEY = "drive-tokens";
export const SCOPES = "openid email https://www.googleapis.com/auth/drive.readonly";
export const driveReady = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET && process.env.AUTH_SECRET);

const enc = new TextEncoder(), dec = new TextDecoder();
const b64 = u8 => btoa(String.fromCharCode(...u8)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unb64 = s => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), c => c.charCodeAt(0));
async function aesKey() {
  const raw = await crypto.subtle.digest("SHA-256", enc.encode("am-drive|" + process.env.AUTH_SECRET));
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, ["encrypt", "decrypt"]);
}
async function seal(text) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await aesKey(), enc.encode(text)));
  return b64(iv) + "." + b64(ct);
}
async function open(sealed) {
  const [iv, ct] = String(sealed).split(".");
  return dec.decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv: unb64(iv) }, await aesKey(), unb64(ct)));
}
async function hmac(text) {
  const k = await crypto.subtle.importKey("raw", enc.encode("am-drive-state|" + process.env.AUTH_SECRET), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64(new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(text))));
}
export async function makeState(uid) { const p = b64(enc.encode(JSON.stringify({ uid, t: Date.now() }))); return p + "." + await hmac(p); }
export async function readState(state) {
  const [p, sig] = String(state || "").split(".");
  if (!p || !sig || sig !== await hmac(p)) return null;
  const o = JSON.parse(dec.decode(unb64(p)));
  return Date.now() - o.t < 15 * 60000 ? o : null;
}

export async function saveToken(s, uid, refresh, email) {
  const d = (await s.get(KEY, { type: "json" })) || {};
  d[uid] = { r: await seal(refresh), email, at: new Date().toISOString() };
  await s.setJSON(KEY, d);
}
export async function tokenInfo(s, uid) { const d = (await s.get(KEY, { type: "json" })) || {}; return d[uid] || null; }
export async function forget(s, uid) {
  const d = (await s.get(KEY, { type: "json" })) || {};
  const t = d[uid]; delete d[uid]; await s.setJSON(KEY, d);
  if (t) { try { await fetch("https://oauth2.googleapis.com/revoke?token=" + encodeURIComponent(await open(t.r)), { method: "POST" }); } catch (e) {} }
}

const cache = new Map();
export async function accessToken(s, uid) {
  const hit = cache.get(uid); if (hit && hit.exp > Date.now() + 60000) return hit.tok;
  const t = await tokenInfo(s, uid); if (!t) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, refresh_token: await open(t.r), grant_type: "refresh_token" }) });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) { if (b.error === "invalid_grant") await forget(s, uid); throw new Error("Google did not accept your Drive connection any more. Connect Google Drive again under My account."); }
  cache.set(uid, { tok: b.access_token, exp: Date.now() + (b.expires_in || 3000) * 1000 });
  return b.access_token;
}

const FIELDS = "files(id,name,mimeType,modifiedTime,webViewLink,size),nextPageToken";
async function gget(tok, url) {
  const r = await fetch(url, { headers: { authorization: "Bearer " + tok } });
  if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error("Google Drive said: " + ((b.error && b.error.message) || "HTTP " + r.status)); }
  return r;
}
const qesc = s => String(s).replace(/\\/g, "\\\\").replace(/'/g, "\\'");
const LIST = "https://www.googleapis.com/drive/v3/files?supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives&pageSize=";
const tidy = f => ({ id: f.id, name: f.name, type: kind(f.mimeType), link: f.webViewLink, modified: f.modifiedTime });
function kind(m) { return /folder/.test(m) ? "folder" : /document/.test(m) ? "Google Doc" : /spreadsheet/.test(m) ? "Google Sheet" : /presentation/.test(m) ? "Google Slides" : /pdf/.test(m) ? "PDF" : /word/.test(m) ? "Word" : /sheet|excel/.test(m) ? "Excel" : /image/.test(m) ? "image" : "file"; }

export async function search(tok, text, n) {
  const words = String(text || "").trim().slice(0, 120);
  if (!words) return [];
  const q = `(name contains '${qesc(words)}' or fullText contains '${qesc(words)}') and trashed = false`;
  const r = await gget(tok, LIST + (n || 10) + "&orderBy=" + encodeURIComponent("modifiedTime desc") + "&fields=" + encodeURIComponent(FIELDS) + "&q=" + encodeURIComponent(q));
  return ((await r.json()).files || []).map(tidy);
}
export async function jobFolder(tok, number) {
  const num = String(number || "").replace(/[^0-9A-Za-z-]/g, "").slice(0, 20); if (!num) return null;
  const q = `mimeType = 'application/vnd.google-apps.folder' and name contains 'Job ${qesc(num)}' and trashed = false`;
  const r = await gget(tok, LIST + "5&fields=" + encodeURIComponent(FIELDS) + "&q=" + encodeURIComponent(q));
  const f = ((await r.json()).files || [])[0]; if (!f) return { folder: null, files: [] };
  const r2 = await gget(tok, LIST + "40&orderBy=" + encodeURIComponent("folder,modifiedTime desc") + "&fields=" + encodeURIComponent(FIELDS) + "&q=" + encodeURIComponent(`'${f.id}' in parents and trashed = false`));
  return { folder: tidy(f), files: ((await r2.json()).files || []).map(tidy) };
}
/* The words of a file, for Claude: Google Docs, Sheets and Slides, and plain
   text. Word files and PDFs are named with a link instead. */
export async function readText(tok, id) {
  if (!/^[A-Za-z0-9_-]{10,80}$/.test(String(id))) throw new Error("That is not a Drive file id.");
  const m = await (await gget(tok, "https://www.googleapis.com/drive/v3/files/" + id + "?supportsAllDrives=true&fields=id,name,mimeType,webViewLink")).json();
  const ex = { "application/vnd.google-apps.document": "text/plain", "application/vnd.google-apps.spreadsheet": "text/csv", "application/vnd.google-apps.presentation": "text/plain" }[m.mimeType];
  let text = "";
  if (ex) text = await (await gget(tok, "https://www.googleapis.com/drive/v3/files/" + id + "/export?mimeType=" + encodeURIComponent(ex))).text();
  else if (/^text\//.test(m.mimeType)) text = await (await gget(tok, "https://www.googleapis.com/drive/v3/files/" + id + "?alt=media&supportsAllDrives=true")).text();
  else return { name: m.name, link: m.webViewLink, type: kind(m.mimeType), text: "", note: "This is a " + kind(m.mimeType) + "; open it from the link. Only Google Docs, Sheets, Slides and text files can be read here." };
  return { name: m.name, link: m.webViewLink, type: kind(m.mimeType), text: text.slice(0, 24000), cut: text.length > 24000 };
}
