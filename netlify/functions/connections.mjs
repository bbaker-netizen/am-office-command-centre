/* A&M - Admin, Connections: the one place to connect JobTread and QuickBooks.

   GET  /api/connections                          status of JobTread and QuickBooks
   POST /api/connections { action:"jobtread", grantKey }   test a JobTread key, save it only if it works
   POST /api/connections { action:"jobtread-forget" }
   POST /api/connections { action:"quickbooks" }           the Intuit sign-in address to go to
   POST /api/connections { action:"quickbooks-forget" }

   Admins only, signed in with their command centre account. Before this page
   both connections lived behind the shop's PIN screen, so an admin with no shop
   PIN had no way to reach them.

   The JobTread key is never sent back to the page, only whether one is saved.
   QuickBooks uses A&M's Intuit app (Workplaces Bookkeeping Agent) through the
   same one-time handshake as before; Intuit sends the person back to
   /api/qbo?action=callback, which finishes it and returns them here. */

import { getStore } from "@netlify/blobs";
import { accountGate, isAdmin } from "./_accounts.mjs";
import { qboStore, AUTH_URL, env, missingEnv, readTokens, TOKEN_KEY } from "./_qbo.mjs";

const STORE = "am-inventory";
const KEY_BLOB = "jobtread-key";
const STATE_KEY = "qbo-state";
const PAVE = "https://api.jobtread.com/pave";
const store = () => getStore({ name: STORE, consistency: "strong" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });

async function probe(grantKey) {
  const r = await fetch(PAVE, { method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ query: { $: { grantKey }, currentGrant: { id: {}, user: { name: {} }, organization: { id: {}, name: {} } } } }) });
  const body = await r.json().catch(() => ({}));
  const g = body && body.currentGrant;
  if (!r.ok || !g || !g.organization) throw new Error("JobTread did not accept that key. Copy it again from JobTread, Settings, API, and paste the whole thing.");
  return { organizationId: g.organization.id, organizationName: g.organization.name, grantUser: (g.user && g.user.name) || "" };
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  if (!isAdmin(req.amUser)) return json({ error: "role", message: "Connections are for an admin." }, 403);
  try {
    if (req.method === "GET") {
      const c = (await s.get(KEY_BLOB, { type: "json" })) || {};
      const t = await readTokens().catch(() => null);
      return json({
        jobtread: { connected: !!c.grantKey, organizationId: c.organizationId || "", organizationName: c.organizationName || "", grantUser: c.grantUser || "", savedAt: c.savedAt || null, savedBy: c.savedBy || "" },
        quickbooks: { connected: !!(t && t.refresh_token), realmId: (t && t.realmId) || null, connectedAt: (t && t.connected_at) || null, connectedBy: (t && t.connected_by) || "", missingEnv: missingEnv() }
      });
    }
    if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
    const body = await req.json().catch(() => ({}));

    if (body.action === "jobtread") {
      const key = String(body.grantKey || "").trim();
      if (key.length < 10) return json({ error: "bad", message: "Paste the whole JobTread key." }, 400);
      const p = await probe(key);
      const c = (await s.get(KEY_BLOB, { type: "json" })) || {};
      await s.setJSON(KEY_BLOB, { ...c, grantKey: key, organizationId: p.organizationId, organizationName: p.organizationName, grantUser: p.grantUser, savedAt: new Date().toISOString(), savedBy: req.amUser.name });
      try { await s.delete("cc-cache-jobs"); } catch (e) {}
      return json({ ok: true, ...p });
    }
    if (body.action === "jobtread-forget") {
      const c = (await s.get(KEY_BLOB, { type: "json" })) || {};
      delete c.grantKey; await s.setJSON(KEY_BLOB, c);
      return json({ ok: true });
    }
    if (body.action === "quickbooks") {
      const missing = missingEnv();
      if (missing.length) return json({ error: "setup", message: "Netlify still needs " + missing.join(", ") + "." }, 400);
      const state = crypto.randomUUID();
      await qboStore().setJSON(STATE_KEY, { state, at: Date.now(), by: req.amUser.name, back: "/command.html#connections" });
      const { clientId, redirectUri } = env();
      const qs = new URLSearchParams({ client_id: clientId, response_type: "code", scope: "com.intuit.quickbooks.accounting", redirect_uri: redirectUri, state });
      return json({ url: `${AUTH_URL}?${qs}` });
    }
    if (body.action === "quickbooks-forget") {
      await qboStore().delete(TOKEN_KEY);
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) {
    return json({ error: "upstream", message: e.message }, 502);
  }
};

export const config = { path: "/api/connections" };
