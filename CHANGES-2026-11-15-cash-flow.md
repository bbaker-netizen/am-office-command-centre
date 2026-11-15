# Changes 2026-11-15: Cash flow, on Craig's weekly method

Phone version am-inv-v78. Part 3 of Bruce's brief for session 2.

## What Craig sees

A new **Cash flow** page under Office, for anyone who sees Money.

- **Room on the line now** at the top: Sunday's bank balance plus the $750,000 line of credit. With -$540,000 in the bank that is $210,000. It uses the balance Craig types under Money for that Sunday. Without one, it uses his latest typed figure or QuickBooks, and says so.
- **End of this week**, **end of four weeks**, and **if everyone paid me and I paid everyone**: every open invoice and bill settled today, plus four weeks of planned payments.
- **What to do this week**, in plain words: what has to go out, which week is tightest, which bills to pay, which to hold, who to chase, and which promised money did not arrive. It protects the tightest of the four weeks, not just this one. It keeps the reserve (default $25,000) in every week, pays AP Solutions first because it charges interest, then this week's bills, then the oldest late ones.
- **This week**: money in and money out, each with a Received or Paid tick. Invoices and bills have a "Move to" week picker for a customer's promise or Craig's pay plan.
- **Four weeks**: room at the start; customers paying; other money in; payroll, source deductions, WCB, benefits, internal subcontractors, vehicles and loans, GST and taxes, one-off payments, supplier bills, running costs, owner payments; room at the end.
- **Overdue, no date yet: chase** and **Late bills with no pay date**. These are invoices and bills more than 14 days past due. They do not count in the weeks until they are given a week, because a 90-day-old invoice will not arrive just because it is late.
- **Planned payments**: add, change or remove, once, every week, every two weeks or every month.

## Rolling forward

Nobody moves anything by hand any more. Anything still open rolls into the current week by itself, marked in blue:
- a planned payment not ticked;
- an invoice or bill placed in an earlier week;
- anything due in the last 14 days.

## Where each fact comes from

- Open invoices and bills, with due dates: QuickBooks (receivables and payables detail reports), read every five minutes.
- The bank balance: Craig's typed figure (Money, Cash position), else QuickBooks.
- The plan (planned payments, ticks, the week each invoice or bill is placed in): kept by the app in "cashflow-plan". It writes to nothing else.
- Invoices dated the 1st are flagged: Danielle usually moved them for GST, so they are older than they look.

## Copied from Craig's sheet

On first open, Craig's planned payments are copied once from his "Cashflow Management Tool" sheet (tab "June 1, 2026", after his 14 Nov run).
- The weeks of 16 Nov to 7 Dec are exactly as he typed them: 74 lines including payroll, source deductions, Journey, the Ford payments, BDC, Visa, GST and the owner payments.
- The insurance payment is dated 21 Nov (the sheet had it in the week of 9 Nov).
- The ACN unapproved invoices ($24,360) are a one-off on 14 Dec. The Integricon $50,000 not billed yet is money in on 23 Nov.
- The regular ones carry on from 14 Dec and are marked **Check** for Craig to confirm.
- WCB is not in the sheet for these weeks; add it.

## Replaced

- Overview, for Craig: the "Owed to A&M" and "A&M owes" tiles are now "Room on the line" and "End of this week".
- Money: the coverage ratio card ("money coming in covers money going out 1.27 times") and its alert are gone, and so is the rough 13-week draft. A card links to Cash flow instead.
- Ask Claude knows the page (_guide.mjs) and suggests "What can I pay this week?" and "What if our biggest customer pays a week late?".

## Files

netlify/functions/_cashflow.mjs, cashflow.mjs, _cfseed.mjs (new); _qboreports.mjs (readReceivableDetail), _guide.mjs; public/command.html, public/sw.js; test/cashflow.test.mjs (15 checks), test/cashflow-api.test.mjs (4 checks, end to end with stand-in QuickBooks).
