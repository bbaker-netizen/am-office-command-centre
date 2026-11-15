# Changes 2026-11-15: payroll journal on Danielle's rules, expenses by city and division

Phone version am-inv-v79. Part 4 of Bruce's brief for session 2.

The payroll split on Office, Payroll already did most of this (hours from JobTread, Edmonton and Calgary, Ryan and Maxim left out, a journal entry from the net pay). This brings it in line with "Journal hours by cost code", the process Craig and Danielle built the week of 2 November, and with the workbook Danielle accepted on 9 November.

## Rules changed to Danielle's

- **Service line comes from the job's Job Type**, not the cost code on each hour. Danielle's rule: if a job could fit two types (asbestos work on a mitigation job), it stays under the job's type. Mitigation is the Restoration line (59100 "Mitigation labour"). If a job has no Job Type, the cost code decides and the job is listed so it can be fixed.
- **Pay periods are A&M's real ones**: Saturday 19 September to Friday 2 October (paid 9 October), then every two weeks. The app had them starting 28 September (the day JobTread time began). A saved 28 September start is moved once. Anyone who chooses a date on purpose keeps it.
- **Calgary jobs worked by the Edmonton crew** is a setting. Craig's 6 November run counted them as Edmonton. Bruce asked for this to be confirmed with Craig first, so the default is the job's city (Calgary). The hours affected are always listed with how they were counted. Switch to "Edmonton (the crew's home city)" once Craig confirms. Calgary-based people can be named so they stay Calgary.

## Catch up from 19 September

- A new **Pay periods since 19 September** card lists every period with its pay date and status.
- The first three (paid 9 Oct, 23 Oct and 6 Nov) are marked **posted by Danielle from Craig's 6 Nov workbook** ($75,495.91 in all). Period 1 mixed Canopy and JobTread hours, which the app cannot read, and Danielle posted all three on 10 November.
- Recording them as posted means the app will never post them a second time.
- 31 October to 13 November (paid 20 November) is the next one to do.

## Workbook for Danielle

A new **Workbook for Danielle** button downloads a real Excel file for the pay period: "Payroll journal by cost code - (period end).xlsx", in the layout of Craig's 6 November workbook:
- Journal entry (account, bucket, debit, credit, line description, totals, difference must be zero)
- By cost code (regular, overtime, total hours)
- By employee
- Net pay by cost code (each person's net pay spread by share of pay hours)
- Hours data (every person, job and cost code)
- Left out (salaried, subcontractors, agency temps, and Edmonton crew on Calgary jobs)

Danielle posts it herself. The existing Post to QuickBooks button is unchanged, for when she would rather the app post it.

## Expenses, km and supplies by city and division

The Expenses page now also splits each month by city and division with the same job type rule, with a **Download for Danielle** workbook, one sheet a month. Shop purchases are "Shop"; jobs with no Job Type show as "No type".

## Not changed

- Net pay still comes from the pay stubs, typed in on the Payroll page. QuickBooks only gives pay stub detail to apps with Intuit's payroll permission.
- Overtime is still counted at 1.5 when spreading net pay. Craig's 6 November run spread by plain hours. Danielle should say which she wants; it is one setting.

## Files

netlify/functions/_payroll.mjs, payroll.mjs, _expenses.mjs, expenses.mjs; public/command.html, public/xlsx-lite.js (new, a small Excel writer), public/sw.js; test/payroll-journal.test.mjs (new, 8 checks).
