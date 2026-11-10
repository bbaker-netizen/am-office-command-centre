/* A&M - which JobTread task holds a job's crew, and how to ask JobTread for
   many jobs' crews without being refused.

   Pure functions only, so the rules can be tested without JobTread.

   Why this changed (2026-11-10):
   - Dispatch showed "request is too large" and "Crew not loaded". The crew
     board asked for up to 40 jobs, each with 25 tasks and their people, in one
     request, and JobTread refuses a request that big. Now it asks a few jobs at
     a time (BATCH), and a refused batch is split in half and tried again, so
     one heavy job cannot blank the whole board.
   - McCurdy showed September's change order as its crew. The old rule only
     looked for a task named "Site Work" or "Crew". PMs also schedule the crew on
     tasks like "Abatement start", "Abatement Clean up" or "Main Floor Clean".
     The rule now picks the field task that covers today, then the next one
     coming up, then the most recent one. Office tasks such as "File NOP",
     "Book air monitoring" or "Inform client" are never treated as the crew. */

export const BATCH = 6;
export const CREW_TASK = /site\s*work|crew/i;
export const OFFICE_TASK = /\b(book|file|filing|inform|notice|nop|invoice|invoicing|estimate|quote|order|po|air monitoring|clearance|submittal|post mortem|review|call|email|send|permit|paperwork|turnover meeting|walkthrough|walk through|site visit)\b/i;

const day = v => (v ? String(v).slice(0, 10) : "");
const people = t => ((t && t.assignedMemberships && t.assignedMemberships.nodes) || []).length;

/* A task the crew works on: not an office task. A task with nobody on it and
   no date says nothing about the crew, so it only counts if it is the named
   Site Work task (the one Dispatch writes to). */
export function isFieldTask(t) {
  const name = String((t && t.name) || "");
  if (OFFICE_TASK.test(name) && !CREW_TASK.test(name)) return false;
  return CREW_TASK.test(name) || people(t) > 0 || !!day(t && t.startDate);
}

export function pickTask(tasks, today) {
  const list = (tasks || []).filter(isFieldTask);
  if (!list.length) return null;
  const t0 = today || new Date().toISOString().slice(0, 10);
  const start = t => day(t.startDate), end = t => day(t.endDate) || day(t.startDate);
  const byPeople = (a, b) => people(b) - people(a) || (CREW_TASK.test(b.name || "") - CREW_TASK.test(a.name || ""));

  /* 1. On today. */
  const now = list.filter(t => start(t) && start(t) <= t0 && end(t) >= t0).sort(byPeople);
  if (now.length) return now[0];
  /* 2. The next one coming up. */
  const next = list.filter(t => start(t) && start(t) > t0).sort((a, b) => start(a).localeCompare(start(b)) || byPeople(a, b));
  if (next.length) return next[0];
  /* 3. The most recent one with people on it. */
  const past = list.filter(t => start(t) && people(t) > 0).sort((a, b) => end(b).localeCompare(end(a)) || byPeople(a, b));
  if (past.length) return past[0];
  /* 4. An undated Site Work task, which is where Dispatch writes a new crew. */
  return list.find(t => CREW_TASK.test(t.name || "")) || null;
}

export function chunk(ids, size = BATCH) {
  const out = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

export const tooLarge = e => /too large|entity too large|413/i.test(String((e && e.message) || e || ""));

/* Ask for each batch in turn. If JobTread says a batch is too large, split it
   and try the halves. A single job that is still refused is left out and
   named, instead of failing every other job. */
export async function readInBatches(ids, ask, size = BATCH) {
  const found = {}, failed = [];
  const run = async group => {
    try { Object.assign(found, await ask(group)); }
    catch (e) {
      if (tooLarge(e) && group.length > 1) {
        const mid = Math.ceil(group.length / 2);
        await run(group.slice(0, mid));
        await run(group.slice(mid));
      } else if (tooLarge(e)) failed.push(group[0]);
      else throw e;
    }
  };
  for (const g of chunk(ids, size)) await run(g);
  return { found, failed };
}
