# Changes 2026-11-15: View as

Phone version am-inv-v77.

Craig asked to see the command centre exactly as Amir, Bruce or anyone else sees it, so he can check and sort out what each person has.

## How it works

- Admins have a **View as** button in the top bar. It lists everyone with an account. Pick a person and the command centre redraws as they see it: their sections, their pages, their landing page and their numbers.
- A cyan bar across the top says who you are viewing as, with **Back to me**.
- It lasts for that browser tab only. Closing the tab ends it.

## Look only, enforced on the server

The page sends one extra header (x-am-view-as) with every request. The server (accountGate in _accounts.mjs) checks it on every call:
- Only an admin can use it. Anyone else sending the header is refused.
- Anything but a plain read is refused: no saves, sends, posts, deletes, payroll posting, password changes or job changes.
- The viewed person's own Google Drive is never opened, and connect, disconnect and sign-in steps are refused.
- While viewing, editing, admin and Ask Claude are off. Their admin pages are not shown.
- Each View as is written to the People and access log: who viewed as whom, and when.

## Still to decide

When the personal assistants arrive, Craig decides whether View as shows the other person's email or everything except their email.

## Files

netlify/functions/_accounts.mjs (viewAsProblem, userOf), netlify/functions/command.mjs, public/command.html, public/sw.js, test/view-as.test.mjs (new, 9 checks, through the real sign-in gate).
