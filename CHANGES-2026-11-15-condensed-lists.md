# Changes 2026-11-15: long lists open condensed

Phone version am-inv-v89.

Bruce: the cards with lists made the pages far too long to scroll. No more than three to five items showing, the rest behind a dropdown, closed by default.

## What changed

- **Every list of more than five lines** now shows the first four, with a **Show all (number) ▾** button under it. Pressing it opens the full list in place; **Show fewer ▴** folds it back.
- **Closed every time a page opens.** A list opened stays open while you stay on that page.
- **Covers:** every table on every page (five rows, then Show all, except working tables of 30 rows or more such as the payroll split), the cash flow's money in and out lists, What needs a decision, and every list on My day: hit list, inbox groups, bank money in and out, due this week (to invoice and to pay), Done, not billed and chases.
- **My day** now shows four sticky notes on its card (the board has the rest).
- Cards that already fold closed keep doing so; when opened, their lists are condensed too.

On the test data, My day went from about 3,300 to about 3,100 pixels tall on a computer, with Done, not billed showing 4 jobs instead of 8, and its full 44 a press away.

## Checked

In a browser: My day (Show all 44 opens all 44, Show fewer closes back to 4), Overview, Closeout, Money and Cash flow; sticky notes board and walkthrough checks; all server checks pass. No script errors.

## Files

public/command.html, public/sw.js.
