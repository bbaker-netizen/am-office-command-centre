# Changes 2026-11-10: fixes from the 6 November session

Phone version am-inv-v72.

## Dispatch: "request is too large" and "Crew not loaded"

The crew board asked JobTread for up to 40 jobs, each with 25 tasks and their people, in one request. JobTread refuses a request that big, so every crew failed at once, while Settings, Connections still said JobTread was fine (its own check is a small request).

Now the page asks for 30 jobs a call, and the server asks JobTread 6 jobs at a time. If JobTread still refuses a batch, it is split in half and tried again. A single job it still refuses says "JobTread would not send this job's schedule" and the rest of the board loads.

## Dispatch: the right crew on each job

The app only looked for a task called "Site Work" or "Crew". On McCurdy (26-00662) the only one was September's change order, so it showed Carlos from 21 September, although the crew has been on "Abatement Clean up", "Ceiling and Duct clean" and "Main Floor Clean".

Now it picks the field task that covers today, then the next one coming up, then the most recent one with people on it. Office tasks (File NOP, Book air monitoring, Inform client and similar) are never the crew. Each job on the board says which JobTread task its crew came from.

## Refresh now reloads crews

Refresh read the jobs again but kept the crews it already had, so a crew change in JobTread did not show. It now reads both.

## Job Post Mortem jobs leave Projects, Field and Closeout

Farmers Market (26-00109) is at Job Post Mortem in JobTread. The app counted that as "closing out", so it kept showing. Job Post Mortem jobs now show only on the Post mortem page. They still count as won in the win rate.

## George's jobs show as subcontracted

George's jobs have no crew numbers, schedule or subcontract orders in JobTread, so they showed zero crew and question marks. Jobs whose PM is George now show "Sub" and "Subcontracted" on Sites, and stay off the crew board. The list is SUBBED_PMS in public/command.html.

## Cash: each bank account on its own line

Money now lists every bank account under the cash figure, with a note that these are QuickBooks balances, not the bank's. On 2026-11-10 the bank accounts add up to -$514,433 in QuickBooks, mostly BMO Business Chequing at -$563,087. The app was reporting QuickBooks correctly. A different figure on another screen most likely came from the older Claude-side page, which reads cash through Claude's QuickBooks connector.

## Ask Claude: plain message when the key is refused

When Anthropic refuses the key (or the account is out of credit), the person now sees that it is the company's ANTHROPIC_API_KEY setting in Netlify, not something they did. There is one key for everyone.

## Not changed by code

- Notice of project flags were checked against JobTread and are correct: Victorian Arms (26-00640), Williams Hall (25-00578) and Suzuki School (26-20080) have no NOP Filed date, and McCurdy's NOP expired 2026-11-06 while still at Site work.

## Files

New: netlify/functions/_crew.mjs, test/crew.test.mjs (9 checks).
Changed: netlify/functions/command.mjs, netlify/functions/_qboreports.mjs, netlify/functions/claude.mjs, public/command.html, public/sw.js.

## Tests

node test/crew.test.mjs. Encircle, invite and payroll tests still pass.
