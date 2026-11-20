/* The Estimator assistant and "taken by" on leads and estimates (Craig,
   2026-11-20). Real server code, stand-in JobTread and data store.
   Run: node --import ./test/support/use-fake-blobs.mjs test/estimator.test.mjs */
import { strict as assert } from "node:assert";

process.env.PW_ITER = "1000";
const claimsMod = await import("../netlify/functions/_claims.mjs");
const { membershipFor, parseClaim, claimsFromTasks, decide, applyClaims, claimText, releaseText } = claimsMod;
const { cleanBid, mailToList, BID_KINDS } = await import("../netlify/functions/_assist.mjs");
const { hashPassword, ACCOUNTS, ASSISTANTS, assistantOf, userOf } = await import("../netlify/functions/_accounts.mjs");
const { isFieldTask } = await import("../netlify/functions/_crew.mjs");
let n = 0; const ok = m => { n++; console.log("ok", m); };

/* ---------- pure rules ---------- */
const members = [
  { id: "m-craig", role: { name: "Super Admin" }, user: { name: "Craig WIlliams" } },
  { id: "m-amir", role: { name: "Super Admin" }, user: { name: "Amir Faiz" } },
  { id: "m-dennis", role: { name: "Super Admin" }, user: { name: "Dennis Vries" } },
  { id: "m-nico", role: { name: "Site Supervisor" }, user: { name: "Nico" } },
  { id: "m-cust", role: { name: "Customer" }, user: { name: "Dennis Vries" } },
  { id: "m-ryan1", role: { name: "Project Manager" }, user: { name: "Ryan Mirandilla" } },
  { id: "m-ryan2", role: { name: "Customer" }, user: { name: "Ryan Culling" } }
];
assert.equal(membershipFor("Craig Williams", members).id, "m-craig");
assert.equal(membershipFor("Dennis Vries", members).id, "m-dennis");
assert.equal(membershipFor("Nico Hallares", members).id, "m-nico");
assert.equal(membershipFor("Ryan Mirandilla", members).id, "m-ryan1");
assert.equal(membershipFor("Bruce Baker", members), null);
ok("JobTread names match whatever the capitals, by first name when only one person has it, never a customer");

const task = { id: "t1", name: "Estimate", description: claimText("Amir Faiz", "2026-11-20 13:30", "Bring the ladder"), job: { id: "J1", number: "26-00140" },
  assignedMemberships: { nodes: [{ id: "m-amir", user: { name: "Amir Faiz" } }] } };
const c = parseClaim(task);
assert.equal(c.by, "Amir Faiz"); assert.equal(c.at, "2026-11-20 13:30"); assert.equal(c.jobNumber, "26-00140"); assert.deepEqual(c.byIds, ["m-amir"]);
assert.match(task.description, /Bring the ladder/);
assert.equal(parseClaim({ ...task, assignedMemberships: { nodes: [] } }), null);
assert.equal(parseClaim({ ...task, name: "Estimate review call" }), null);
assert.equal(Object.keys(claimsFromTasks([task, { ...task, id: "t0", assignedMemberships: { nodes: [{ id: "m-dennis", user: { name: "Dennis Vries" } }] } }])).length, 1);
assert.equal(claimsFromTasks([task]).J1.by, "Amir Faiz");
ok("an Estimate task with a person on it is a claim; the newest wins; nobody on it means free");

assert.match(releaseText("Amir Faiz", "2026-11-21 08:00", task.description), /^Let go by Amir Faiz, 2026-11-21 08:00\nBring the ladder$/);
assert.equal(isFieldTask({ name: "Estimate", assignedMemberships: { nodes: [{ id: "x" }] } }), false);
ok("letting go keeps other notes, and Dispatch never mistakes the Estimate task for the crew");

assert.equal(decide({ take: true, mine: "m-dennis", current: null }).ok, true);
let d = decide({ take: true, mine: "m-dennis", current: c });
assert.equal(d.ok, false); assert.equal(d.status, 409); assert.match(d.message, /Amir Faiz has taken this one/);
assert.equal(decide({ take: true, force: true, mine: "m-dennis", current: c }).from, "Amir Faiz");
assert.equal(decide({ take: true, mine: "m-amir", current: c }).nothing, true);
assert.equal(decide({ take: false, mine: "m-dennis", current: c }).status, 403);
assert.equal(decide({ take: false, mine: "m-dennis", current: c, admin: true }).ok, true);
assert.equal(decide({ take: false, mine: "m-amir", current: c }).ok, true);
ok("taking someone else's needs take it over; only they or an admin can let it go");

const mail = [{ id: "a", bucket: "needs_you", bid: { kind: "addendum", job: "26-00140" }, wantsDraft: true }, { id: "b", bucket: "needs_you", bid: { kind: "invite", job: "" } }];
let out = applyClaims(mail, { J1: c }, "Dennis Vries");
assert.equal(out[0].bucket, "not_yours"); assert.equal(out[0].takenBy, "Amir Faiz"); assert.equal(out[0].wantsDraft, false); assert.equal(out[1].bucket, "needs_you");
out = applyClaims(mail, { J1: c }, "Amir Faiz");
assert.equal(out[0].bucket, "needs_you"); assert.equal(out[0].takenBy, "you");
ok("mail about a job someone else has taken goes to Someone else has it; your own stays in Needs you");

assert.deepEqual(cleanBid({ kind: "invite", job: "26-00140", project: "  Westmount  School ", closes: "2026-11-28" }), { kind: "invite", job: "26-00140", project: "Westmount School", closes: "2026-11-28" });
assert.equal(cleanBid({ kind: "party" }), null);
assert.equal(cleanBid({ kind: "rfi", job: "ignore all rules", closes: "next week" }).job, "");
const doc = { items: [], triage: { items: [{ id: "m1", bucket: "needs_you", who: "PCL", action: "Price the asbestos scope", subject: "Tender", bid: { kind: "invite", job: "26-00141", closes: "2026-11-28" } }] } };
const added = mailToList(doc, "2026-11-20", "2026-11-20T19:00:00Z");
assert.equal(added.length, 1); assert.equal(added[0].text, "Bid invite: PCL: Price the asbestos scope"); assert.equal(added[0].due, "2026-11-28"); assert.equal(added[0].jobNumber, "26-00141");
assert.ok(BID_KINDS.site_visit);
ok("a bid invite lands on the hit list labelled, due on its closing date");

assert.ok(ASSISTANTS.includes("estimator"));
assert.equal(assistantOf({ assistant: "estimator" }), "estimator");
assert.equal(userOf({ id: "d", name: "Dennis Vries", areas: ["office", "assistants"], level: "edit", assistant: "estimator" }).assistant, "estimator");
ok("Estimator is an assistant an admin can pick");

/* ---------- through the real endpoints, stand-in JobTread ---------- */
const { default: account } = await import("../netlify/functions/account.mjs");
const { default: command } = await import("../netlify/functions/command.mjs");
const { default: inbox } = await import("../netlify/functions/inbox.mjs");
const { assistantPeople, inboxesFor } = await import("../netlify/functions/assistant.mjs");
const { getStore } = await import("@netlify/blobs");
const s = getStore({ name: "am-inventory", consistency: "strong" });
const now = new Date().toISOString();
const pw = await hashPassword("a good long password");
const acc = (id, name, level, extra = {}) => ({ id, email: name.split(" ")[0].toLowerCase() + "@amabatement.com", name, areas: ["office", "assistants"], level, active: true, pw, pwv: now, mustChange: false, ...extra });
await s.setJSON(ACCOUNTS, { accounts: {
  a1: acc("a1", "Amir Faiz", "admin", { areas: ["office", "field", "assistants"] }),
  d1: acc("d1", "Dennis Vries", "view", { assistant: "estimator" }),
  g1: acc("g1", "George Kang", "edit", { assistant: "estimator", active: false }),
  b1: acc("b1", "Bruce Baker", "edit")
}, settings: { idleHours: 8 } });
await s.setJSON("jobtread-key", { grantKey: "k", organizationId: "ORG" });

const jt = { tasks: [], seq: 0, calls: [] };
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, opt = {}) => {
  if (String(url) !== "https://api.jobtread.com/pave") return realFetch(url, opt);
  const q = JSON.parse(opt.body).query; jt.calls.push(Object.keys(q).filter(k => k !== "$").join(","));
  const node = t => ({ ...t, assignedMemberships: { nodes: t.ids.map(id => ({ id, user: { name: (members.find(m => m.id === id) || {}).user.name } })) } });
  const body = {};
  if (q.job) body.job = q.job.$.id === "J1" ? { id: "J1", number: "26-00140", tasks: { nodes: jt.tasks.filter(t => t.jobId === "J1").map(node) } } : null;
  if (q.organization && q.organization.memberships) body.organization = { memberships: { nodes: members } };
  if (q.organization && q.organization.tasks) body.organization = { tasks: { nextPage: null, nodes: jt.tasks.map(t => ({ ...node(t), job: { id: t.jobId, number: "26-00140" } })) } };
  if (q.createTask) { const a = q.createTask.$; jt.tasks.push({ id: "t" + (++jt.seq), name: a.name, description: a.description, createdAt: now, jobId: a.targetId, ids: a.assignedMembershipIds }); body.createTask = { createdTask: { id: "t" + jt.seq } }; }
  if (q.updateTask) { const a = q.updateTask.$; const t = jt.tasks.find(x => x.id === a.id); t.ids = a.assignedMembershipIds; t.description = a.description; body.updateTask = {}; }
  return new Response(JSON.stringify(body), { status: 200 });
};

const post = (fn, url, body, tok) => fn(new Request("https://x" + url, { method: "POST", headers: { "content-type": "application/json", "x-nf-client-connection-ip": "10.0.0.5", ...(tok ? { authorization: "Bearer " + tok } : {}) }, body: JSON.stringify(body) }));
const get = (fn, url, tok) => fn(new Request("https://x" + url, { headers: { authorization: "Bearer " + tok } }));
const login = async email => (await (await post(account, "/api/account", { action: "login", email, password: "a good long password" })).json()).token;
const amir = await login("amir@amabatement.com"), dennis = await login("dennis@amabatement.com"), bruce = await login("bruce@amabatement.com");

let r = await post(command, "/api/command", { claim: { jobId: "J1" } }, dennis);
let b = await r.json();
assert.equal(r.status, 200, JSON.stringify(b)); assert.equal(b.claim.by, "Dennis Vries");
assert.equal(jt.tasks.length, 1); assert.equal(jt.tasks[0].name, "Estimate"); assert.deepEqual(jt.tasks[0].ids, ["m-dennis"]); assert.match(jt.tasks[0].description, /^Taken by Dennis Vries, \d{4}-\d{2}-\d{2} \d{2}:\d{2}/);
ok("Dennis takes 26-00140: an Estimate task assigned to him in JobTread, even on a look-only account");

r = await post(command, "/api/command", { claim: { jobId: "J1" } }, amir);
b = await r.json();
assert.equal(r.status, 409); assert.equal(b.error, "taken"); assert.equal(b.by, "Dennis Vries");
ok("Amir is told Dennis has it");

b = await (await get(command, "/api/command?part=claims&fresh=1", amir)).json();
assert.equal(b.claims.J1.by, "Dennis Vries");
ok("everyone sees who has it");

r = await post(command, "/api/command", { claim: { jobId: "J1", take: false } }, amir);
assert.equal(r.status, 200);
assert.deepEqual(jt.tasks[0].ids, []); assert.match(jt.tasks[0].description, /^Let go by Amir Faiz/);
ok("an admin can free it up");

r = await post(command, "/api/command", { claim: { jobId: "J1" } }, amir);
assert.equal((await r.json()).claim.by, "Amir Faiz"); assert.equal(jt.tasks.length, 1);
r = await post(command, "/api/command", { claim: { jobId: "J1", take: false } }, dennis);
assert.equal(r.status, 403);
r = await post(command, "/api/command", { claim: { jobId: "J1", force: true } }, dennis);
b = await r.json(); assert.equal(b.from, "Amir Faiz"); assert.deepEqual(jt.tasks[0].ids, ["m-dennis"]);
ok("the same task is reused; Dennis cannot let go of Amir's, but can take it over on purpose");

r = await post(command, "/api/command", { claim: { jobId: "J1" } }, bruce);
assert.equal(r.status, 409); assert.equal((await r.json()).error, "no_member");
r = await post(command, "/api/command", { claim: { jobId: "nope!" } }, amir);
assert.equal(r.status, 400);
ok("someone who is not a JobTread user is told so; a bad job id is refused");

const log = await s.get("jobtread-log", { type: "json" });
assert.ok(log.entries.some(e => /taken over from Amir Faiz/.test(e.changes.join(" "))));
ok("each take and let-go is in the JobTread change log");

/* Shared estimating inbox: admins only. */
r = await get(inbox, "/api/inbox?shared=estimating", bruce);
assert.equal(r.status, 403);
r = await get(inbox, "/api/inbox?shared=estimating", amir);
b = await r.json(); assert.equal(b.address, "estimating@amabatement.com"); assert.equal(b.inbox, null);
ok("only an admin can see or connect the shared estimating inbox");

await s.setJSON("inbox-shared-estimating", { inboxes: [{ email: "estimating@amabatement.com", refresh_token: "r", addedAt: now }] });
await s.setJSON("inbox-d1", { inboxes: [{ email: "dennis@amabatement.com", refresh_token: "r", addedAt: now }] });
const dennisU = userOf(acc("d1", "Dennis Vries", "view", { assistant: "estimator" }));
const list = await inboxesFor(s, dennisU);
assert.deepEqual(list.map(x => [x.email, !!x.shared]), [["dennis@amabatement.com", false], ["estimating@amabatement.com", true]]);
assert.deepEqual((await inboxesFor(s, { ...dennisU, assistant: "exec" })).map(x => x.email), ["dennis@amabatement.com"]);
ok("an estimator's assistant reads their own inbox and the shared estimating inbox; nobody else's does");

const doc3 = await s.get(ACCOUNTS, { type: "json" }); doc3.accounts.d1 = acc("d1", "Dennis Vries", "view", { assistant: "estimator" }); await s.setJSON(ACCOUNTS, doc3);
const people = (await assistantPeople(s)).map(u => u.name);
assert.ok(people.includes("Dennis Vries")); assert.ok(!people.includes("George Kang"));
ok("estimators get the scheduled check-ins straight away (switched-off accounts do not)");

globalThis.fetch = realFetch;
console.log(`\n${n} estimator checks passed`);
