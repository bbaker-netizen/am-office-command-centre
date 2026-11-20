# Changes 2026-11-20: an assistant for every position, tidier shop PIN list (am-inv-v95)

Asked for by Craig, 20 November 2026.

## 1. Everyone has an assistant, set up for their position
- "None" is gone. Each person's assistant is picked from their job title, then from what they see, so nobody is left without one. An admin can still pick another on People and access. A new person starts on "Picked from their job title".
- Eleven positions, from the organizational chart of 10 October 2026: Executive, Operations Director, Estimator, Project Manager, Project Coordinator and Dispatcher, Administrator, Accounting and Payroll, Health and Safety, Business Development and Sales, Shop and Logistics, Site Superintendent or Supervisor.
- Every one has the same base: My day, check-ins at 7, noon and 5, the hit list, Talk, sticky notes, inbox sorting with reply drafts, and the calendar.
- What changes by position: the mail sort is told who they are, what needs them most, and what mail is someone else's. My day shows "On your pages", meaning the problems flagged on the pages that position works in (for example Dispatch, Sites, Equipment and Projects for the dispatcher). Project managers keep their Closeout card. Estimators, sales and the Operations Director get the bids, leads and quotes cards. Accounting gets the money cards and has payments matched against its sticky notes, like the executives.
- All assistants are on straight away, including the project assistant that was held back for staff. The hold switch and the preview page are gone.
- Files: netlify/functions/_roles.mjs (new), _accounts.mjs, assistant.mjs, account.mjs, public/command.html

## 2. Shop, Who can use it: tidy list
- One line per person: the name, a small "PIN set" or "No PIN" tag, when it was issued, and one Actions list (Issue or Reset the PIN, Take access away or Turn it back on, Remove from the list when the name never did anything).
- Taking access away now asks first, because a slip on a drop-down is easier than on a button.
- Same actions and same rules as before; the old buttons still run the code behind the list.
- Files: public/office.js, public/styles.css

## Version
- public/sw.js VERSION am-inv-v95.

## Tested
- All 23 test files pass, including the new roles test (5 checks), Brenda's role-aware sort in estimator-mail, and the assistant test updated for "everyone has one".
- Headless browser, desktop and phone: the dispatcher's My day with On your pages, the People and access list of positions, and the shop PIN list with each action (Issue, Reset, Take away with its question, Remove). No script errors.
