# Changes 2026-11-20: job numbers link to JobTread, estimators without Dispatch, one branch per person (am-inv-v97)

Asked for by Craig, 20 November 2026. Built on v96 (#33).

## 1. Job numbers in warnings open the job in JobTread
- A warning like "2 won jobs start within a week with no project manager. 26-20026, 26-20097." now links each job number to that job in JobTread, in a new tab. Everywhere warnings show: the banner at the top of a page, Overview's Needs a decision, and On your pages on My day.
- Files: public/command.html

## 2. Estimators do not have Dispatch
- The Dispatch page is gone from an estimator's Office section.
- The server also refuses a crew change from an estimator's account, so it cannot be done round the screen.
- Files: public/command.html, netlify/functions/command.mjs

## 3. One branch per person
- New setting on People and access, Branch: Edmonton and Calgary, Edmonton, or Calgary.
- Not set: Calgary if the job title says Calgary (George), Edmonton for an estimator (Dennis), both for everyone else.
- A person set to one branch sees only that branch's jobs, on every page and through their own Claude. A job's branch is the JobTread field "Estimating branch"; a job with none set counts as Edmonton, as on Payroll and Expenses.
- Their top bar says "Edmonton jobs" or "Calgary jobs".
- Files: netlify/functions/_accounts.mjs, account.mjs, command.mjs, mcp.mjs, public/command.html

## Version
- public/sw.js VERSION am-inv-v97.

## Tested
- All 25 test files pass, including the new branch test (5 checks).
- Headless browser as Dennis, desktop and phone: no Dispatch page, no Calgary job on Estimating, "Edmonton jobs" in the top bar, the job number in the warning links to JobTread. No script errors.
