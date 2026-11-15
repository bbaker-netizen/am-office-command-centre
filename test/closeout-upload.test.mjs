/* A document from a phone into the job's Files in JobTread, and the closeout
   read, through the command centre's server with a stand-in JobTread.
   Run: node --import ./test/support/use-fake-blobs.mjs test/closeout-upload.test.mjs */
import { strict as assert } from "node:assert";
import { getStore } from "@netlify/blobs";
import { ACCOUNTS } from "../netlify/functions/_accounts.mjs";
import { signToken } from "../netlify/functions/_auth.mjs";
import handler from "../netlify/functions/command.mjs";
let n = 0; const ok = m => { n++; console.log("ok", m); };

const s = getStore({ name: "am-inventory", consistency: "strong" });
await s.setJSON(ACCOUNTS, { accounts: { p1: { id: "p1", name: "Paul Manager", areas: ["field"], level: "edit", pwv: "1" }, v1: { id: "v1", name: "Val Viewer", areas: ["field"], level: "view", pwv: "1" } }, settings: { idleHours: 8, payrollSplit: true } });
await s.setJSON("jobtread-key", { grantKey: "k", organizationId: "org1" });
const calls = [];
globalThis.fetch = async (url, opts = {}) => {
  const u = String(url), j = b => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
  if (u.includes("storage.test")) { calls.push({ put: opts.body.length }); return new Response("", { status: 200 }); }
  const q = JSON.parse(opts.body).query; calls.push(Object.keys(q).filter(k => k !== "$"));
  if (q.createUploadRequest) return j({ createUploadRequest: { createdUploadRequest: { id: "up1", url: "https://storage.test/x", method: "PUT", headers: { "Content-Type": "application/pdf" } } } });
  if (q.createFile) { assert.equal(q.createFile.$.targetId, "job1"); assert.equal(q.createFile.$.folder, "Subcontractor invoices"); return j({ createFile: { createdFile: { id: "f1", name: q.createFile.$.name } } }); }
  if (q.j0) return j({ j0: { id: "job1", documents: { nodes: [{ type: "vendorBill", status: "draft", account: { name: "Rentals Co" } }] }, timeEntries: { nodes: [{ startedAt: "2026-11-02T15:00:00Z" }] } } });
  throw new Error("unexpected");
};
const tok = a => signToken(s, { k: "acct", a, v: "1", t: Date.now(), m: 0 });
const post = async (who, body) => { const r = await handler(new Request("https://site/api/command", { method: "POST", headers: { authorization: "Bearer " + await tok(who), "content-type": "application/json" }, body: JSON.stringify(body) })); return { status: r.status, body: await r.json() }; };
const pdf = "data:application/pdf;base64," + Buffer.from("%PDF-1.4 test").toString("base64");

let r = await post("v1", { upload: { jobId: "job1", name: "Sub invoice.pdf", dataUrl: pdf, folder: "Subcontractor invoices" } });
assert.equal(r.status, 403);
r = await post("p1", { upload: { jobId: "job1", name: "Sub invoice.pdf", dataUrl: pdf, folder: "Subcontractor invoices" } });
assert.equal(r.status, 200, JSON.stringify(r.body)); assert.equal(r.body.folder, "Subcontractor invoices");
assert.deepEqual(calls.slice(0, 3).map(c => c.put ? "put" : c[0]), ["createUploadRequest", "put", "createFile"]);
const log = await s.get("jobtread-log", { type: "json" }); assert.equal(log.entries[0].by, "Paul Manager");
r = await post("p1", { upload: { jobId: "job1", name: "site.jpg", dataUrl: "data:image/jpeg;base64,AAAA", photo: true } });
assert.equal(r.status, 400); assert.match(r.body.message, /Encircle/);
ok("a PM's document goes into the job's Files in JobTread (ask, send, attach) and is logged; look-only accounts cannot; site photos are sent to Encircle");

const g = await handler(new Request("https://site/api/command?part=closeout&ids=job1&po=Outstanding", { headers: { authorization: "Bearer " + await tok("p1") } }));
const cl = (await g.json()).closeout.job1;
assert.deepEqual(cl.missing, ["Client PO outstanding", "No quote in JobTread", "1 bill still in draft"]); assert.equal(cl.finished, "2026-11-02");
ok("the closeout read names what is missing on the job and the last day worked");

console.log(`\n${n} upload checks pass`);
