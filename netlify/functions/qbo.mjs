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

import { authGate, requireOffice } from "./_auth.mjs";
import { qboStore, TOKEN_KEY, AUTH_URL, env, missingEnv, readTokens, writeTokens, exchange, query } from "./_qbo.mjs";

const STATE_KEY = "qbo-state";
const CACHE_KEY = "qbo-cache";

const store = qboStore;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

export default async (req) => {
  const url = new URL(req.url);
  const action = url.searchParams.get("action") || "status";
  /* Everything except the two halves of the QuickBooks handshake. Those are
     browser redirects that leave the app and come back from Intuit, so they
     cannot carry a header, and refusing them would break connecting rather than
     protect anything: neither one hands out data, and the callback is useless
     without the one-time code Intuit puts on it. */
  /* Connecting is now office only. Before 2026-10 anybody on the internet
     could start a connection, sign in to their own QuickBooks company, and the
     app would quietly start reading theirs instead of A&M's. The office screen
     asks for the Intuit address with its sign-in attached, then goes there.
     The callback cannot carry a sign-in, so it is held to a one-time state that
     only a signed-in office person can have started, and that runs out. */
  if (action !== "callback") {
    const denied = await authGate(req);
    if (denied) return denied;
  }
  if (action === "connect" || action === "disconnect") {
    const notOffice = requireOffice(req);
    if (notOffice) return notOffice;
  }
  const s = store();

  try {
    // ---------------------------------------------------------------- connect
    if (action === "connect") {
      const missing = missingEnv();
      if (missing.length) return json({ error: `Missing environment values: ${missing.join(", ")}` }, 400);
      const state = crypto.randomUUID();
      await s.setJSON(STATE_KEY, { state, at: Date.now(), by: req.amUser ? req.amUser.name : "" });
      const { clientId, redirectUri } = env();
      const qs = new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        scope: "com.intuit.quickbooks.accounting",
        redirect_uri: redirectUri,
        state
      });
      if (url.searchParams.get("mode") === "url") return json({ url: `${AUTH_URL}?${qs}` });
      return Response.redirect(`${AUTH_URL}?${qs}`, 302);
    }

    if (action === "callback") {
      const code = url.searchParams.get("code");
      const realmId = url.searchParams.get("realmId");
      const state = url.searchParams.get("state");
      const saved = await s.get(STATE_KEY, { type: "json" });
      /* Used once, and good for ten minutes. */
      if (!saved || !state || saved.state !== state || Date.now() - Number(saved.at || 0) > 600000) {
        return new Response("That QuickBooks sign-in did not match the request that started it. Try connecting again.", { status: 400 });
      }
      try { await s.delete(STATE_KEY); } catch (e) {}
      const { redirectUri } = env();
      const t = await exchange({ grant_type: "authorization_code", code, redirect_uri: redirectUri });
      await writeTokens({
        access_token: t.access_token,
        refresh_token: t.refresh_token,
        expires_at: Date.now() + (t.expires_in || 3600) * 1000,
        realmId,
        connected_at: new Date().toISOString(),
        connected_by: saved.by || ""
      });
      /* Started from Admin, Connections: straight back there. */
      if (saved.back === "/command.html#connections") return Response.redirect(url.origin + "/command.html?qbo=connected#connections", 302);
      return new Response(
        "<!doctype html><meta charset=utf-8><body style=\"font-family:Arial;padding:2rem\">" +
        "<h2>QuickBooks connected</h2><p>You can close this tab and go back to the A&amp;M app.</p>",
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
      const res = await query("select Id, DisplayName, Active from Vendor maxresults 1000");
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
      const sinceRaw = url.searchParams.get("since") || "2024-04-01";
      const since = /^\d{4}-\d{2}-\d{2}$/.test(sinceRaw) ? sinceRaw : "2024-04-01";
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
