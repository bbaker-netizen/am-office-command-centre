/* A&M - signing a person's own Claude in to the command centre (Craig,
   2026-11-20). Pure rules, so they can be tested. The endpoints are in mcp.mjs.

   How Claude connects (claude.com/docs/connectors/building/authentication):
   - The MCP address answers 401 with a WWW-Authenticate header pointing at
     the protected resource metadata, which names this site as the
     authorization server.
   - Claude registers itself (dynamic client registration, RFC 7591) as a
     public client, then sends the person to /oauth/authorize with PKCE S256.
   - The person signs in with their own command centre email and password,
     and only if an admin has ticked "Can ask Claude" for them.
   - Claude swaps the code for an access token (one hour) and a refresh token
     (rotated every use). Refreshing needs the account to still be active,
     still allowed, and on the same password.
   - Only Claude's own callback addresses are accepted: claude.ai and
     claude.com for the apps, and a loopback address for Claude Code. */

export const ACCESS_SECONDS = 3600;
export const CODE_MS = 5 * 60000;
export const SCOPE = "command";

export function siteUrl(env = process.env) {
  return String(env.URL || "https://am-office-command-centre.netlify.app").replace(/\/+$/, "");
}
export const resourceUrl = env => siteUrl(env) + "/mcp";

export function protectedResource(env) {
  return { resource: resourceUrl(env), authorization_servers: [siteUrl(env)], scopes_supported: [SCOPE], bearer_methods_supported: ["header"], resource_name: "A&M Office Command Centre" };
}
export function authServer(env) {
  const b = siteUrl(env);
  return {
    issuer: b, authorization_endpoint: b + "/oauth/authorize", token_endpoint: b + "/oauth/token", registration_endpoint: b + "/oauth/register",
    revocation_endpoint: b + "/oauth/revoke",
    response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"], token_endpoint_auth_methods_supported: ["none"], scopes_supported: [SCOPE]
  };
}
export const wwwAuthenticate = env => `Bearer resource_metadata="${siteUrl(env)}/.well-known/oauth-protected-resource/mcp", scope="${SCOPE}"`;

/* Claude's callback addresses, and nothing else. */
export function redirectAllowed(uri) {
  let u; try { u = new URL(String(uri || "")); } catch (e) { return false; }
  if (u.hash || u.username || u.password) return false;
  if (u.protocol === "https:" && ["claude.ai", "claude.com"].includes(u.hostname) && u.pathname === "/api/mcp/auth_callback" && !u.port) return true;
  if (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname) && u.pathname === "/callback") return true;
  return false;
}
/* A registered address matches the one asked for. Loopback ports may differ. */
export function redirectMatches(registered, asked) {
  if (!redirectAllowed(asked)) return false;
  const a = new URL(asked);
  return (registered || []).some(r => {
    if (r === asked) return true;
    let x; try { x = new URL(r); } catch (e) { return false; }
    return x.protocol === "http:" && a.protocol === "http:" && x.hostname === a.hostname && x.pathname === a.pathname;
  });
}

/* RFC 7591 registration body, checked. */
export function cleanRegistration(body) {
  const b = body && typeof body === "object" ? body : {};
  const uris = Array.isArray(b.redirect_uris) ? b.redirect_uris.map(String).slice(0, 10) : [];
  if (!uris.length) return { error: "invalid_redirect_uri", error_description: "redirect_uris is required." };
  const bad = uris.find(u => !redirectAllowed(u));
  if (bad) return { error: "invalid_redirect_uri", error_description: "Only Claude's own callback addresses can be registered here." };
  const method = b.token_endpoint_auth_method || "none";
  if (method !== "none") return { error: "invalid_client_metadata", error_description: "Only public clients (token_endpoint_auth_method none) are accepted." };
  const name = String(b.client_name || "Claude").replace(/[\u0000-\u001f<>]/g, "").slice(0, 80) || "Claude";
  return { value: { redirect_uris: uris, client_name: name, token_endpoint_auth_method: "none", grant_types: ["authorization_code", "refresh_token"], response_types: ["code"] } };
}

const b64url = buf => Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export async function sha256b64url(text) {
  return b64url(await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(String(text))));
}
/* PKCE: the verifier Claude kept, against the challenge it sent first. */
export async function pkceOk(verifier, challenge) {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(String(verifier || ""))) return false;
  return (await sha256b64url(verifier)) === String(challenge || "");
}
export function randomToken(bytes = 32) {
  return b64url(globalThis.crypto.getRandomValues(new Uint8Array(bytes)));
}

/* Whether this account may have its Claude connected at all. */
export function mayConnect(a) {
  if (!a || a.active === false) return "That account is switched off.";
  if (a.mustChange) return "Choose your own password in the command centre first, then connect Claude.";
  if (!a.claude) return "Your account is not set up for Claude yet. Ask an admin to tick Can ask Claude for you on People and access.";
  return "";
}

/* The access token's claim, checked against the account and its grants. */
export function accessProblem(claim, account, grants, now = Date.now()) {
  if (!claim || claim.k !== "mcp" || !claim.a || !claim.g) return "Not a Claude token for this app.";
  if (!claim.t || now - Number(claim.t) > ACCESS_SECONDS * 1000) return "The token has run out.";
  if (!grants || !grants[claim.g] || grants[claim.g].account !== claim.a) return "This Claude connection was disconnected.";
  if ((account && account.pwv || "") !== (claim.v || "")) return "The password was changed. Connect Claude again.";
  return mayConnect(account) || "";
}
