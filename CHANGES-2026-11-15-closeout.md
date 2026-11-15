# Changes 2026-11-15: closeout checks, documents into JobTread, paying the line down

Phone version am-inv-v82.

## Closeout checks (project assistant and Amir's Done, not billed)

The rule from Bruce's brief: every purchase order, approved quote and subcontractor invoice is in JobTread within 7 days of the job finishing, before it goes to Thursday billing.

For each job that has finished on site, the app reads JobTread and checks:
- **Client PO**: the job's PO Status is Received or Not Required.
- **Approved quote**: at least one quote (customer order) is approved.
- **Subcontractor invoices**: every supplier with a purchase order on the job has a bill, and no bill is left in draft.

It shows the last day worked (the last time entry, because JobTread keeps no date for a status change), whether the 7 days have passed, and the Thursday it bills on.

- On **Amir's Done, not billed** list this is a new column, "Paperwork in JobTread".
- On the **project assistant** it is the closeout list.
- Each closeout job has **Add a document**: a file from the phone goes straight into that job's Files in JobTread, in the chosen folder (Purchase orders, Quotes, Subcontractor invoices, Site documents). Every upload is logged with who sent it.
- Site photos are turned away with a pointer to Encircle, because Encircle owns site photos (A&M's one system for each fact).

## Paying the line down

The Cash flow settings have **Grow the reserve each week by**. Craig's sheet kept $5,000 more of the line unused each week ("Amount to stay in the LOC"). Put 5000 there to do the same. The four-week view shows the reserve for each week, and What to do this week never advises paying a bill that would break it in any week. The default is 0, so nothing changes until Craig sets it.

## Files

netlify/functions/_closeout.mjs (new), command.mjs (part=closeout, upload), _cashflow.mjs, cashflow.mjs; public/command.html, public/sw.js; test/closeout.test.mjs, test/closeout-upload.test.mjs (new), test/cashflow.test.mjs (1 more check).
