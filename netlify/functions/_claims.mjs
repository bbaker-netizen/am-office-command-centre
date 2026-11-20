/* A&M - who has taken a lead or estimate (Craig, 2026-11-20).

   Estimators and managers help each other out, so two people could start the
   same estimate. Whoever takes a lead says so, and everyone else sees it.

   Where it is kept: JobTread owns jobs, and every job field is in use (25 of
   25), so "taken by" is a task on the job named "Estimate", assigned to the
   person who took it. The same way Dispatch keeps the crew on the Site Work
   task. It shows in JobTread's own schedule and app too, so there is one
   record, not two. The task's description says who took it and when:
     Taken by Amir Faiz, 2026-11-20 13:30
   _crew.mjs already treats a task called "Estimate" as an office task, so it
   is never mistaken for the crew.

   Pure functions here; the JobTread calls are in command.mjs. */

export const CLAIM_TASK = "Estimate";
export const CLAIM_TASK_RE = /^\s*estimate\s*$/i;
const ID = /^[A-Za-z0-9_-]{2,40}$/;

const norm = s => String(s || "").toLowerCase().replace(/\s+/g, " ").trim();

/* The person's JobTread membership, by name. JobTread names are typed by hand
   ("Craig WIlliams"), so case and spacing do not count. If the full name is
   not there, a first name that only one staff member has will do. Customers
   and vendors are never matched. */
export function membershipFor(name, memberships) {
  const staff = (memberships || []).filter(m => m && m.user && !/^(customer|vendor)$/i.test((m.role && m.role.name) || ""));
  const full = norm(name);
  if (!full) return null;
  const exact = staff.filter(m => norm(m.user.name) === full);
  if (exact.length === 1) return exact[0];
  const first = full.split(" ")[0];
  const byFirst = staff.filter(m => norm(m.user.name).split(" ")[0] === first);
  return byFirst.length === 1 ? byFirst[0] : null;
}

/* A task as JobTread returns it, to a claim. Null when nobody is on it. */
export function parseClaim(t) {
  if (!t || !CLAIM_TASK_RE.test(t.name || "")) return null;
  const people = ((t.assignedMemberships && t.assignedMemberships.nodes) || []).filter(m => m && m.id);
  if (!people.length) return null;
  const m = String(t.description || "").match(/taken by\s+(.+?),\s*(\d{4}-\d{2}-\d{2})(?:\s+(\d{1,2}:\d{2}))?/i);
  return {
    taskId: t.id, jobId: (t.job && t.job.id) || t.jobId || "", jobNumber: (t.job && t.job.number) || "",
    by: people.map(p => (p.user && p.user.name) || "").filter(Boolean).join(", "),
    byIds: people.map(p => p.id),
    at: m ? m[2] + (m[3] ? " " + m[3] : "") : String(t.createdAt || "").slice(0, 10)
  };
}

/* Every claim, keyed by job id. The newest Estimate task on a job wins. */
export function claimsFromTasks(tasks) {
  const out = {};
  for (const t of tasks || []) {
    const c = parseClaim(t);
    if (c && c.jobId && !out[c.jobId]) out[c.jobId] = c;
  }
  return out;
}

/* The description written on the task, keeping anything else people typed. */
export function claimText(name, whenLocal, rest) {
  const keep = String(rest || "").split(/\r?\n/).filter(l => l.trim() && !/^\s*(taken by|let go by)\b/i.test(l));
  return ["Taken by " + name + ", " + whenLocal].concat(keep).join("\n");
}
export function releaseText(name, whenLocal, rest) {
  const keep = String(rest || "").split(/\r?\n/).filter(l => l.trim() && !/^\s*(taken by|let go by)\b/i.test(l));
  return ["Let go by " + name + ", " + whenLocal].concat(keep).join("\n");
}

/* What a take or let-go request is allowed to do. Returns { ok } or
   { ok:false, status, error, message }.
   - Taking a job someone else has: refused unless force (the person said
     "take it over"), and then the other person is named in the answer.
   - Letting go: only your own, unless you are an admin. */
export function decide({ take, force, mine, current, admin }) {
  const others = current && current.byIds && current.byIds.some(id => id !== mine);
  const mineNow = current && current.byIds && current.byIds.includes(mine);
  if (take) {
    if (mineNow && !others) return { ok: true, nothing: true };
    if (others && !force) return { ok: false, status: 409, error: "taken", message: `${current.by} has taken this one (${current.at}). Talk to them first, or take it over.`, by: current.by };
    return { ok: true, from: others ? current.by : "" };
  }
  if (!current) return { ok: true, nothing: true };
  if (!mineNow && !admin) return { ok: false, status: 403, error: "not_yours", message: `${current.by} has this one. Only they, or an admin, can let it go.` };
  return { ok: true };
}

export function cleanClaimBody(b) {
  const jobId = String((b && b.jobId) || "");
  if (!ID.test(jobId)) return null;
  return { jobId, take: b.take !== false, force: !!b.force };
}

/* For the assistant: mail about a job someone else has taken is theirs, not
   this person's. claims is keyed by job id; items carry bid.job (a job number). */
export function applyClaims(items, claims, myName) {
  const byNumber = {};
  Object.values(claims || {}).forEach(c => { if (c.jobNumber) byNumber[String(c.jobNumber).trim()] = c; });
  const me = norm(myName);
  return (items || []).map(it => {
    const n = it && it.bid && String(it.bid.job || "").trim();
    const c = n && byNumber[n];
    if (!c) return it;
    const theirs = !c.by.split(",").map(norm).includes(me);
    if (!theirs) return { ...it, takenBy: "you" };
    return { ...it, takenBy: c.by, bucket: it.bucket === "needs_you" ? "not_yours" : it.bucket, why: c.by + " has taken this estimate", wantsDraft: false };
  });
}
