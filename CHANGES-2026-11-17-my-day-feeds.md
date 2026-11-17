# Changes 2026-11-17: My day fills itself from the inbox, and personal Gmail for Craig and Amir

Phone version am-inv-v90.

## What was wrong

Craig's My day read "0 on your list, 0 past due, 0 emails need you" and the morning check-in said "Nothing on your list today", while his inbox held a dozen people waiting on him. Four causes, all in the app:

1. **Nothing fed the hit list.** It only held what a person said, typed, photographed or stuck on it (plus the day-three call from a chase). Mail sorted as "Needs you" stayed in the inbox card and never reached the list.
2. **Mail was sorted twice a day, 15 emails at a time.** Only at the 7:00 and 12:00 check-ins, newest 15 only. Craig gets about 100 emails a day, so most were never read, and anything arriving after 7:00 waited until noon.
3. **Too much was filed as "Someone else's (estimating and the like)".** The sorting rule sent copies and internal mail there, including staff writing to Craig directly. That is why his inbox card looked like estimating mail only.
4. **"Add another inbox" could only reconnect the same account.** The Google sign-in was always pointed at the person's work address, so a second inbox could not be picked.

## What changed

- **Email that needs you goes on your hit list by itself.** One line per email thread, tagged "From your email", with an Open email link. Tick the line and the email is marked dealt with. Press Done on the email and the line is ticked. A line you remove does not come back.
- **Mail is sorted every half hour**, 7:00 to 5:30 on weekdays, as well as at the three check-ins (the 5:00 one now sorts too). The half-hour sort sends no email. Each pass reads up to 25 new emails and looks back three days, so a busy inbox is caught up over a few passes.
- **Sharper sorting.** Mail sent to the person that asks them for a decision, an approval, money, a document or a call is "Needs you", including from A&M staff, a customer chasing an invoice, the bank, and JobTread messages posted to them. "Someone else is handling it (you are copied)" is now only for estimating mail and copies.
- **If Claude does not answer, the mail is tried again** at the next pass and is not marked as read by the assistant.
- **Personal Gmail for Craig and Amir only.** They press Add another inbox and pick the Gmail account on Google's screen. Anyone else who tries is refused. The robots' mailbox is still always refused.
- **Add another inbox shows Google's account chooser**, so the right account is picked every time.
- **Disconnect** beside each connected inbox, for an inbox connected by mistake.
- Email links open in the right Gmail account when a person has more than one.

## For Bruce: before the personal Gmail will connect

- **Google sign-in user type.** A gmail.com address can only sign in if the Google app (the robots' mailbox app) is **External**. If it is Internal, Google refuses it before the app sees it. While an External app is in Testing, add Craig's and Amir's Gmail addresses as **test users**; Google ends a test user's sign-in after about 7 days, so they would reconnect weekly until the app is published and verified.
- **Netlify settings (optional).** INBOX_PERSONAL_USERS: the command centre sign-in addresses allowed a personal inbox. Default craig@amabatement.com and amir@amabatement.com. INBOX_PERSONAL_DOMAINS: default gmail.com.
- **Background functions** have to be running for the half-hour sort (they are: Craig's 7:00 check-in on 17 Nov sorted 15 emails).

## Not in this change

The list still does not pull from JobTread tasks, the morning report or the cash flow's "What needs a decision". Amir's day-three chase call already lands on his list.

## Files

netlify/functions/_assist.mjs, _gmail.mjs, assistant.mjs, assistant-checkin.mjs, assistant-run-background.mjs, inbox.mjs; public/command.html, public/sw.js; test/assistant.test.mjs (5 new checks, 19 in all). All 17 test files pass.
