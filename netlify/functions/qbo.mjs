/* A&M Abatement Services - QuickBooks Online connection for inventory.

   READ ONLY. This file issues GET requests to QuickBooks and nothing else.
   There is no POST, PUT, PATCH or DELETE to any Intuit endpoint anywhere in it,
   so this connection cannot alter A&M's books under any circumstance.

   That is a deliberate decision, not a limitation. JobTread already pushes
   vendor bills, expenses and time into the same QuickBooks file. If this app
   also posted cost for the same purchases, every one of them would be counted
   twice: job margin would read worse than it is, the profit and loss would be
   overstated on cost, and the bank would not reconcile because one payment
   would sit against two payables.

   One writer per transaction type. JobTread owns anything touching a vendor or
   a customer. This app reads, so it can tell you what an item last cost and who
   it was bought from, and it pushes consumption to JOBTREAD only, as an
   internal bill that is flagged never to reach QuickBooks.

   If A&M ever does want consumption posted straight to QuickBooks, the safe
   shape is a journal entry that moves cost out of a shop consumables clearing
   account and onto the job, so nothing is recognised twice. That account should
   trend to near zero every period. It is not built here on purpose. */

import { getStore } from "@netlify/blobs";

const STORE = "am-inventory";
const TOKEN_KEY = "qbo-tokens";
const STATE_KEY = "qbo-state";
const CACHE_KEY = "qbo-cache";

const AUTH_URL = "https://appcenter.intuit.com/connect/oauth2";
const TOKEN_URL = "https://oauth.platform.intuit.com/oauth2/v1/tokens/bearer";
const MINOR_VERSION = "75";

const store = () => getStore({ name: STORE, consistency: "strong" });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

function env() {
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

function missingEnv() {
  const e = env();
  const missing = [];
  if (!e.clientId) missing.push("QBO_CLIENT_ID");
  if (!e.clientSecret) missing.push("QBO_CLIENT_SECRET");
  if (!e.redirectUri) missing.push("QBO_REDIRECT_URI");
  return missing;
}

async function readTokens() { return (await store().get(TOKEN_KEY, { type: "json" })) || null; }
async function writeTokens(t) { await store().setJSON(TOKEN_KEY, t); }

async function exchange(params) {
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

// Access tokens last an hour. Refresh tokens last 100 days and Intuit rotates
// them, so whatever comes back has to be written down every single time.
async function accessToken() {
  const t = await readTokens();
  if (!t || !t.refresh_token) {
    const err = new Error("Not connected to QuickBooks yet.");
    err.code = "NOT_CONNECTED";
    throw err;
  }
  if (t.access_token && t.expires_at && Date.now() < t.expires_at - 120000) {
    return { token: t.access_token, realmId: t.realmId };
  }
  const fresh = await exchange({ grant_type: "refresh_token", refresh_token: t.refresh_token });
  const updated = {
    ...t,
    access_token: fresh.access_token,
    refresh_token: fresh.refresh_token || t.refresh_token,
    expires_at: Date.now() + (fresh.expires_in || 3600) * 1000,
    refreshed_at: new Date().toISOString()
  };
  await writeTokens(updated);
  return { token: updated.access_token, realmId: updated.realmId };
}

/* Intuit throttles at roughly 500 requests a minute per company, but the
   binding limit is 10 at once across everything hitting that company. Requests
   are issued one at a time, never fanned out. */
async function query(sql) {
  const { apiBase } = env();
  const { token, realmId } = await accessToken();
  const url = `${apiBase}/v3/company/${realmId}/query?query=${encodeURIComponent(sql)}&minorversion=${MINOR_VERSION}`;
  const r = await fetch(url, { headers: { authorization: `Bearer ${token}`, accept: "application/json" } });
  if (!r.ok) {
    const text = await r.text().catch(() => "");
    throw new Error(`QuickBooks would not answer that query (HTTP ${r.status}). ${text.slice(0, 300)}`);
  }
  return r.json();
}

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "status";
  const s = store();

  try {
    // ---------------------------------------------------------------- connect
    if (action === "connect") {
      const missing = missingEnv();
      if (missing.length) return json({ error: `Missing environment values: ${missing.join(", ")}` }, 400);
      const state = crypto.randomUUID();
      await s.setJSON(STATE_KEY, { state, at: Date.now() });
      const { clientId, redirectUri } = env();
      const qs = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        scope: "com.intuit.quickbooks.accounting",
        redirect_uri: redirectUri,
        state
      });
      return Response.redirect(`${AUTH_URL}?${qs}`, 302);
    }

    if (action === "callback") {
      const code = url.searchParams.get("code");
      const realmId = url.searchParams.get("realmId");
      const state = url.searchParams.get("state");
      const saved = await s.get(STATE_KEY, { type: "json" });
      if (!saved || saved.state !== state) {
        return new Response("That QuickBooks sign-in did not match the request that started it. Try connecting again.", { status: 400 });
      }
      const { redirectUri } = env();
      const t = await exchange({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      await writeTokens({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: Date.now() + (t.expires_in || 3600) * 1000,
        realmId,
        connected_at: new Date().toISOString()
      });
      return new Response(
        "<!doctype html><meta charset=utf-8><body style=\"font-family:Arial;padding:2rem\">" +
        "<h2>QuickBooks connected</h2><p>Read only. You can close this tab and go back to the inventory app.</p>",
        { status: 200, headers: { "content-type": "text/html" } }
      );
    }

    if (action === "disconnect") {
      await s.delete(TOKEN_KEY);
      return json({ ok: true });
    }

    // ----------------------------------------------------------------- status
    if (action === "status") {
      const t = await readTokens();
      return json({
        connected: !!(t && t.refresh_token),
        realmId: t?.realmId || null,
        connectedAt: t?.connected_at || null,
        missingEnv: missingEnv(),
        readOnly: true
      });
    }

    // -------------------------------------------------- reference data pulls
    if (action === "vendors") {
      const res = await query("select Id, DisplayName, Active from Vendor maxresults 200");
      const list = (res?.QueryResponse?.Vendor || []).map(v => ({ id: v.Id, name: v.DisplayName, active: v.Active !== false }));
      return json({ vendors: list });
    }

    if (action === "items") {
      const res = await query("select Id, Name, Type, UnitPrice, PurchaseCost from Item maxresults 500");
      const list = (res?.QueryResponse?.Item || []).map(i => ({
        id: i.Id, name: i.Name, type: i.Type, price: i.UnitPrice ?? null, cost: i.PurchaseCost ?? null
      }));
      return json({ items: list });
    }

    /* What each consumable last cost and who it came from. This is the master
       pricing list the replenish screen uses to pick a vendor, taken from what
       A&M actually paid rather than from a list somebody maintains by hand. */
    if (action === "prices") {
      const since = url.searchParams.get("since") || "2024-04-01";
      const res = await query(
        `select * from Purchase where TxnDate >= '${since}' maxresults 500`
      );
      const rows = [];
      for (const p of (res?.QueryResponse?.Purchase || [])) {
        for (const l of (p.Line || [])) {
          const d = l.ItemBasedExpenseLineDetail || l.AccountBasedExpenseLineDetail;
          if (!d) continue;
          rows.push({
            date: p.TxnDate,
            vendor: p.EntityRef?.name || "",
            item: d.ItemRef?.name || d.AccountRef?.name || "",
            qty: d.Qty ?? null,
            unitPrice: d.UnitPrice ?? null,
            amount: l.Amount ?? null
          });
        }
      }
      await s.setJSON(CACHE_KEY, { prices: rows, at: new Date().toISOString() });
      return json({ prices: rows, at: new Date().toISOString() });
    }

    if (action === "cached") {
      const c = await s.get(CACHE_KEY, { type: "json" });
      return json(c || { prices: [], at: null });
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    if (e.code === "NOT_CONNECTED") return json({ error: e.message, connected: false }, 400);
    return json({ error: e.message }, 502);
  }
};

export const config = { path: "/api/qbo" };
