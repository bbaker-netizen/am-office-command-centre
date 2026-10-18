# Changes 2026-10-18: account invites

## What it does

An admin can now add a person and send them an invite instead of reading out a temporary password.

1. Admin, People and access, Add a person. Fill it in as before, then press **Add and send an invite**.
2. The person gets an email from automation@amabatement.com, in A&M colours, with a **Choose your password** button. Replies go to the admin who sent it.
3. They press it, choose their own password, and are signed in to the command centre.

The link works **once**, for **7 days**. No password is ever emailed. A new invite, a cancelled one or a used one makes the old link worthless. Only a scramble of the link is stored, so a copy of the data cannot be turned into a working link.

If the robots' mailbox is not connected, nothing is emailed. The admin is shown the link to copy into a text or message instead.

On each person, People and access now shows **Invited** or **Invite ran out**, with **Send a new invite** and **Cancel the invite**. For someone who has signed in before, the same button sends a link to set a new password; their old password keeps working until they use it. The temporary password route is still there.

## Files

- netlify/functions/account.mjs: invite, cancelInvite, inviteCheck, acceptInvite; create with sendInvite.
- netlify/functions/_accounts.mjs: invite dates on each account (never the link).
- netlify/functions/mail.mjs: sendEmail, one email straight from the robots' mailbox. The robots' drafts still wait for a person.
- public/door.js: the welcome screen for an invite link.
- public/command.html: buttons, status and Recent changes wording on People and access.
- public/sw.js: VERSION am-inv-v68.
- test/invite.test.mjs and test/support: 14 checks through the real account code, with a stand-in data store and Gmail.

## Settings

None needed. INVITE_DAYS in Netlify changes the 7 days if ever wanted.

## After deploy, try it

1. Add a test person with an email you can read, for example a personal address, and press Add and send an invite.
2. If it says nothing was emailed, the robots' mailbox is not connected. Copy the link and open it on your phone.
3. Choose a password. You should land in the command centre as that person.
4. Switch the test person off afterwards. (Remove only works before a first sign-in.)

## Run the checks

`npm install`, then `node --import ./test/support/use-fake-blobs.mjs test/invite.test.mjs`.
