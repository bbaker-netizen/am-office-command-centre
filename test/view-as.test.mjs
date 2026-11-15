/* View as: an admin sees the command centre as another person does, look only.
   Run: node --import ./test/support/use-fake-blobs.mjs test/view-as.test.mjs */
import { strict as assert } from "node:assert";
import { viewAsProblem, userOf, accountGate, ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { authStore, signToken } from "../netlify/functions/_auth.mjs";

let n = 0; const ok = m => { n++; console.log("ok", m); };
const craig = { id: "c1", name: "Craig Williams", email: "craig@amabatement.com", areas: ["office", "money", "payroll", "field", "assistants"], level: "admin", pwv: "1" };
const amir = { id: "a1", name: "Amir Faiz", email: "amir@amabatement.com", title: "General Manager", areas: ["office", "field", "assistants"], level: "admin", pwv: "1", claude: true };
const dennis = { id: "d1", name: "Dennis Vries", email: "dennis@amabatement.com", areas: ["office", "assistants"], level: "edit", pwv: "1" };
const gone = { id: "g1", name: "Old Account", areas: ["field"], level: "view", active: false };

const U = a => userOf(a, { idleHours: 8 });
assert.equal(viewAsProblem(U(dennis), amir, "GET", "/api/command?part=me").error, "role");
ok("only an admin can view as someone else");
assert.equal(viewAsProblem(U(craig), gone, "GET", "/api/command?part=me").status, 404);
assert.equal(viewAsProblem(U(craig), undefined, "GET", "/api/command?part=me").status, 404);
ok("not for a switched-off or missing account");
for (const m of ["POST", "PUT", "DELETE", "PATCH"]) assert.equal(viewAsProblem(U(craig), amir, m, "/api/command").error, "view_only");
ok("nothing but reads: saves, sends, posts and deletes are refused on the server");
assert.equal(viewAsProblem(U(craig), amir, "GET", "/api/drive?action=job&number=26-00109").error, "view_only");
assert.equal(viewAsProblem(U(craig), amir, "GET", "/api/drive").error, "view_only");
for (const a of ["start", "connect", "callback", "disconnect", "forget"]) assert.equal(viewAsProblem(U(craig), amir, "GET", "/api/mail?action=" + a).error, "view_only");
ok("their own Google Drive and any connect or sign-in step stay closed");
assert.equal(viewAsProblem(U(craig), amir, "GET", "/api/command?part=jobs"), null);
assert.equal(viewAsProblem(U(craig), dennis, "GET", "/api/mail?action=list"), null);
ok("plain reads go through");

/* Through the real gate, with a real signed token. */
const s = authStore();
await s.setJSON(ACCOUNTS, { accounts: { c1: craig, a1: amir, d1: dennis, g1: gone }, settings: { idleHours: 8, payrollSplit: true } });
const tok = await signToken(s, { k: "acct", a: "c1", v: "1", t: Date.now(), m: 0 });
const req = (method, url, extra = {}) => new Request("https://site" + url, { method, headers: { authorization: "Bearer " + tok, ...extra }, body: method === "GET" ? undefined : "{}" });

let r = req("GET", "/api/command?part=me", { "x-am-view-as": "a1" });
assert.equal(await accountGate(r, s), null);
assert.equal(r.amUser.name, "Amir Faiz"); assert.deepEqual(r.amUser.areas, amir.areas);
assert.equal(r.amUser.edit, false); assert.equal(r.amUser.admin, false); assert.equal(r.amUser.claude, false);
assert.equal(r.amUser.shownLevel, "admin"); assert.equal(r.amUser.viewAs.byName, "Craig Williams"); assert.equal(r.amReal.id, "c1");
ok("Craig viewing as Amir gets Amir's sections, with editing, admin and Ask Claude off");

r = req("POST", "/api/command", { "x-am-view-as": "a1" });
const res = await accountGate(r, s);
assert.equal(res.status, 403); assert.match((await res.json()).message, /viewing as Amir/);
ok("a save sent while viewing as Amir is refused with a plain message");

r = req("GET", "/api/command?part=me");
assert.equal(await accountGate(r, s), null); assert.equal(r.amUser.name, "Craig Williams"); assert.equal(r.amUser.admin, true);
ok("without View as, Craig is himself, unchanged");

const dtok = await signToken(s, { k: "acct", a: "d1", v: "1", t: Date.now(), m: 0 });
r = new Request("https://site/api/command?part=me", { headers: { authorization: "Bearer " + dtok, "x-am-view-as": "c1" } });
assert.equal((await accountGate(r, s)).status, 403);
ok("Dennis cannot use the header to see Craig's money");

console.log(`\n${n} view-as checks pass`);
