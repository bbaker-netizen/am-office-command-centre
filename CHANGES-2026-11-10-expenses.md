# Changes 2026-11-10: the Expenses page

Phone version am-inv-v74. Merge pull requests #8 and #9 first.

## What it does

A new Expenses tab under Office, for accounts with Payroll ticked (Brenda, and anyone who sees payroll). It reads JobTread only. Nothing is written to JobTread or QuickBooks.

Built from Jen's spec of 28 October, her card list update the same day, and Bruce's additions.

1. **Owed to staff now.** Every km claim and reimbursement at Approved and not yet Paid, by employee, split Edmonton, Calgary and No branch. No month filter, so a late approval is never missed. Km owed is worked out here (approved km x $0.70, trailer km x $0.90), not taken from the PM's typed amount. If the approved km are blank, it pays on the km claimed and flags it. Shop purchases on someone's own card or cash are included. A person with a claim that needs fixing is marked "Fix first". Download button for Brenda.
2. **By branch, each month.** Km, reimbursements, company card and shop, by the date of the trip or purchase. A No branch column shows money on jobs with the Estimating branch blank, and the overhead jobs, instead of dropping it.
3. **Company card spend by holder.** Expense bills plus shop purchases on a card. Matched on the card's last 4 in the payment Ref # first, then the bill description. The card list is read from the shop form's "Company card used" dropdown, so there is no second copy of it. A street number in a description (for example 7712 Saskatchewan Drive) is not read as a card.
4. **Problems to chase.** Jen's list, plus:
   - the same trip claimed twice on the same day
   - odometer readings that overlap or go backwards (readings under 5,000 are taken as a trip meter and not compared)
   - odometer gap not matching the km claimed
   - a claim dated in the future
   - a reimbursement whose notes name a company card (it would be paid twice)
   - claims on closed or -OLD jobs
   - Expense bills on the overhead job, from a TEST vendor, or on a card not on the list
   - shop purchases on a company card with no card picked
   Claims already sent back are left out.

Branch follows the payroll rule: the job's Estimating branch field. 26-00000 and 26-0000 count as overhead.

An Expense bill paid "to" someone personally, or with km, mileage, reimbursement or claim in its description, is treated as a booked claim, not a card purchase.

## Settings

KM_RATE and KM_TRAILER_RATE in Netlify change the km rates. Defaults 0.70 and 0.90.

## Files

New: netlify/functions/expenses.mjs, netlify/functions/_expenses.mjs, test/expenses.test.mjs (17 checks, using claims and bills copied from JobTread on 2026-11-10).
Changed: public/command.html (Expenses tab), public/sw.js.

## Checked

17 rule checks pass. The page was opened in a test browser at desktop and phone width as an account with Office and Payroll: no script errors, and the warnings also show on the Overview.
