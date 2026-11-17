# Changes 2026-11-17: the assistant's queue, Approve and send, hand-offs, calendar

Phone version am-inv-v91. Builds on v90 (pull request #27): merge that one first.

## Why

Craig and Amir were being shown emails as "for them" that were not, and had to go and find the ones that were. Amir asked for an assistant that tells him what he has to do and what he does not, with buttons to approve or act.

## What they see now

**Needs you**, at the top of My day. Only the emails they have to act on. Each one shows who it is from, what is being asked in one line, why it was flagged, and a reply already drafted.

Buttons on every item:
- **Approve and send**: asks once more with the address, then sends the reply from their own Gmail, as them.
- **Edit**: change the words, then send.
- **Fill in the blank**: shown instead of Approve when the draft has a [square bracket]. It cannot be sent until that is filled in.
- **Hand to**: pick a person, add a note, and it goes to them from the owner's Gmail. A line "Check (name) dealt with" goes on the hit list two working days out. The assistant suggests who when it is plainly someone else's job.
- **Not mine**: "Just this one", or "This and others like it", which is remembered and told to every later sort.
- **Later**: off the queue until the next working day.
- **Done**, **Open email**, **Always flag this sender**.

**Your meetings**, beside it. Today's calendar with overlaps marked, and invites waiting for an answer with **Accept**, **Maybe** and **Decline**. The organizer is told.

**Your inbox** is still there underneath with everything sorted, plus "What your assistant has learned": the senders always flagged and the not-mine rules, each with Stop or Forget.

## How it decides better

- **It reads the whole conversation.** An email they already answered is not raised. If the same sender has written again since, only the newer one is raised. If someone else at A&M already replied, the assistant is told and shows it.
- **It is told who everyone is.** Names and titles of the staff accounts, so it can tell their job from someone else's.
- **It learns.** Not-mine rules and senders who always matter are part of every sort.
- **Drafts for every email that needs a reply** (up to eight a pass, was three a morning), written in their own voice from a few of their recent sent emails.
- **A new email in a conversation whose line was already ticked gets a new line** on the hit list (it was silently skipped before).

## Sending: the rules

- Nothing is sent on a timer or by the sort. Only two buttons send: Approve and send, and Send it to them (hand-off).
- Sending is always from the person's own Gmail, as them. Nobody can send as someone else: View as is look only, and an admin viewing as someone sees neither their queue nor their calendar.
- A draft with a blank cannot be sent.

## For Bruce: before the calendar works

- **Enable the Google Calendar API** on the Google Cloud project that holds the robots' mailbox app.
- **Craig and Amir connect their inbox again** (Add another inbox, pick the same account) and tick the calendar box. Until then My day shows "Connect my calendar". Their mail keeps working in the meantime.
- Sending needs no new permission: the permission the app already has for drafts covers sending a draft.
- A personal Gmail gets the same queue and calendar, but only while the Google app is External with them as test users (see the v90 notes).

## Onboarding

- My day walkthrough: "Your inbox" rewritten, new steps "Needs you" and "Your meetings".
- Cash flow walkthrough: "Room on the line" rewritten, new step "Looking ahead".
- What's new: shows once more for everyone, with Needs you, Your meetings and Looking ahead.
- Voice clips: the two rewritten clips were removed and three new ones added to the script. GitHub makes all five in the same voice when this branch is pushed.
- Ask Claude's guide knows all of it.

## Not in this change

- Each person's Claude skills inside the app.
- Drafts that pull facts from QuickBooks or JobTread, follow-ups on their own sent mail, promises made in sent mail, deadlines pulled from mail, attachments, a phone alert for urgent mail, a weekly accuracy count.
- Meeting requests inside emails answered with free times, and a prep note before each meeting.

## Files

netlify/functions/_assist.mjs, _gmail.mjs, assistant.mjs, inbox.mjs, _guide.mjs; public/command.html, public/sw.js; tools/Narration-Script-Command-Centre.md; public/tour/cc (two clips removed for remaking); test/assistant.test.mjs (6 new checks, 25 in all).
