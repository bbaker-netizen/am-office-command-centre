# Changes 2026-11-17: room on the line moves as things happen, and a 13-week look ahead

Phone version am-inv-v90 (same release as the My day feeds).

## What was wrong

"Room on the line now" did not move during the week. Two causes:

1. **It only used Sunday's bank balance.** A balance typed on a Tuesday was ignored: the app took the figure for the last Sunday, or the last one before it.
2. **Ticking something received or paid did not change it.** The tick took the line out of the week, but the room stayed where it was until the next balance was typed.

The cash flow also stopped at four weeks, so it could not show where it gets tight further out.

## What changed

- **The newest bank balance is used, whatever day it is for.** Craig's typed figure, or QuickBooks once Danielle's import has passed it.
- **Ticks move the room straight away.** Money ticked as received is added, money ticked as paid is taken off, from the moment it is ticked until a newer bank balance takes it into account. This works from Cash flow and from My day (promises to pay and money expected).
- **The page says where the figure comes from**: "Bank -$573,594 (you typed it for 2026-11-16) plus the $750,000 line, plus $48,200 ticked as received since. Worked out 2 minutes ago."
- **The bank balance can be typed at the top of Cash flow**, not only under Money. The box opens by itself when the balance is a day old or more.
- **The cash flow refreshes when Craig comes back to the tab**, as well as every five minutes.
- **Looking ahead: where it gets tight.** New card on Cash flow, and a short version on My day. One row a week for 13 weeks, with a bar for the room left at the end of the week. Amber when it is under the reserve, red when it is over the line. The headline names the first week it gets tight. "Show the numbers" gives the table.

## What "real time" means here

BMO does not feed the app or QuickBooks, so no screen can know the bank balance by itself. The room is as current as the last balance typed, plus everything ticked since, plus what QuickBooks shows (read every five minutes). To be right to the dollar, type the balance from BMO online banking. A live bank feed would need BMO to connect to QuickBooks or to the app, which it does not do for this account today.

## What the look ahead counts

- Counted: invoices already sent and bills already entered, in the week they fall due (or the week Craig moved them to), and the planned payments.
- Not counted: work not billed yet, and invoices more than 14 days late until they are given a week.
- So the weeks past the last sent invoice read low on money in. They are drawn lighter and headed "Further out: money in is not known yet". The headline is taken only from the weeks that are known (never fewer than four). To put expected billing in, add it under Planned payments with the group Other money in.

## Files

netlify/functions/_cashflow.mjs (openingBalance, movesSince, outlookOf, findLine, tidyMoves), cashflow.mjs, assistant.mjs; public/command.html; test/cashflow.test.mjs (3 new checks, 19 in all), test/cashflow-api.test.mjs (1 new, 5 in all).
