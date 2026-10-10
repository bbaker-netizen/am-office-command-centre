/* A&M - /api/drive: each person's own Google Drive connection (see _drive.mjs).

   GET  /api/drive                     is this person connected, and as whom
   GET  /api/drive?action=start        the Google sign-in address (read only)
   GET  /api/drive?action=callback     where Google sends the person back
   POST /api/drive { action:"forget" }
   POST /api/drive { action:"search", q }
   POST /api/drive { action:"job", number }   the job's folder (Job YY-NNNNN Client - Site) and what is in it */

import { accountGate } from "./_accounts.mjs";
import { store, driveReady, SCOPES, makeState, readState, saveToken, tokenInfo, forget, accessToken, search, jobFolder } from "./_drive.mjs";

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const redirectUri = req => process.env.GOOGLE_DRIVE_REDIRECT_URI || new URL(req.url).origin + "/api/drive?action=callback";

export default async (req) => {
  const s = store(), url = new URL(req.url), action = url.searchParams.get("action") || "";
  if (action === "callback") {
    const back = msg => Response.redirect(new URL("/command.html?drive=" + encodeURIComponent(msg), url.origin).toString(), 302);
    const st = await readState(url.searchParams.get("state"));
    if (!st) return back("expired");
    if (url.searchParams.get("error")) return back("cancelled");
    const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code: url.searchParams.get("code") || "", client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, redirect_uri: redirectUri(req), grant_type: "authorization_code" }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok || !b.refresh_token) return back("failed");
    let email = ""; try { email = JSON.parse(atob(b.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email || ""; } catch (e) {}
    await saveToken(s, st.uid, b.refresh_token, email);
    return back("connected");
  }
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  try {
    if (req.method === "GET" && !action) { const t = await tokenInfo(s, u.id); return json({ ready: driveReady(), connected: !!t, email: t ? t.email : "", since: t ? t.at : "" }); }
    if (req.method === "GET" && action === "start") {
      if (!driveReady()) return json({ error: "setup", message: "Drive needs GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET in Netlify, the same ones the robots' mailbox uses." }, 409);
      const p = new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: redirectUri(req), response_type: "code", scope: SCOPES, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state: await makeState(u.id), login_hint: u.email || "" });
      return json({ url: "https://accounts.google.com/o/oauth2/v2/auth?" + p.toString() });
    }
    if (req.method !== "POST") return json({ error: "Use POST." }, 405);
    const body = await req.json().catch(() => ({}));
    if (body.action === "forget") { await forget(s, u.id); return json({ ok: true }); }
    const tok = await accessToken(s, u.id);
    if (!tok) return json({ error: "not_connected", message: "Connect Google Drive under My account first." }, 409);
    if (body.action === "search") return json({ files: await search(tok, body.q, 15) });
    if (body.action === "job") return json(await jobFolder(tok, body.number) || { folder: null, files: [] });
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: "upstream", message: e.message }, 502); }
};

export const config = { path: "/api/drive" };
