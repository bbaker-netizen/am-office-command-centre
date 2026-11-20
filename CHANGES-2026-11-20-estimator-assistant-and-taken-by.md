# Changes 2026-11-20: Estimator assistant, "taken by" on leads and estimates (am-inv-v93)

Asked for by Craig, 20 November 2026.

## 1. Estimator assistant
- A third kind of personal assistant, beside Executive and Project: Estimator (bids, quotes, site visits). Pick it per person on People and access. Live straight away, with no switch to turn on.
- Same My day as the executive one: check-ins at 7, noon and 5, the hit list, Talk, sticky notes, inbox sorting with reply drafts, calendar. Nothing is ever sent without the person pressing send.
- Its mail sorting knows the estimating work: bid invites and tenders, addenda, RFIs, site visits being set up, and clients answering a quote. Each is labelled, goes in Needs you, and lands on the hit list due on its closing or visit date. A bid invite gets no drafted reply (the documents are read first).
- The executive rule "estimating mail is not yours" no longer applies to estimators.
- My day for an estimator also shows: Taken by you, Bids closing (two weeks, quote not out), Leads nobody has taken, Quotes with no answer (with Follow up, which starts a three-day chase), and Site visits this week.
- Files: netlify/functions/assistant.mjs, _assist.mjs, _accounts.mjs, public/command.html

## 2. Shared estimating inbox
- Admin, Connections has a new card, Estimating inbox. An admin connects estimating@amabatement.com once (its Google password is needed). Every estimator's assistant then sorts it with their own inbox. It is not anyone's own inbox, so nobody can remove it from My day. Address set by ESTIMATING_INBOX, default estimating@amabatement.com.
- Files: netlify/functions/inbox.mjs, _gmail.mjs, assistant.mjs, public/command.html

## 3. "Taken by" on leads and estimates
- Anyone in the office or field (look-only accounts too) can Take a lead or estimate. Everyone else sees who has it: a tag beside every job on Estimating and on My day, and a panel at the top of the job.
- Kept in JobTread, not a second list: an "Estimate" task on the job, assigned to the person, with "Taken by Name, date time" in its description. Every job field is in use, so this follows the crew plan's Site Work task. Dispatch already ignores a task named Estimate.
- Trying to take one someone else has says "Amir Faiz has taken this one. Talk to them first, or take it over." Take it over needs a second press. Only the person, or an admin, can let it go. Every take and let-go is in the JobTread change log.
- An estimator's mail about a job someone else has taken goes to "Someone else has it", not Needs you.
- The person must be a JobTread user under the same name (capitals do not matter). If not, they are told so.
- Files: netlify/functions/_claims.mjs (new), command.mjs, assistant.mjs, public/command.html

## 4. Walkthrough stays shut for people who already had it
- Anyone who signed in before v92 went live counts as having seen the main walkthrough, on every computer. Written to their account at their next sign-in, before the sign-in date moves on. The Tour button still replays it.
- Files: netlify/functions/_accounts.mjs, account.mjs

## Version
- public/sw.js VERSION am-inv-v93.

## Tested
- All 21 test files pass, including new estimator (17), estimator-mail (5) and two new tour-seen checks (12).
- Headless browser, desktop and phone, stand-in data: estimator My day, Take it, Take it over, the job panel, Estimating tags, shared inbox listing. No script errors.

## After merge
- Admin, Connections: connect the estimating inbox.
- People and access: set Dennis and George to Estimator. George's account is needed first if he has none.
- Each estimator connects their own inbox on My day (Connect my inbox) with the calendar box ticked.
