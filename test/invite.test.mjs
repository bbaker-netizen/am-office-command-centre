/* Invites, end to end, through the real /api/account code, against a stand-in
   data store and a stand-in Gmail. Nothing real is called.
   Run: node --import ./test/support/use-fake-blobs.mjs test/invite.test.mjs */
import { strict as assert } from "node:assert";

process.env.PW_ITER = "1000";
process.env.URL = "https://am-office-command-centre.netlify.app";
const { default: account } = await import("../netlify/functions/account.mjs");
const { hashPassword } = await import("../netlify/functions/_accounts.mjs");
const { authStore } = await import("../netlify/functions/_auth.mjs");
const s = authStore();
let n = 0; const ok = m => { n++; console.log("ok", m); };

/* Stand-in Gmail. Off by default, so the "not connected" path is tested first. */
const sent = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  if (String(url).startsWith("https://gmail.googleapis.com/")) {
    const raw = Buffer.from(JSON.parse(opt.body).raw.replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
    sent.push(raw);
    return new Response(JSON.stringify({ id: "m" + sent.length }), { status: 200 });
  }
  return realFetch(url, opt);
};

/* One admin to work with. */
const now = new Date().toISOString();
await s.setJSON("app-accounts", { accounts: { "a-admin": { id: "a-admin", email: "bruce@amabatement.com", name: "Bruce Baker", areas: ["office", "money", "field", "assistants"], level: "admin", active: true, pw: await hashPassword("a good long password"), pwv: now, mustChange: false, createdAt: now, lastSignIn: now } }, settings: { idleHours: 8 } });

const post = (body, tok, ip = "10.0.0.1") => account(new Request("https://x/api/account", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": ip, ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }));
const j = async r => ({ status: r.status, b: await r.json() });
const tokenOf = link => link.split("#invite=")[1];

const login = await j(await post({ action: "login", email: "bruce@amabatement.com", password: "a good long password" }));
assert.equal(login.status, 200); const admin = login.b.token;
ok("admin signs in");

/* 1. Mailbox not connected: the link comes back to show, nothing is emailed. */
let r = await j(await post({ action: "create", name: "Jen Garrison", email: "jen@amabatement.com", title: "Director", areas: ["office", "money", "assistants"], level: "admin", sendInvite: true }, admin));
assert.equal(r.status, 200);
assert.equal(r.b.invite.emailed, false); assert.match(r.b.invite.mailProblem, /not connected/);
assert.match(r.b.invite.link, /^https:\/\/am-office-command-centre\.netlify\.app\/#invite=[A-Za-z0-9_-]{43}$/);
assert.equal(r.b.temp, undefined, "no temporary password is shown when inviting");
assert.ok(r.b.account.invite && !r.b.account.invite.emailed);
assert.ok(Math.abs(Date.parse(r.b.account.invite.expires) - Date.now() - 7 * 86400000) < 60000, "lasts 7 days");
const jenId = r.b.account.id; let link1 = r.b.invite.link;
ok("add and invite with no mailbox: link shown, nothing emailed, 7 days");

/* The link is never stored, only a scramble of it. */
const stored = JSON.stringify(await s.get("app-accounts", { type: "json" }));
assert.ok(!stored.includes(tokenOf(link1)));
ok("only a scramble of the link is kept");

/* 2. Connect the stand-in mailbox and send a new invite. */
await s.setJSON("google-tokens", { refresh_token: "r", access_token: "t", expires_at: Date.now() + 3600000 });
r = await j(await post({ action: "invite", id: jenId }, admin));
assert.equal(r.b.invite.emailed, true); assert.equal(sent.length, 1);
const mail = sent[0];
assert.match(mail, /^To: jen@amabatement\.com$/m); assert.match(mail, /^Reply-To: bruce@amabatement\.com$/m); assert.match(mail, /^Subject: Your A&M app account$/m);
const body = Buffer.from(mail.split("Content-Transfer-Encoding: base64\r\n\r\n")[1].split("\r\n--")[0].replace(/\r\n/g, ""), "base64").toString("utf8");
const link2 = r.b.invite.link;
assert.ok(body.includes(link2)); assert.ok(body.includes("Hi Jen,")); assert.ok(!/\b[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}\b/.test(body), "no temporary password in the email");
assert.ok(!/—/.test(mail), "no em dashes");
ok("invite emailed from the mailbox, reply goes to the admin, link in it, no password");

/* The first link stopped working when the second was made. */
r = await j(await post({ action: "inviteCheck", token: tokenOf(link1) }));
assert.equal(r.status, 404); assert.equal(r.b.error, "invite_gone");
ok("a new invite makes the old link worthless");

/* 3. The person opens the link. */
r = await j(await post({ action: "inviteCheck", token: tokenOf(link2) }));
assert.equal(r.status, 200); assert.equal(r.b.name, "Jen Garrison"); assert.equal(r.b.email, "jen@amabatement.com");
r = await j(await post({ action: "acceptInvite", token: tokenOf(link2), password: "short" }));
assert.equal(r.status, 400);
r = await j(await post({ action: "acceptInvite", token: tokenOf(link2), password: "the shop opens at seven" }));
assert.equal(r.status, 200); assert.ok(r.b.token); assert.equal(r.b.mustChange, false); assert.equal(r.b.account.invite, null);
ok("short password refused; a good one saves and signs her in");

/* She can sign in normally, and the link cannot be used again. */
r = await j(await post({ action: "login", email: "jen@amabatement.com", password: "the shop opens at seven" }));
assert.equal(r.status, 200);
r = await j(await post({ action: "acceptInvite", token: tokenOf(link2), password: "somebody else's sentence" }));
assert.equal(r.status, 404);
ok("signs in with her own password; the link works once only");

/* 4. Expiry. */
r = await j(await post({ action: "create", name: "Amir Faiz", email: "amir@amabatement.com", areas: ["office", "money", "field", "assistants"], level: "admin", sendInvite: true }, admin));
const amirId = r.b.account.id, amirTok = tokenOf(r.b.invite.link);
const doc = await s.get("app-accounts", { type: "json" });
doc.accounts[amirId].invite.exp = new Date(Date.now() - 1000).toISOString();
await s.setJSON("app-accounts", doc);
r = await j(await post({ action: "acceptInvite", token: amirTok, password: "a perfectly good sentence" }));
assert.equal(r.status, 410); assert.equal(r.b.error, "invite_expired");
ok("an expired link is refused and says so");

/* 5. Cancel. */
r = await j(await post({ action: "invite", id: amirId }, admin));
const amirTok2 = tokenOf(r.b.invite.link);
r = await j(await post({ action: "cancelInvite", id: amirId }, admin));
assert.equal(r.status, 200); assert.equal(r.b.account.invite, null);
r = await j(await post({ action: "inviteCheck", token: amirTok2 }));
assert.equal(r.status, 404);
ok("a cancelled invite stops working");

/* 6. Switched off: the link does nothing. */
r = await j(await post({ action: "invite", id: amirId }, admin));
const amirTok3 = tokenOf(r.b.invite.link);
await j(await post({ action: "update", id: amirId, active: false }, admin));
r = await j(await post({ action: "acceptInvite", token: amirTok3, password: "a perfectly good sentence" }));
assert.equal(r.status, 403);
r = await j(await post({ action: "invite", id: amirId }, admin));
assert.equal(r.status, 400);
ok("a switched-off account cannot use or be sent an invite");

/* 7. Only admins invite; nobody invites themselves; junk tokens are refused. */
r = await j(await post({ action: "invite", id: amirId }, (await j(await post({ action: "login", email: "jen@amabatement.com", password: "the shop opens at seven" }))).b.token));
assert.equal(r.status, 400, "Jen is admin, but Amir is switched off");
r = await j(await post({ action: "invite", id: "a-admin" }, admin));
assert.equal(r.status, 400);
r = await j(await post({ action: "invite", id: jenId }));
assert.equal(r.status, 401);
r = await j(await post({ action: "inviteCheck", token: "../../etc" }));
assert.equal(r.status, 404);
ok("no sign-in, no invite; nobody invites themselves; junk links refused");

/* 8. Too many wrong links from one connection is stopped. */
let last;
for (let i = 0; i < 40; i++) last = await post({ action: "inviteCheck", token: "x".repeat(43) }, null, "10.9.9.9");
assert.equal(last.status, 429);
ok("guessing links from one connection is cut off");

/* 9. The old temporary password route still works. */
r = await j(await post({ action: "create", name: "Pat Brost", email: "pat@amabatement.com", areas: ["field"], level: "edit" }, admin));
assert.equal(r.status, 200); assert.match(r.b.temp, /^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/); assert.equal(r.b.account.invite, null);
ok("adding with a temporary password still works");

/* The record shows it all. */
const log = (await s.get("app-accounts-log", { type: "json" })).entries.map(e => e.action);
for (const a of ["invite", "acceptInvite", "cancelInvite"]) assert.ok(log.includes(a), a);
ok("every invite step is in Recent changes");

console.log(`\nAll ${n} invite checks passed.`);
