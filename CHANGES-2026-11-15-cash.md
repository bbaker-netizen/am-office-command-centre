# Changes 2026-11-15: cash in the bank, with its date and source

Phone version am-inv-v76.

## Why the bank figure was never right

A&M's corporate BMO account does not feed into QuickBooks. Danielle imports the BMO transactions by hand at the start of her Tuesday slot. So the bank balance in QuickBooks is only ever as current as her last import, up to a week old, and it jumped each time she caught up.

## What changed

- Craig (anyone who sees Money and can make changes) can type the real balance from BMO online banking, with its date and a short note, under Money, Cash position, "Type the balance from the bank".
- The command centre leads with whichever is newer: Craig's figure, or QuickBooks once Danielle's import reaches the date he typed. It switches back to QuickBooks by itself.
- Beside the balance, on Overview and on Money, it says where the figure came from and how old it is: "You typed it for 2026-11-15" or "QuickBooks, bank entered to 2026-11-09, read today 10:42".
- When Craig's figure is leading, Money shows what QuickBooks says and the gap between the two. The gap is what has gone through the bank and is not in QuickBooks yet.
- A figure over a week old, or QuickBooks with no bank entries for over a week, raises a reminder to type today's balance.
- The last five figures typed are listed with who typed them. All typed figures are kept (last 60) for the weekly cash flow, which starts from Sunday's balance.

## How the import date is found

The app reads the QuickBooks general ledger for the bank accounts over the last 60 days and takes the newest transaction date. Only the bank account sections count, so invoices dated today cannot make QuickBooks look caught up.

## Files

netlify/functions/_bank.mjs (new), netlify/functions/command.mjs, public/command.html, public/sw.js, test/bank.test.mjs (new, 8 checks).
