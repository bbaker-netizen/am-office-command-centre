/* A&M - the command centre as a connector for each person's own Claude
   (Craig, 2026-11-20). Model Context Protocol over HTTP, with OAuth so each
   person signs in as themselves. Sign-in rules: _mcpauth.mjs.

   /mcp                                         the MCP address people add to Claude
   /.well-known/oauth-protected-resource[/mcp]  where to sign in (RFC 9728)
   /.well-known/oauth-authorization-server      how to sign in (RFC 8414)
   /oauth/register                              Claude registers itself (RFC 7591)
   /oauth/authorize                             the person signs in and says yes
   /oauth/token                                 codes and refresh tokens
   /oauth/revoke                                Claude disconnects
   /api/claude-connections                      a person's own connections, and Disconnect

   What it can do: exactly what the person can do on their own screen, because
   every tool calls the command centre's own endpoints as that person (their
   areas, their level, their assistant). Nothing here sends email, pays anyone
   or changes a JobTread field. The tools: who_am_i, find_jobs, get_job,
   estimating_board, take_estimate, let_go_of_estimate, my_day,
   add_to_my_list, tick_off_my_list. */

import { authStore, readToken, signToken } from "./_auth.mjs";
import { readAccounts, accountToken, accountGate } from "./_accounts.mjs";
import { withLock } from "./_lock.mjs";
import {
  ACCESS_SECONDS, CODE_MS, SCOPE, siteUrl, resourceUrl, protectedResource, authServer, wwwAuthenticate,
  redirectAllowed, redirectMatches, cleanRegistration, sha256b64url, pkceOk, randomToken, mayConnect, accessProblem
} from "./_mcpauth.mjs";
import commandHandler from "./command.mjs";
import assistantHandler from "./assistant.mjs";
import accountHandler from "./account.mjs";

const CLIENTS = "mcp-clients", GRANTS = "mcp-grants", CODE = h => "mcp-code-" + h;
const json = (b, s = 200, h = {}) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store", ...h } });
const oerr = (error, error_description, s = 400) => json({ error, error_description }, s);
const esc = v => String(v == null ? "" : v).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

async function readClients(s) { return ((await s.get(CLIENTS, { type: "json" })) || { clients: {} }).clients || {}; }
async function readGrants(s) { return ((await s.get(GRANTS, { type: "json" })) || { grants: {} }).grants || {}; }
const changeGrants = (s, fn) => withLock(s, GRANTS, async () => { const g = await readGrants(s); const out = await fn(g); await s.setJSON(GRANTS, { grants: g }); return out; });

/* ------------------------------------------------------------ sign-in page */
function page(title, body, status = 200) {
  return new Response(`<!doctype html><html lang="en-CA"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;font-family:Arial,Helvetica,sans-serif;background:#f4f3ef;color:#1a1917}.bar{background:#1a1917;color:#f4f3ef;padding:16px 22px;font-weight:800;font-size:22px}.bar b{color:#329dbb}
main{max-width:460px;margin:28px auto;background:#fff;border:1px solid #e2e0da;border-radius:6px;padding:24px 26px}h1{font-size:20px;margin:0 0 10px}p,li{font-size:14.5px;line-height:1.5}
label{display:block;font-size:13px;margin:12px 0 4px;color:#4a4844}input[type=email],input[type=password]{width:100%;box-sizing:border-box;font:inherit;font-size:15px;padding:10px;border:1px solid #c9c6bf;border-radius:4px}
.row{display:flex;gap:10px;margin-top:18px}button{font:inherit;font-weight:700;font-size:15px;padding:10px 18px;border-radius:6px;cursor:pointer;border:1px solid #1a1917}
.go{background:#1a1917;color:#fff}.no{background:#fff;color:#1a1917}.err{background:#fdecea;color:#8a2a1c;padding:10px 12px;border-radius:4px}.sm{font-size:12.5px;color:#6b6862}ul{padding-left:20px}</style></head>
<body><div class="bar">A<b>&amp;</b>M <span style="font-weight:400;font-size:15px">Office Command Centre</span></div><main>${body}</main></body></html>`, { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-frame-options": "DENY", "content-security-policy": "frame-ancestors 'none'" } });
}
const CAN = `<ul><li>Find and read jobs, quotes and the estimating board</li><li>See who has taken which estimate, and take or let go of one as you</li><li>Read your My day: your hit list, emails that need you, today's meetings</li><li>Add to and tick off your hit list</li></ul>
<p>It sees only what you see in the command centre. It cannot send email, pay anyone, or change job fields in JobTread.</p>`;
function signInForm(p, client, message) {
  const host = (() => { try { return new URL(p.redirect_uri).host; } catch (e) { return ""; } })();
  const hidden = ["client_id", "redirect_uri", "state", "code_challenge", "code_challenge_method", "scope", "resource"].map(k => `<input type="hidden" name="${k}" value="${esc(p[k] || "")}">`).join("");
  return page("Connect Claude", `<h1>Connect ${esc(client.client_name || "Claude")} to the command centre</h1>
<p>Sign in with your own command centre email and password. Claude will then work in the command centre as you, and only as you. It can:</p>${CAN}
${message ? `<p class="err">${esc(message)}</p>` : ""}
<form method="post" action="/oauth/authorize" autocomplete="on">${hidden}
<label for="em">Email</label><input id="em" type="email" name="email" autocomplete="username" required>
<label for="pw">Password</label><input id="pw" type="password" name="password" autocomplete="current-password" required>
<div class="row"><button class="go" name="decision" value="allow">Sign in and connect</button><button class="no" name="decision" value="deny" formnovalidate>Cancel</button></div></form>
<p class="sm">After you sign in, you go back to ${esc(host)}. Disconnect any time under My account in the command centre. An admin can switch it off for anyone.</p>`);
}

async function authorizeParams(req) {
  if (req.method === "GET") return Object.fromEntries(new URL(req.url).searchParams);
  const t = await req.text();
  return Object.fromEntries(new URLSearchParams(t));
}
async function authorize(s, req) {
  const p = await authorizeParams(req);
  const clients = await readClients(s);
  const client = clients[p.client_id];
  /* A bad client or address never gets a redirect: it is shown here. */
  if (!client) return page("Not connected", `<h1>That did not work</h1><p>This connection request is not one the command centre knows. Remove the connector in Claude and add it again.</p>`, 400);
  if (!redirectMatches(client.redirect_uris, p.redirect_uri)) return page("Not connected", `<h1>That did not work</h1><p>The request asked to go back to an address this connection did not register.</p>`, 400);
  const back = params => { const u = new URL(p.redirect_uri); Object.entries({ ...params, state: p.state, iss: siteUrl() }).forEach(([k, v]) => { if (v) u.searchParams.set(k, v); }); return new Response(null, { status: 302, headers: { location: u.toString(), "cache-control": "no-store" } }); };
  if (p.response_type && p.response_type !== "code" && req.method === "GET") return back({ error: "unsupported_response_type" });
  if (p.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43,128}$/.test(String(p.code_challenge || ""))) return back({ error: "invalid_request", error_description: "PKCE S256 is required." });
  if (req.method === "GET") return signInForm(p, client);
  if (p.decision !== "allow") return back({ error: "access_denied" });

  /* The password is checked by the command centre's own sign-in, so the same
     wrong-try limits apply. */
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  const r = await accountHandler(new Request(siteUrl() + "/api/account", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip }, body: JSON.stringify({ action: "login", email: p.email, password: p.password }) }));
  const b = await r.json().catch(() => ({}));
  if (!r.ok) return signInForm(p, client, b.message || "That email and password do not match.");
  const { accounts } = await readAccounts(s);
  const a = accounts[b.account && b.account.id];
  const why = mayConnect(a);
  if (why) return signInForm(p, client, why);
  const code = randomToken(32);
  await s.setJSON(CODE(await sha256b64url(code)), { client: p.client_id, redirect: p.redirect_uri, challenge: p.code_challenge, account: a.id, pwv: a.pwv || "", at: Date.now() });
  return back({ code });
}

async function issue(s, grantId, a) {
  const access_token = await signToken(s, { k: "mcp", a: a.id, v: a.pwv || "", g: grantId, t: Date.now() });
  return { access_token, token_type: "Bearer", expires_in: ACCESS_SECONDS, scope: SCOPE };
}
async function token(s, req) {
  const ct = req.headers.get("content-type") || "";
  const raw = await req.text();
  let p = {};
  if (/json/.test(ct)) { try { p = JSON.parse(raw); } catch (e) {} } else p = Object.fromEntries(new URLSearchParams(raw));
  if (p.grant_type === "authorization_code") {
    const key = CODE(await sha256b64url(String(p.code || "")));
    const c = await s.get(key, { type: "json" });
    if (c) await s.delete(key).catch(() => {});                        /* a code is used once */
    if (!c || Date.now() - c.at > CODE_MS) return oerr("invalid_grant", "That code has run out or was already used.");
    if (c.client !== p.client_id) return oerr("invalid_grant", "That code was issued to another client.");
    if (c.redirect !== p.redirect_uri) return oerr("invalid_grant", "redirect_uri does not match.");
    if (!(await pkceOk(p.code_verifier, c.challenge))) return oerr("invalid_grant", "code_verifier does not match.");
    const { accounts } = await readAccounts(s);
    const a = accounts[c.account];
    if (mayConnect(a) || (a.pwv || "") !== c.pwv) return oerr("invalid_grant", "That account cannot connect Claude now.");
    const clients = await readClients(s);
    const refresh = randomToken(32), gid = "g" + randomToken(9);
    await changeGrants(s, g => { g[gid] = { account: a.id, client: c.client, clientName: (clients[c.client] || {}).client_name || "Claude", refresh: null, createdAt: new Date().toISOString(), lastUsed: new Date().toISOString(), pwv: a.pwv || "" }; });
    const hash = await sha256b64url(refresh);
    await changeGrants(s, g => { g[gid].refresh = hash; });
    return json({ ...(await issue(s, gid, a)), refresh_token: refresh });
  }
  if (p.grant_type === "refresh_token") {
    const hash = await sha256b64url(String(p.refresh_token || ""));
    const { accounts } = await readAccounts(s);
    const fresh = randomToken(32), freshHash = await sha256b64url(fresh);
    const out = await changeGrants(s, g => {
      const gid = Object.keys(g).find(k => g[k].refresh === hash);
      if (!gid) return { error: "That connection was disconnected. Connect Claude again." };
      const gr = g[gid], a = accounts[gr.account];
      if (p.client_id && p.client_id !== gr.client) return { error: "That refresh token belongs to another client." };
      if (mayConnect(a) || (a.pwv || "") !== gr.pwv) { delete g[gid]; return { error: "That account cannot use Claude now. Connect again." }; }
      gr.refresh = freshHash; gr.lastUsed = new Date().toISOString();           /* rotated every use */
      return { gid, a };
    });
    if (out.error) return oerr("invalid_grant", out.error);
    return json({ ...(await issue(s, out.gid, out.a)), refresh_token: fresh });
  }
  return oerr("unsupported_grant_type", "Use authorization_code or refresh_token.");
}

async function revoke(s, req) {
  const p = Object.fromEntries(new URLSearchParams(await req.text()));
  const hash = await sha256b64url(String(p.token || ""));
  await changeGrants(s, g => { for (const k of Object.keys(g)) if (g[k].refresh === hash) delete g[k]; });
  return new Response(null, { status: 200, headers: { "cache-control": "no-store" } });
}

/* ------------------------------------------------------------ the tools */
const STAGE = { lead: ["New Lead", "Uploaded Without Plans", "Uploaded With Plans"], est: ["Estimating", "Site Visit Scheduled", "Pending Estimate Review", "Estimate Review Completed"], out: ["Estimate Sent", "Pending", "Follow Up Required"] };
const stageOf = st => Object.keys(STAGE).find(k => STAGE[k].includes(st)) || "";
const fieldsOf = j => { const o = {}; for (const x of (j.customFieldValues && j.customFieldValues.nodes) || []) { const k = x.customField && x.customField.name; if (k && o[k] === undefined) o[k] = x.value; } return o; };
const brief = (j, claims) => { const f = fieldsOf(j), c = claims && claims[j.id]; return { id: j.id, number: j.number, name: j.name, client: (j.location && j.location.account && j.location.account.name) || "", address: (j.location && j.location.address) || "", status: f.Status || "", projectManager: f["Project Manager"] || "", bidDue: f["Bid Due Date and Time"] || "", siteVisit: f["Site Visit Date and Time"] || "", takenBy: c ? c.by + " (" + c.at + ")" : "" }; };

function toolsFor() {
  const str = (d) => ({ type: "string", description: d });
  const ro = { readOnlyHint: true, openWorldHint: false };
  return [
    { name: "who_am_i", title: "Who am I", description: "The person this connection is signed in as, and what they can see and do in the A&M command centre.", inputSchema: { type: "object", properties: {} }, annotations: ro },
    { name: "find_jobs", title: "Find jobs", description: "Search A&M's open JobTread jobs by job number, name, client or address. Returns status, project manager, bid due date, site visit and who has taken the estimate.", inputSchema: { type: "object", properties: { query: str("Words to look for, for example 26-00140, a client or a street"), limit: { type: "number", description: "At most this many, default 15" } }, required: ["query"] }, annotations: ro },
    { name: "get_job", title: "Get a job", description: "Everything the command centre knows about one job: its JobTread fields, quotes, and who has taken the estimate.", inputSchema: { type: "object", properties: { job: str("Job number (26-00140) or JobTread job id") }, required: ["job"] }, annotations: ro },
    { name: "estimating_board", title: "Estimating board", description: "Bids due in the next two weeks, leads nobody has taken, quotes sent with no answer, and site visits this week, each with who has taken it.", inputSchema: { type: "object", properties: {} }, annotations: ro },
    { name: "take_estimate", title: "Take an estimate", description: "Mark a lead or estimate as taken by this person, so nobody else starts it. Refused if someone else has it, unless take_over is true (only when the person has said to take it over).", inputSchema: { type: "object", properties: { job: str("Job number or id"), take_over: { type: "boolean", description: "Take it from whoever has it. Only when the person asked for that." } }, required: ["job"] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "let_go_of_estimate", title: "Let go of an estimate", description: "Free up a lead or estimate this person has taken, so someone else can take it.", inputSchema: { type: "object", properties: { job: str("Job number or id") }, required: ["job"] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: "my_day", title: "My day", description: "This person's own assistant: their hit list, the latest check-in, emails that need them (sender, subject, what to do) and today's meetings.", inputSchema: { type: "object", properties: {} }, annotations: ro },
    { name: "add_to_my_list", title: "Add to my list", description: "Put a line on this person's hit list in My day.", inputSchema: { type: "object", properties: { text: str("What to do, short"), due: str("YYYY-MM-DD, optional"), who: str("Person or company it is about, optional") }, required: ["text"] }, annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false } },
    { name: "tick_off_my_list", title: "Tick off my list", description: "Mark a line on this person's hit list as done, by its id from my_day.", inputSchema: { type: "object", properties: { item_id: str("The id from my_day") }, required: ["item_id"] }, annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } }
  ];
}

/* Every tool goes through the command centre's own endpoints, as the person. */
async function asPerson(handler, tok, path, body) {
  const r = await handler(new Request(siteUrl() + path, { method: body ? "POST" : "GET", headers: { authorization: "Bearer " + tok, "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
  const b = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(b.message || b.error || ("The command centre answered " + r.status + ".")); e.status = r.status; throw e; }
  return b;
}
/* The person's branch, as on their own screen (_accounts.mjs branchOf). */
const inBranch = (j, branch) => { if (!branch) return true; const cal = /calgary/i.test(String(fieldsOf(j)["Estimating branch"] || "")); return branch === "calgary" ? cal : !cal; };
async function allJobs(tok, me) {
  const first = await asPerson(commandHandler, tok, "/api/command?part=jobs");
  const nodes = [...(first.nodes || [])]; let next = first.nextPage, guard = 0;
  while (next && guard++ < 8) { const more = await asPerson(commandHandler, tok, "/api/command?part=jobs&page=" + encodeURIComponent(next)); nodes.push(...(more.nodes || [])); next = more.nextPage; }
  return { nodes: nodes.filter(j => !j.closedOn && inBranch(j, me && me.branch)), orders: first.orders || [] };
}
async function claimsFor(tok) { try { return (await asPerson(commandHandler, tok, "/api/command?part=claims")).claims || {}; } catch (e) { return {}; } }
function findJob(nodes, q) {
  const t = String(q || "").trim().toLowerCase();
  return nodes.find(j => String(j.number).toLowerCase() === t || j.id.toLowerCase() === t) || null;
}
const daysTo = d => { const x = Date.parse(String(d || "").slice(0, 10)); return isNaN(x) ? null : Math.round((x - Date.parse(new Date().toISOString().slice(0, 10))) / 86400000); };

async function runTool(name, args, tok, me) {
  const A = args || {};
  if (name === "who_am_i") return { name: me.name, email: me.email, title: me.title, sees: me.areas, level: me.level, assistant: me.assistant };
  if (name === "find_jobs") {
    const { nodes } = await allJobs(tok, me); const claims = await claimsFor(tok);
    const words = String(A.query || "").toLowerCase().split(/\s+/).filter(Boolean);
    const hits = nodes.filter(j => { const hay = [j.number, j.name, j.location && j.location.address, j.location && j.location.account && j.location.account.name].join(" ").toLowerCase(); return words.every(w => hay.includes(w)); });
    return { count: hits.length, jobs: hits.slice(0, Math.min(50, Number(A.limit) || 15)).map(j => brief(j, claims)) };
  }
  if (name === "get_job") {
    const { nodes, orders } = await allJobs(tok, me); const claims = await claimsFor(tok);
    const j = findJob(nodes, A.job); if (!j) throw new Error("No open job " + A.job + ". Use find_jobs to look it up.");
    return { ...brief(j, claims), fields: fieldsOf(j), opened: j.createdAt, quotes: orders.filter(o => o.job && o.job.id === j.id).map(o => ({ name: o.name, status: o.status, beforeGst: o.price, issued: o.issueDate })), link: "https://app.jobtread.com/jobs/" + j.id };
  }
  if (name === "estimating_board") {
    const { nodes, orders } = await allJobs(tok, me); const claims = await claimsFor(tok);
    const st = j => fieldsOf(j).Status || "";
    const bids = nodes.filter(j => ["lead", "est"].includes(stageOf(st(j))) && fieldsOf(j)["Bid Due Date and Time"]).map(j => ({ j, d: daysTo(fieldsOf(j)["Bid Due Date and Time"]) })).filter(x => x.d !== null && x.d >= 0 && x.d <= 14).sort((a, b) => a.d - b.d);
    const visits = nodes.filter(j => fieldsOf(j)["Site Visit Date and Time"]).map(j => ({ j, d: daysTo(fieldsOf(j)["Site Visit Date and Time"]) })).filter(x => x.d !== null && x.d >= 0 && x.d <= 7).sort((a, b) => a.d - b.d);
    const byId = Object.fromEntries(nodes.map(j => [j.id, j]));
    const quotes = orders.filter(o => o.status === "pending" && o.job && byId[o.job.id]).map(o => ({ ...brief(byId[o.job.id], claims), quote: o.name, beforeGst: o.price, waitingDays: -daysTo(o.issueDate || o.createdAt) })).sort((a, b) => (b.waitingDays || 0) - (a.waitingDays || 0));
    return { bidsDue: bids.map(x => ({ ...brief(x.j, claims), inDays: x.d })), leadsNobodyHasTaken: nodes.filter(j => stageOf(st(j)) === "lead" && !claims[j.id]).map(j => brief(j, claims)), quotesWithNoAnswer: quotes.slice(0, 30), siteVisitsThisWeek: visits.map(x => ({ ...brief(x.j, claims), inDays: x.d })) };
  }
  if (name === "take_estimate" || name === "let_go_of_estimate") {
    const { nodes } = await allJobs(tok, me);
    const j = findJob(nodes, A.job); if (!j) throw new Error("No open job " + A.job + ". Use find_jobs to look it up.");
    const b = await asPerson(commandHandler, tok, "/api/command", { claim: { jobId: j.id, take: name === "take_estimate", force: !!A.take_over } });
    return { job: j.number + " " + j.name, takenBy: b.claim ? b.claim.by : "nobody", takenOverFrom: b.from || "" };
  }
  if (name === "my_day") {
    const d = await asPerson(assistantHandler, tok, "/api/assistant");
    return { list: (d.open || []).map(x => ({ id: x.id, text: x.text, due: x.due || "", who: x.who || "", job: x.jobNumber || "" })), lastCheckin: d.checkins && d.checkins[0] ? d.checkins[0].text : "",
      emailsNeedingYou: (d.queue || []).map(x => ({ from: x.who || x.address, subject: x.subject, todo: x.action, inbox: x.inbox })), meetingsToday: ((d.calendar && d.calendar.today) || []).map(e => ({ title: e.title || e.summary, start: e.start, end: e.end })) };
  }
  if (name === "add_to_my_list") {
    const b = await asPerson(assistantHandler, tok, "/api/assistant", { action: "add", item: { text: String(A.text || ""), due: A.due || "", who: A.who || "", source: "claude" } });
    return { added: b.item && b.item.text, id: b.item && b.item.id };
  }
  if (name === "tick_off_my_list") {
    await asPerson(assistantHandler, tok, "/api/assistant", { action: "tick", id: String(A.item_id || "") });
    return { ticked: A.item_id };
  }
  throw new Error("Unknown tool " + name + ".");
}

const PROTOCOLS = ["2025-11-25", "2025-06-18", "2025-03-26"];
async function rpc(msg, tok, me) {
  const id = msg.id, ok = result => ({ jsonrpc: "2.0", id, result }), fail = (code, message) => ({ jsonrpc: "2.0", id, error: { code, message } });
  if (msg.method === "initialize") {
    const asked = msg.params && msg.params.protocolVersion;
    return ok({ protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[1], capabilities: { tools: { listChanged: false } }, serverInfo: { name: "am-command-centre", title: "A&M Office Command Centre", version: "1.0.0" },
      instructions: `You are connected to the A&M Abatement Services command centre as ${me.name}. Everything here is what ${me.name.split(" ")[0]} can see and do on their own screen. Before starting work on a lead or estimate, check who has taken it (find_jobs or get_job); take_estimate marks it as theirs. Never use take_over unless ${me.name.split(" ")[0]} asked to take it from someone. All money is Canadian dollars, before GST unless it says otherwise.` });
  }
  if (msg.method === "ping") return ok({});
  if (msg.method === "tools/list") return ok({ tools: toolsFor() });
  if (msg.method === "tools/call") {
    const p = msg.params || {};
    if (!toolsFor().some(t => t.name === p.name)) return fail(-32602, "Unknown tool " + p.name);
    try { const out = await runTool(p.name, p.arguments, tok, me); return ok({ content: [{ type: "text", text: JSON.stringify(out, null, 1) }], structuredContent: out, isError: false }); }
    catch (e) { return ok({ content: [{ type: "text", text: e.message || "That did not work." }], isError: true }); }
  }
  if (msg.method && msg.method.startsWith("notifications/")) return null;
  return fail(-32601, "Method not found: " + msg.method);
}

async function mcp(s, req) {
  const unauth = (why) => json({ error: "invalid_token", error_description: why }, 401, { "www-authenticate": wwwAuthenticate() + `, error="invalid_token", error_description="${why.replace(/"/g, "'")}"` });
  const h = req.headers.get("authorization") || "";
  if (!/^Bearer\s+/i.test(h)) return json({ error: "unauthorized", error_description: "Sign in to connect." }, 401, { "www-authenticate": wwwAuthenticate() });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405, { allow: "POST" });
  const claim = await readToken(s, h.replace(/^Bearer\s+/i, "").trim());
  const { accounts, settings } = await readAccounts(s);
  const a = claim && accounts[claim.a];
  const grants = await readGrants(s);
  const why = accessProblem(claim, a, grants);
  if (why) return unauth(why);
  const tok = await accountToken(s, a);
  const { userOf } = await import("./_accounts.mjs");
  const me = userOf(a, settings);
  const body = await req.json().catch(() => null);
  if (!body) return json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400);
  const list = Array.isArray(body) ? body : [body];
  const out = (await Promise.all(list.map(m => rpc(m, tok, me)))).filter(Boolean);
  const g = grants[claim.g]; if (g && Date.now() - Date.parse(g.lastUsed || 0) > 600000) changeGrants(s, gg => { if (gg[claim.g]) gg[claim.g].lastUsed = new Date().toISOString(); }).catch(() => {});
  if (!out.length) return new Response(null, { status: 202 });
  return json(Array.isArray(body) ? out : out[0]);
}

/* A person's own Claude connections, for My account. */
async function connections(s, req) {
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (req.method === "POST") {
    if (u.viewAs) return json({ error: "view_only", message: "Not while viewing as someone else." }, 403);
    const b = await req.json().catch(() => ({}));
    await changeGrants(s, g => { for (const k of Object.keys(g)) if (g[k].account === u.id && (b.all || k === b.id)) delete g[k]; });
  }
  const g = await readGrants(s);
  return json({ address: resourceUrl(), allowed: !!u.claude, connections: Object.entries(g).filter(([, x]) => x.account === u.id).map(([id, x]) => ({ id, name: x.clientName, since: x.createdAt, lastUsed: x.lastUsed })) });
}

export default async (req) => {
  const s = authStore();
  const path = new URL(req.url).pathname.replace(/\/+$/, "") || "/";
  try {
    if (path === "/.well-known/oauth-protected-resource" || path === "/.well-known/oauth-protected-resource/mcp") return json(protectedResource(), 200, { "access-control-allow-origin": "*" });
    if (path === "/.well-known/oauth-authorization-server" || path === "/.well-known/oauth-authorization-server/mcp") return json(authServer(), 200, { "access-control-allow-origin": "*" });
    if (path === "/oauth/register") {
      if (req.method !== "POST") return json({ error: "Use POST." }, 405);
      const c = cleanRegistration(await req.json().catch(() => ({})));
      if (c.error) return json(c, 400);
      const client_id = "c" + randomToken(12);
      await withLock(s, CLIENTS, async () => {
        const all = await readClients(s);
        all[client_id] = { ...c.value, at: Date.now() };
        /* Claude registers again on each fresh connection: keep the newest few hundred. */
        const keep = Object.entries(all).sort((x, y) => y[1].at - x[1].at).slice(0, 300);
        await s.setJSON(CLIENTS, { clients: Object.fromEntries(keep) });
      });
      return json({ client_id, client_id_issued_at: Math.floor(Date.now() / 1000), ...c.value }, 201);
    }
    if (path === "/oauth/authorize") return await authorize(s, req);
    if (path === "/oauth/token") { if (req.method !== "POST") return json({ error: "Use POST." }, 405); return await token(s, req); }
    if (path === "/oauth/revoke") return await revoke(s, req);
    if (path === "/api/claude-connections") return await connections(s, req);
    if (path === "/mcp") return await mcp(s, req);
  } catch (e) {
    return json({ error: "server_error", error_description: e.message }, 500);
  }
  return json({ error: "Not found." }, 404);
};

export const config = { path: ["/mcp", "/.well-known/oauth-protected-resource", "/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-authorization-server", "/.well-known/oauth-authorization-server/mcp", "/oauth/register", "/oauth/authorize", "/oauth/token", "/oauth/revoke", "/api/claude-connections"] };
