# Changes 2026-11-10: payroll split leaves out salaried staff, subcontractors and agency temps

Phone version am-inv-v73. Merge pull request #8 (v72) first.

## What it does

Craig asked on 6 November that the payroll split leave out temp agency staff, Ryan (salaried) and Max (subcontractor). Before this, only time entries whose type said "temp" were kept apart, so Ryan, Max and any agency temp clocked in as regular time were split and posted like hourly staff.

Now:

- A "People left out of the split" list sits in the payroll settings, beside the overhead jobs. It starts with Ryan Mirandilla (Salaried) and Maxim (Subcontractor), the names exactly as they are in JobTread. One per line, name = why.
- Anyone whose JobTread name names a staffing agency, such as "Mo (Aces)", is counted as a temp even if the time entry type does not say temp.
- Their hours are listed in a new "Left out of the split" card, so nothing disappears without anyone seeing it.

## October

Craig sent Danielle the October entry on 6 November ("Payroll net labour by cost code - 2026-11-06.xlsx", made in a Claude chat) and she replied on 9 November that it will do. This change makes the app follow the same rules from the next pay period.

## Files

Changed: netlify/functions/_payroll.mjs, netlify/functions/payroll.mjs, public/command.html, public/sw.js.
New: test/payroll-leave-out.test.mjs (5 checks).

## Tests

node test/payroll-leave-out.test.mjs. The other test files still pass.
