# Changes 2026-11-15: personal assistants (My day) and more than one inbox

Phone version am-inv-v80. Parts 2 and 5 of Bruce's brief for session 2. Stacked on the payroll pull request: merge that one first.

## Who gets what

- Every account now has an **assistant**: Executive (leadership), Project (project managers and field leads) or None. It also has a page it **opens on**: My day or Overview. Both are set on People and access.
- Craig and Amir start as Executive and open on My day, with no setup needed.
- The **project assistant is built but off for staff**. An admin switches it on under People and access ("Project assistant for staff") once Craig and Amir vouch for theirs. Until then admins can preview it under Admin, Project assistant (preview).
- Each assistant belongs to one person and shows only that person's list, mail and asks. Ask Claude still answers anything about the command centre.
- View as shows someone's list but not their mail. Craig still has to decide this one.

## My day

- **Talk** (the phone's microphone) or type: "put this on my list", "pay Aces 25,000 by Friday", "expecting 12k from Integricon", "call back Dave", "I just paid Aces". Claude turns it into list lines and ticks; without the Claude key, plain sayings still work.
- **Promises to pay and money expected** with an amount also go into the Cash flow on their date. Ticking one ticks it in the cash flow too. This covers Craig's sticky notes.
- **Photo of a paper list**: new lines are added, crossed-out or ticked lines are ticked.
- **Log a walk-in or call**: held until the next check-in, then joins the list.
- **The hit list**, most pressing first: pinned, overdue, due today, promises and calls.
- **Three check-ins every weekday**, run in the cloud at 7:00, 12:00 and 5:00 Edmonton time:
  - morning: the briefing and a ranked hit list;
  - noon: done, left and working hours left;
  - end of day: what rolls to tomorrow.
  Each is emailed from the robots' mailbox unless the person turns that off. Nothing runs on weekends or outside 7:00 to 5:30.
- **Reminders with context**: a QuickBooks payment (or a payment email) that matches a sticky note ticks it and says why, with undo. Example: "You said you'd call X about the holdback; since then X has paid $Y."

## Inboxes (Part 5)

- Each person connects their own work inbox under My day ("Connect my inbox"), and can add more than one ("Add another inbox").
- Google permissions: read mail and write drafts. Nothing is ever sent from a person's inbox by the app.
- The sign-in reuses the robots' mailbox Google app and its redirect address, so no new Google settings are needed if that app is an internal (A&M Workspace) app.
- Only A&M addresses can be connected, never the robots' mailbox. The original company Gmail is left out for now; INBOX_EXTRA in Netlify can allow it later.
- Mail is sorted at the morning and noon check-ins, or with "Sort new mail now", into: Needs you, Payments, For your information, Someone else's (estimating mail stays out of the way), and Junk.
- "Draft a reply" puts a reply into the person's own Gmail drafts. The morning check-in drafts up to three, noon one.

## Leadership extras

- **Craig**:
  - Bank since you last looked (QuickBooks payments in and out, plus the balances he typed), with "I have looked".
  - The cash flow advice.
  - Due this week: what to invoice at Thursday billing, and what to pay.
- **Amir**:
  - Done, not billed: every job that cannot be invoiced, why, and who it waits on.
  - **Chase**: a draft each working day for three days, from his own inbox or from the robots' mailbox with replies coming to him. On day three with no answer, "Call them" goes to the top of his list. After he logs the call, Claude suggests the next step. The chase status shows on the job's line. An answer from that address stops the chase.
- The project assistant (when switched on): the same bar, list, check-ins, inbox and chase, plus a closeout list of the PM's jobs (7-day rule before Thursday billing, post mortems after).

## How it runs

- netlify/functions/assistant-checkin.mjs: scheduled every hour 6 am to 5 pm Mountain on weekdays. It acts only at 7, 12 and 17 local time, once per slot per day.
- It hands each person to assistant-run-background.mjs (up to 15 minutes, for mail sorting with Claude). If the site cannot run background functions, it does a lighter check-in in place: the list, the chase and the email, without sorting mail.
- ASSIST_MODEL (default claude-haiku-5-5) sorts mail and reads sayings. CLAUDE_MODEL drafts replies and reads photos. Both use the same ANTHROPIC_API_KEY as Ask Claude.

## Files

netlify/functions/_assist.mjs, assistant.mjs, assistant-checkin.mjs, assistant-run-background.mjs, _runsecret.mjs, inbox.mjs, _gmail.mjs, _claudecall.mjs (new); _accounts.mjs, account.mjs, command.mjs, mail.mjs, _guide.mjs; public/command.html, public/sw.js; test/assistant.test.mjs (new, 14 checks with stand-in Claude, Gmail and QuickBooks).
