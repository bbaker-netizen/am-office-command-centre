/* A person's own Claude connected to the command centre (Craig, 2026-11-20):
   discovery, registration, sign-in, tokens, every tool, refresh, and every
   way the connection is cut off. Real endpoints, stand-in JobTread.
   Run: node --import ./test/support/use-fake-blobs.mjs test/mcp.test.mjs */
import { strict as assert } from "node:assert";
import { createHash, randomBytes } from "node:crypto";

process.env.PW_ITER = "1000";
process.env.URL = "https://am.test";
const { default: mcp, config } = await import("../netlify/functions/mcp.mjs");
const { redirectAllowed, redirectMatches, accessProblem } = await import("../netlify/functions/_mcpauth.mjs");
const { hashPassword, ACCOUNTS, accountGate } = await import("../netlify/functions/_accounts.mjs");
const { authStore, authGate, writeAuthIndex } = await import("../netlify/functions/_auth.mjs");
const s = authStore();
let n = 0; const ok = m => { n++; console.log("ok", m); };

/* ---------- rules ---------- */
assert.ok(redirectAllowed("https://claude.ai/api/mcp/auth_callback"));
assert.ok(redirectAllowed("https://claude.com/api/mcp/auth_callback"));
assert.ok(redirectAllowed("http://localhost:3118/callback") && redirectAllowed("http://127.0.0.1:55555/callback"));
for (const bad of ["https://evil.test/api/mcp/auth_callback", "http://claude.ai/api/mcp/auth_callback", "https://claude.ai/other", "https://claude.ai.evil.test/api/mcp/auth_callback", "https://claude.ai:8443/api/mcp/auth_callback", "http://localhost:1/other", "javascript:alert(1)"]) assert.ok(!redirectAllowed(bad), bad);
assert.ok(redirectMatches(["http://localhost:3118/callback"], "http://localhost:4000/callback"));
assert.ok(!redirectMatches(["https://claude.ai/api/mcp/auth_callback"], "https://claude.com/api/mcp/auth_callback"));
ok("only Claude's own callback addresses: claude.ai, claude.com and Claude Code's loopback");
assert.ok(config.path.includes("/mcp") && config.path.includes("/.well-known/oauth-protected-resource/mcp"));

/* ---------- people, jobs ---------- */
const now = new Date().toISOString();
const pw = await hashPassword("a good long password");
const acc = (id, name, extra = {}) => ({ id, email: name.split(" ")[0].toLowerCase() + "@amabatement.com", name, title: "Estimator", areas: ["office", "assistants"], level: "edit", active: true, pw, pwv: now, mustChange: false, claude: true, assistant: "estimator", ...extra });
await s.setJSON(ACCOUNTS, { accounts: { d1: acc("d1", "Dennis Vries"), b1: acc("b1", "Bruce Baker", { claude: false }) }, settings: { idleHours: 8 } });
await s.setJSON("jobtread-key", { grantKey: "k", organizationId: "ORG" });
const day = k => new Date(Date.now() + k * 86400000).toISOString().slice(0, 10);
const cf = o => ({ nodes: Object.entries(o).map(([k, v]) => ({ value: v, customField: { name: k } })) });
const jobs = [
  { id: "J1", number: "26-00140", name: "Lab reno", createdAt: now, closedOn: null, location: { address: "1 Lab Rd", account: { id: "A1", name: "U of A" } }, customFieldValues: cf({ Status: "Estimating", "Bid Due Date and Time": day(3) }) },
  { id: "J2", number: "26-00141", name: "Westmount School", createdAt: now, closedOn: null, location: { address: "2 School St", account: { id: "A2", name: "EPSB" } }, customFieldValues: cf({ Status: "New Lead" }) }
];
const members = [{ id: "m-dennis", role: { name: "Super Admin" }, user: { name: "Dennis Vries" } }];
const jt = { tasks: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  if (String(url) !== "https://api.jobtread.com/pave") return realFetch(url, opt);
  const q = JSON.parse(opt.body).query, body = {};
  const node = t => ({ ...t, assignedMemberships: { nodes: t.ids.map(id => ({ id, user: { name: "Dennis Vries" } })) } });
  if (q.organization && q.organization.jobs) body.organization = { jobs: { count: jobs.length, nextPage: null, nodes: jobs } };
  if (q.organization && q.organization.orders) body.organization = { orders: { nextPage: null, nodes: [{ id: "o1", name: "Quote", status: "pending", price: 9000, issueDate: day(-9), job: { id: "J1" } }] } };
  if (q.organization && q.organization.tasks) body.organization = { tasks: { nextPage: null, nodes: jt.tasks.map(t => ({ ...node(t), job: { id: t.jobId, number: "26-00140" } })) } };
  if (q.organization && q.organization.memberships) body.organization = { memberships: { nodes: members } };
  if (q.job) body.job = { id: q.job.$.id, number: "26-00140", tasks: { nodes: jt.tasks.filter(t => t.jobId === q.job.$.id).map(node) } };
  if (q.createTask) { jt.tasks.push({ id: "t1", name: q.createTask.$.name, description: q.createTask.$.description, createdAt: now, jobId: q.createTask.$.targetId, ids: q.createTask.$.assignedMembershipIds }); body.createTask = { createdTask: { id: "t1" } }; }
  if (q.updateTask) { const t = jt.tasks.find(x => x.id === q.updateTask.$.id); t.ids = q.updateTask.$.assignedMembershipIds; t.description = q.updateTask.$.description; body.updateTask = {}; }
  return new Response(JSON.stringify(body), { status: 200 });
};

const req = (method, path, { body, form, auth, headers = {} } = {}) => mcp(new Request("https://am.test" + path, { method, headers: { ...(auth ? { authorization: "Bearer " + auth } : {}), ...(form ? { "content-type": "application/x-www-form-urlencoded" } : body ? { "content-type": "application/json" } : {}), "x-nf-client-connection-ip": "10.1.1.1", ...headers }, body: form ? new URLSearchParams(form).toString() : body ? JSON.stringify(body) : undefined, redirect: "manual" }));

/* ---------- discovery ---------- */
let r = await req("POST", "/mcp", { body: { jsonrpc: "2.0", id: 1, method: "initialize" } });
assert.equal(r.status, 401);
assert.match(r.headers.get("www-authenticate"), /resource_metadata="https:\/\/am\.test\/\.well-known\/oauth-protected-resource\/mcp"/);
const prm = await (await req("GET", "/.well-known/oauth-protected-resource/mcp")).json();
assert.equal(prm.resource, "https://am.test/mcp"); assert.deepEqual(prm.authorization_servers, ["https://am.test"]);
const asm = await (await req("GET", "/.well-known/oauth-authorization-server")).json();
assert.equal(asm.registration_endpoint, "https://am.test/oauth/register"); assert.deepEqual(asm.code_challenge_methods_supported, ["S256"]); assert.deepEqual(asm.token_endpoint_auth_methods_supported, ["none"]);
ok("no token: 401 pointing Claude at the sign-in details, which name this site, PKCE S256 and self-registration");

/* ---------- registration ---------- */
r = await req("POST", "/oauth/register", { body: { redirect_uris: ["https://evil.test/cb"], client_name: "x" } });
assert.equal(r.status, 400);
r = await req("POST", "/oauth/register", { body: { redirect_uris: ["https://claude.ai/api/mcp/auth_callback"], client_name: "Claude", token_endpoint_auth_method: "none" } });
assert.equal(r.status, 201);
const client = await r.json();
ok("Claude registers itself; any other callback address is refused");

/* ---------- sign-in page ---------- */
const verifier = randomBytes(40).toString("base64url"), challenge = createHash("sha256").update(verifier).digest("base64url");
const auth = { response_type: "code", client_id: client.client_id, redirect_uri: "https://claude.ai/api/mcp/auth_callback", state: "st8", code_challenge: challenge, code_challenge_method: "S256", scope: "command" };
r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...auth, client_id: "nope" }));
assert.equal(r.status, 400); assert.equal(r.headers.get("location"), null);
r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...auth, redirect_uri: "https://claude.com/api/mcp/auth_callback" }));
assert.equal(r.status, 400); assert.equal(r.headers.get("location"), null);
ok("an unknown client or an unregistered return address is shown an error, never redirected");
r = await req("GET", "/oauth/authorize?" + new URLSearchParams({ ...auth, code_challenge_method: "plain" }));
assert.equal(r.status, 302); assert.match(r.headers.get("location"), /error=invalid_request/);
r = await req("GET", "/oauth/authorize?" + new URLSearchParams(auth));
assert.equal(r.status, 200);
const html = await r.text();
assert.match(html, /Sign in with your own command centre email and password/); assert.match(html, /cannot send email, pay anyone/); assert.match(html, /claude\.ai/);
assert.equal(r.headers.get("x-frame-options"), "DENY");
ok("the sign-in page says what Claude can and cannot do, and where it goes back to; PKCE plain is refused");

r = await req("POST", "/oauth/authorize", { form: { ...auth, email: "dennis@amabatement.com", password: "wrong one here", decision: "allow" } });
assert.equal(r.status, 200); assert.match(await r.text(), /do not match/);
r = await req("POST", "/oauth/authorize", { form: { ...auth, email: "bruce@amabatement.com", password: "a good long password", decision: "allow" } });
assert.match(await r.text(), /Can ask Claude/);
r = await req("POST", "/oauth/authorize", { form: { ...auth, email: "dennis@amabatement.com", password: "a good long password", decision: "deny" } });
assert.match(r.headers.get("location"), /error=access_denied/); assert.match(r.headers.get("location"), /state=st8/);
ok("a wrong password, or an account without Can ask Claude, cannot connect; Cancel goes back to Claude with access_denied");

r = await req("POST", "/oauth/authorize", { form: { ...auth, email: "dennis@amabatement.com", password: "a good long password", decision: "allow" } });
assert.equal(r.status, 302);
const back = new URL(r.headers.get("location"));
assert.equal(back.origin + back.pathname, "https://claude.ai/api/mcp/auth_callback"); assert.equal(back.searchParams.get("state"), "st8"); assert.equal(back.searchParams.get("iss"), "https://am.test");
const code = back.searchParams.get("code"); assert.ok(code);
ok("Dennis signs in: back to Claude with a code and the same state");

/* ---------- tokens ---------- */
const tokForm = extra => ({ grant_type: "authorization_code", code, redirect_uri: auth.redirect_uri, client_id: client.client_id, code_verifier: verifier, ...extra });
r = await req("POST", "/oauth/token", { form: tokForm({ code_verifier: randomBytes(40).toString("base64url") }) });
assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_grant");
ok("a wrong PKCE verifier is refused, and the code is spent");
r = await req("POST", "/oauth/authorize", { form: { ...auth, email: "dennis@amabatement.com", password: "a good long password", decision: "allow" } });
const code2 = new URL(r.headers.get("location")).searchParams.get("code");
r = await req("POST", "/oauth/token", { form: tokForm({ code: code2 }) });
assert.equal(r.status, 200);
let t = await r.json();
assert.equal(t.token_type, "Bearer"); assert.equal(t.expires_in, 3600); assert.ok(t.refresh_token);
assert.equal((await req("POST", "/oauth/token", { form: tokForm({ code: code2 }) })).status, 400);
ok("the code swaps once for a one-hour access token and a refresh token");

/* ---------- MCP ---------- */
let id = 0;
const rpc = async (method, params, tok = t.access_token) => { const x = await req("POST", "/mcp", { auth: tok, body: { jsonrpc: "2.0", id: ++id, method, params } }); return { status: x.status, body: x.status === 202 ? null : await x.json() }; };
let m = await rpc("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "claude-ai", version: "1" } });
assert.equal(m.body.result.protocolVersion, "2025-06-18"); assert.ok(m.body.result.capabilities.tools); assert.match(m.body.result.instructions, /as Dennis Vries/);
assert.equal((await rpc("notifications/initialized")).status, 202);
const tools = (await rpc("tools/list")).body.result.tools.map(x => x.name);
assert.deepEqual(tools, ["who_am_i", "find_jobs", "get_job", "estimating_board", "take_estimate", "let_go_of_estimate", "my_day", "add_to_my_list", "list_inventory_items", "tick_off_my_list"]);
ok("Claude starts a session and sees ten tools");

const call = async (name, args) => { const x = (await rpc("tools/call", { name, arguments: args })).body.result; return { ...x, data: x.structuredContent }; };
let c = await call("who_am_i", {});
assert.equal(c.data.name, "Dennis Vries"); assert.deepEqual(c.data.sees, ["office", "assistants"]);
c = await call("find_jobs", { query: "westmount" });
assert.equal(c.data.count, 1); assert.equal(c.data.jobs[0].number, "26-00141"); assert.equal(c.data.jobs[0].takenBy, "");
c = await call("get_job", { job: "26-00140" });
assert.equal(c.data.client, "U of A"); assert.equal(c.data.quotes[0].beforeGst, 9000);
c = await call("estimating_board", {});
assert.equal(c.data.bidsDue[0].number, "26-00140"); assert.equal(c.data.leadsNobodyHasTaken[0].number, "26-00141"); assert.equal(c.data.quotesWithNoAnswer[0].waitingDays, 9);
ok("it finds and reads jobs and the estimating board, as Dennis sees them");

c = await call("take_estimate", { job: "26-00140" });
assert.equal(c.isError, false); assert.equal(c.data.takenBy, "Dennis Vries"); assert.deepEqual(jt.tasks[0].ids, ["m-dennis"]);
c = await call("get_job", { job: "26-00140" });
assert.match(c.data.takenBy, /^Dennis Vries/);
c = await call("let_go_of_estimate", { job: "26-00140" });
assert.equal(c.data.takenBy, "nobody");
c = await call("get_job", { job: "26-99999" });
assert.equal(c.isError, true); assert.match(c.content[0].text, /No open job/);
ok("it takes and lets go of an estimate as Dennis, kept in JobTread; a wrong job is a plain error");

c = await call("add_to_my_list", { text: "Call PCL about the Westmount tender", due: day(2) });
assert.ok(c.data.id);
c = await call("my_day", {});
assert.ok(c.data.list.some(x => x.text === "Call PCL about the Westmount tender" && x.due === day(2)));
const itemId = c.data.list.find(x => /PCL/.test(x.text)).id;
await call("tick_off_my_list", { item_id: itemId });
c = await call("my_day", {});
assert.ok(!c.data.list.some(x => x.id === itemId));
ok("it adds to and ticks off Dennis's own hit list");

/* ---------- the inventory, read only (Jen, 2026-11-25) ---------- */
await s.setJSON("catalog", { stock: [
    { id: "GLV-01", name: "Nitrile Gloves L", group: "PPE - gloves", uom: "BX", packSize: 100, min: 5, max: 20, shelf: "Bay 2" },
    { id: "SUIT-01", name: "Tyvek Suit L/XL", group: "PPE - coveralls", uom: "EA" }],
  units: [{ id: "DEH-801", name: "Dehumidifier - Large", group: "Dehumidifiers", unitNo: "#801", serial: "230784094770013", model: "Actuvate OLR190B", status: "Active" }],
  jobs: [{ id: "J1", jobtreadNumber: "26-00140", name: "Westmount" }] });
await s.setJSON("ev-index", { months: ["ev-2026-11"] });
await s.setJSON("ev-2026-11", { events: [
  { id: "e1", type: "COUNT", itemId: "GLV-01", qty: 7, at: "2026-11-20T15:00:00Z", by: "Jen" },
  { id: "e2", type: "ISSUE", itemId: "DEH-801", jobId: "J1", qty: 1, at: "2026-11-21T15:00:00Z", by: "Zach" }] });
c = await call("list_inventory_items", {});
assert.equal(c.isError, false);
assert.equal(c.data.materialCount, 2); assert.equal(c.data.equipmentCount, 1);
const glv = c.data.materials.find(x => x.tag === "GLV-01");
assert.equal(glv.unit, "box"); assert.equal(glv.inOne, 100); assert.equal(glv.onHand, 7); assert.equal(glv.shelf, "Bay 2");
assert.match(c.data.equipment[0].where, /^Out on 26-00140/);
c = await call("list_inventory_items", { kind: "materials", search: "nitrile" });
assert.equal(c.data.materialCount, 1); assert.equal(c.data.equipment, undefined);
c = await call("list_inventory_items", { kind: "equipment", group: "Dehumidifiers" });
assert.equal(c.data.equipmentCount, 1); assert.equal(c.data.materials, undefined);
ok("it lists the shop's materials with their units and counts, and the machines with where they are, read only");

/* ---------- the token is for this and nothing else ---------- */
assert.ok(await accountGate(new Request("https://am.test/api/command?part=me", { headers: { authorization: "Bearer " + t.access_token } }), s));
await s.setJSON("catalog", { users: [{ id: "u1", name: "Jen", active: true, pin: { salt: "x", hash: "y" }, pinSetAt: now }] }); await writeAuthIndex(s, { users: [{ id: "u1", name: "Jen", active: true, pin: { salt: "x", hash: "y" }, pinSetAt: now }] });
assert.equal((await authGate(new Request("https://am.test/api/sync", { headers: { authorization: "Bearer " + t.access_token } }), s)).status, 401);
ok("Claude's token opens neither the command centre's own pages nor the shop");

/* ---------- refresh ---------- */
r = await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id } });
const t2 = await r.json();
assert.equal(r.status, 200); assert.notEqual(t2.refresh_token, t.refresh_token);
r = await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id } });
assert.equal(r.status, 400); assert.equal((await r.json()).error, "invalid_grant");
t = t2;
ok("refresh tokens rotate; an old one is refused with invalid_grant");

/* ---------- cut off ---------- */
const doc = await s.get(ACCOUNTS, { type: "json" });
doc.accounts.d1.claude = false; await s.setJSON(ACCOUNTS, doc);
assert.equal((await rpc("tools/list")).status, 401);
doc.accounts.d1.claude = true; await s.setJSON(ACCOUNTS, doc);
assert.equal((await rpc("tools/list")).status, 200);
ok("unticking Can ask Claude stops it on the very next request");

const g = await (await mcp(new Request("https://am.test/api/claude-connections", { headers: { authorization: "Bearer " + (await (await import("../netlify/functions/_accounts.mjs")).accountToken(s, doc.accounts.d1)) } }))).json();
assert.equal(g.connections.length, 1); assert.equal(g.connections[0].name, "Claude"); assert.equal(g.address, "https://am.test/mcp"); assert.equal(g.allowed, true);
const acctTok = await (await import("../netlify/functions/_accounts.mjs")).accountToken(s, doc.accounts.d1);
await mcp(new Request("https://am.test/api/claude-connections", { method: "POST", headers: { authorization: "Bearer " + acctTok, "content-type": "application/json" }, body: JSON.stringify({ all: true }) }));
assert.equal((await rpc("tools/list")).status, 401);
r = await req("POST", "/oauth/token", { form: { grant_type: "refresh_token", refresh_token: t.refresh_token, client_id: client.client_id } });
assert.equal((await r.json()).error, "invalid_grant");
ok("Disconnect under My account ends it at once, and it cannot refresh");

assert.equal(accessProblem({ k: "mcp", a: "d1", g: "x", v: now, t: Date.now() - 3700000 }, doc.accounts.d1, { x: { account: "d1" } }), "The token has run out.");
assert.match(accessProblem({ k: "mcp", a: "d1", g: "x", v: "old", t: Date.now() }, doc.accounts.d1, { x: { account: "d1" } }), /password was changed/);
assert.match(accessProblem({ k: "mcp", a: "d1", g: "x", v: now, t: Date.now() }, { ...doc.accounts.d1, active: false }, { x: { account: "d1" } }), /switched off/);
ok("an hour-old token, a changed password or a switched-off account are refused");

globalThis.fetch = realFetch;
console.log(`\n${n} Claude connector checks passed`);
