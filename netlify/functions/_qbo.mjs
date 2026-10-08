/* A&M - the one QuickBooks connection, shared by every function.

   Moved out of qbo.mjs so the command centre can read reports through the same
   connection the office set up, instead of a second app holding a second set of
   keys. Read only: every call to Intuit here is a GET, apart from the token
   exchange itself.

   Intuit rotates the refresh token every time it is used, and an old one stops
   working. Two copies of a function refreshing at the same moment would leave
   one of them holding a dead token, so the refresh takes a lock. */

import { getStore } from "@netlify/blobs";
import { withLock } from "./_lock.mjs";

export const STORE = "am-inventory";
export const TOKEN_KEY = "qbo-tokens";
export const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
export const MINOR_VERSION = "75";

export const qboStore = () => getStore({ name: STORE, consistency: "strong" });

export function env() {
  const environment = (process.env.QBO_ENVIRONMENT || "production").toLowerCase();
  return {
    clientId: process.env.QBO_CLIENT_ID,
    clientSecret: process.env.QBO_CLIENT_SECRET,
    redirectUri: process.env.QBO_REDIRECT_URI,
    apiBase: environment === "sandbox"
      ? "https://sandbox-quickbooks.api.intuit.com"
      : "https://quickbooks.api.intuit.com"
  };
}

export function missingEnv() {
  const e = env();
  const missing = [];
  if (!e.clientId) missing.push("QBO_CLIENT_ID");
  if (!e.clientSecret) missing.push("QBO_CLIENT_SECRET");
  if (!e.redirectUri) missing.push("QBO_REDIRECT_URI");
  return missing;
}

export async function readTokens() { return (await qboStore().get(TOKEN_KEY, { type: "json" })) || null; }
export async function writeTokens(t) { await qboStore().setJSON(TOKEN_KEY, t); }

export async function exchange(params) {
  const { clientId, clientSecret } = env();
  const basic = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");
  const r = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      authorization: `Basic ${basic}`,
      "content-type": "application/x-www-form-urlencoded",
      accept: "application/json"
    },
    body: new URLSearchParams(params).toString()
  });
  const body = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`QuickBooks refused the token request: ${body.error_description || body.error || "HTTP " + r.status}`);
  return body;
}

const fresh = t => t && t.access_token && t.expires_at && Date.now() < t.expires_at - 120000;

export async function accessToken() {
  let t = await readTokens();
  if (!t || !t.refresh_token) {
    const err = new Error("Not connected to QuickBooks yet. The office connects it in Settings.");
    err.code = "NOT_CONNECTED";
    throw err;
  }
  if (fresh(t)) return { token: t.access_token, realmId: t.realmId };
  return withLock(qboStore(), "qbo-refresh", async () => {
    t = await readTokens();                      /* somebody may have refreshed while we waited */
    if (fresh(t)) return { token: t.access_token, realmId: t.realmId };
    const f = await exchange({ grant_type: "refresh_token", refresh_token: t.refresh_token });
    const updated = {
      ...t,
      access_token: f.access_token,
      refresh_token: f.refresh_token || t.refresh_token,
      expires_at: Date.now() + (f.expires_in || 3600) * 1000,
      refreshed_at: new Date().toISOString()
    };
    await writeTokens(updated);
    return { token: updated.access_token, realmId: updated.realmId };
  });
}

/* One GET against the company. `path` is everything after /v3/company/{realm}/ */
export async function qboGet(path, params = {}) {
  const { apiBase } = env();
  const { token, realmId } = await accessToken();
  const qs = new URLSearchParams({ ...params, minorversion: MINOR_VERSION });
  const r = await fetch(`${apiBase}/v3/company/${realmId}/${path}?${qs}`, {
    headers: { authorization: `Bearer ${token}`, accept: "application/json" }
  });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`QuickBooks would not answer (HTTP ${r.status}). ${text.slice(0, 300)}`);
  }
  return r.json();
}

export async function query(sql) {
  return qboGet("query", { query: sql });
}
