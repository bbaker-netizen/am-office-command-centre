/* The walkthrough is remembered on the person's account, so it opens on its
   own once per person, not once per browser (Amir, 2026-11-20).
   Run: node --import ./test/support/use-fake-blobs.mjs test/tour-seen.test.mjs */
import { strict as assert } from "node:assert";

process.env.PW_ITER = "1000";
const { default: account } = await import("../netlify/functions/account.mjs");
const { default: command } = await import("../netlify/functions/command.mjs");
const { hashPassword, ACCOUNTS, userOf, toursOf } = await import("../netlify/functions/_accounts.mjs");
const { authStore } = await import("../netlify/functions/_auth.mjs");
const s = authStore();
let n = 0; const ok = m => { n++; console.log("ok", m); };

const now = new Date().toISOString();
const pw = await hashPassword("a good long password");
await s.setJSON(ACCOUNTS, { accounts: {
  c1: { id: "c1", email: "craig@amabatement.com", name: "Craig Williams", areas: ["office", "money", "field", "assistants"], level: "admin", active: true, pw, pwv: now, mustChange: false },
  a1: { id: "a1", email: "amir@amabatement.com", name: "Amir Faiz", areas: ["office", "field", "assistants"], level: "admin", active: true, pw, pwv: now, mustChange: false }
}, settings: { idleHours: 8 } });

const post = (body, tok, extra = {}) => account(new Request("https://x/api/account", { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": "10.0.0.9", ...(tok ? { authorization: "Bearer " + tok } : {}), ...extra }, body: JSON.stringify(body) }));
const login = async email => (await (await post({ action: "login", email, password: "a good long password" })).json()).token;
const amir = await login("amir@amabatement.com"), craig = await login("craig@amabatement.com");
const me = async tok => (await command(new Request("https://x/api/command?part=me", { headers: { authorization: "Bearer " + tok } }))).json();

assert.deepEqual((await me(amir)).tours, {});
ok("a new person has seen no walkthrough");

assert.equal((await post({ action: "tourSeen", keys: ["command-tour.v1"] })).status, 401);
ok("nobody signed out can mark one");

let r = await post({ action: "tourSeen", keys: ["command-tour.v1", "command-whatsnew-2026-11-17"] }, amir);
assert.equal(r.status, 200);
const t = (await r.json()).tours;
assert.ok(t["command-tour.v1"] && t["command-whatsnew-2026-11-17"]);
ok("Amir marks the tour and what's new as seen");

const back = (await me(amir)).tours;
assert.equal(back["command-tour.v1"], t["command-tour.v1"]);
ok("the account tells any browser he has seen it");

assert.deepEqual((await me(craig)).tours, {});
ok("Craig's account is untouched");

const first = t["command-tour.v1"];
await new Promise(res => setTimeout(res, 5));
await post({ action: "tourSeen", key: "command-tour.v1" }, amir);
assert.equal((await me(amir)).tours["command-tour.v1"], first);
ok("marking it twice keeps the first date");

assert.equal((await post({ action: "tourSeen", keys: ["<script>", "../x", ""] }, amir)).status, 400);
const doc = await s.get(ACCOUNTS, { type: "json" });
assert.deepEqual(Object.keys(toursOf(doc.accounts.a1)).sort(), ["command-tour.v1", "command-whatsnew-2026-11-17"]);
ok("only plain walkthrough names are kept");

r = await post({ action: "tourSeen", keys: ["command-tour.v1"] }, craig, { "x-am-view-as": "a1" });
assert.equal(r.status, 403);
ok("viewing as someone cannot mark theirs");

doc.accounts.a1.tours.bad = 5; doc.accounts.a1.tours["Bad Key"] = "x";
assert.deepEqual(Object.keys(userOf(doc.accounts.a1).tours).sort(), ["command-tour.v1", "command-whatsnew-2026-11-17"]);
ok("odd values on the record are not passed on");

await post({ action: "tourReset" }, amir);
assert.deepEqual((await me(amir)).tours, {});
ok("a person can reset their own");

/* Anyone who signed in before v92 has been shown it: it stays shut for them,
   on every computer, even after their next sign-in moves lastSignIn on. */
const { signedInBeforeTours, MAIN_TOUR } = await import("../netlify/functions/_accounts.mjs");
assert.ok(toursOf({ lastSignIn: "2026-11-18T15:00:00Z" })[MAIN_TOUR]);
assert.ok(!toursOf({ lastSignIn: "2026-11-21T15:00:00Z" })[MAIN_TOUR]);
assert.ok(!toursOf({ createdAt: "2026-11-01", mustChange: true, pwv: "2026-11-01T00:00:00Z" })[MAIN_TOUR]);
assert.ok(!signedInBeforeTours({}));
ok("signed in before today's update counts as seen; a brand new person does not");

const before = await s.get(ACCOUNTS, { type: "json" });
before.accounts.c1.lastSignIn = "2026-11-18T15:00:00Z"; delete before.accounts.c1.tours;
await s.setJSON(ACCOUNTS, before);
const craig2 = await login("craig@amabatement.com");
const after = await s.get(ACCOUNTS, { type: "json" });
assert.ok(after.accounts.c1.lastSignIn > "2026-11-20");
assert.ok((await me(craig2)).tours[MAIN_TOUR]);
ok("signing in again keeps it shut: the evidence is written before lastSignIn moves");

console.log(`\n${n} tour-seen checks passed`);
