# A&M Office Command Centre walkthrough, narration script

Every clip below is one step, or part of a step, of the command centre
walkthrough. The heading is the file name, and the prose under it is
spoken word for word and captioned on screen at the same time. The
captions live in public/command.html (CCTOUR); change a line in one
place, change it in the other.

To make the audio, from the am-inventory folder:

    pip install edge-tts --break-system-packages
    python3 tools/generate-narration.py tools/Narration-Script-Command-Centre.md public/tour/cc

To replace a clip with a real recording, export it as mp3 and save it
over the file of the same name in public/tour/cc. Nothing else changes.

---

## welcome

> Opens on the Overview. The words on screen also say the person's first name.

Hi, and welcome to the A&M Office Command Centre! I'm really glad you're here. This is where JobTread, QuickBooks and the shop come together, so everything that needs a decision is in one place. Let's take a quick look around. It only takes about three minutes. I'll talk as we go, and the words are on screen too, so if you'd rather read, just press Stop the voice.

## sections

> Spotlights the section buttons. The next clips play only for the sections this person has.

These big buttons across the top are the sections of the business.

## sections-office

> 

Office has estimating, dispatch, money, payroll, buying and records.

## sections-field

> 

Field has projects, sites, closeout, equipment and the shop.

## sections-assistants

> 

Assistants holds the emails the AI assistants have written for you.

## sections-admin

> 

And Admin is where you add people, and choose what they can see and do.

## sections-red

> 

If you see a red number on a button, something in that section needs you.

## press-field

> Played when the person has Field.

Go ahead and press Field.

## press-office

> Played when the person has no Field section.

Go ahead and press Office.

## pages

> Spotlights the row of pages.

Nice! The row underneath shows the pages in that section. Each page gets its own number when something on it needs you. And each section remembers where you were, so you'll always pick up right where you left off.

## shop

> Spotlights the Shop page in Field.

Shop opens the shop screens: gear going out to a job and coming back, transfers between sites, the shelf, ordering and filter certificates. It's the same app, and you sign in there with your name and four-digit PIN, just like always. The Command centre button brings you right back here.

## postmortem

> Spotlights the Post mortem page.

When a job wraps up, Craig, Jen or Amir runs a post mortem here with everyone who worked on it. We look at it four ways: financial, operational, the client, and our employees and subcontractors, each scored from 1 to 10. The plan and the actual numbers come straight from JobTread and QuickBooks, and every commitment gets an owner and a date.

## decisions

> Spotlights Needs a decision on the Overview.

This list is really the heart of the command centre. Every line is worked out live, with the most urgent at the top. Now means today, and Soon means this week. Once the cause is fixed in JobTread or QuickBooks, the line clears itself. The button on the right takes you straight to the page behind it.

## numbers

> Spotlights the number tiles.

These are the handful of numbers worth a glance every morning. Press any one to see the page that explains it. All the money is in Canadian dollars, read from QuickBooks.

## flow

> Spotlights the seven steps. Asks for: pressing one.

Every job moves through these seven steps, from new lead all the way to closing out. Each number shows how many jobs are sitting at that step right now. Try pressing one of the steps to see the jobs behind it.

## drawer

> Spotlights the list that opens at the side.

There you go, the list opens right here at the side. Press any job to see everything about it, what's missing in JobTread, and a button to open it there. If your account can make changes, you can update the status, project manager, start date and notice dates right here, and it saves to JobTread under your name.

## find

> Spotlights the search box.

Looking for a particular job? Just start typing a job number, a client, a name or part of an address, and it pops up as you type. Press it to open it at the side.

## tosend

> Spotlights To send in Assistants.

Every morning the AI assistants check the inboxes, JobTread and QuickBooks, and write the emails that need to go out: quote follow-ups, payment reminders and requests for missing paperwork. They never send anything on their own. Just open one, read it over, and press Send or Discard. If a client replies, it goes to estimating at A&M, not to a robot.

## people

> Admins only. Spotlights People and access.

Since you're an admin, this page is yours. Everyone gets an account with their work email, what they look after, the areas they can see, and whether they can just look, make changes, or manage people too. When you add someone, they get a temporary password that works once, and they choose their own the first time they sign in. If you switch someone off, they're signed out at their very next click.

## payroll

> People who see Money. Spotlights the Payroll page.

Payroll takes everyone's hours and splits them into the buckets the bookkeeper posts to, each service line in Edmonton or Calgary, while shop and office time stays in general payroll. You can download the report for her, or type in the pay costs and post the journal entry to QuickBooks once the period closes.

## connections

> Admins only. Spotlights Connections.

Settings brings you here. This is where JobTread and QuickBooks are connected for the whole company. Paste in a JobTread key and the app checks it before saving. Press Connect QuickBooks, sign in with Intuit, and you'll land right back here.

## claude

> People with Ask Claude. Spotlights the Claude button.

And this little round button is Claude. Press it any time to ask about the page you're on: what a number means, what to tackle first, or where to fix something. You can drag it anywhere on the screen and it'll stay put. And if you have your own Claude account, Continue in my own Claude carries the conversation over.

## tools

> Spotlights Live, Refresh, My account and Sign out.

Up here, the dot shows the numbers are live and when they were last read. They refresh on their own every few minutes, and Refresh reads them again right now. My account shows what you can see and do, and it's where you change your password. Sign out signs you out on this device, and if it sits unused for a while, it'll ask for your password again.

## done

> Closing step.

And that's the whole tour! Sections across the top, pages underneath, and what needs a decision first. Nothing here sends an email or changes a job unless a person presses the button. You can take this tour again any time with the Tour button at the top. Enjoy!


# Added 2026-10-10 (Upload 3)

## crewboard

> Spotlights the crew board on Dispatch.

This is where crews get built. Drag someone onto a job, or on a phone, tap a person and then tap Add here. Pick the crew lead and the start times, and it all lands on the job's Site Work task in JobTread, so the crew see it in their own JobTread app. A red name means that person is booked somewhere else the same day. Work order prints a one-page sheet for the crew lead.

## tm

> Spotlights the T&M and extras page.

This page looks after the money that goes missing when the paperwork does. T&M jobs get a sheet built straight from the timesheets, ready for the client to sign. Change orders show how long they've waited, and jobs on site with hours but no approved quote are flagged, because that's usually extra work nobody has written up yet.

## invoicing

> Spotlights Invoicing deadlines on Closeout.

Every client has their own billing rules: where the invoice goes, the cut-off date, and whether it needs a PO, a subcontract number, holdback or a portal. They live on the customer in JobTread, and this card lines up finished work by the soonest cut-off, so nothing slides into next month.

## clients

> Spotlights the Clients page.

Clients shows every customer in one place: what we've won and lost, quotes waiting, what they owe, and whether their billing rules are on file. Gone quiet lists good repeat clients who haven't sent anything in a while, so someone can pick up the phone.

## scorecards

> Admins only. Spotlights Scorecards.

Scorecards pulls together the numbers from each position profile that the systems can actually measure, for the monthly reviews. It's a starting point for a conversation, not the whole story.

## drive

> Spotlights My account.

One more thing worth doing today. Open My account and press Connect Google Drive. It's read only, and it uses your own Google access, so you never see anything you couldn't already open. After that, each job shows its Drive folder, and Claude can answer from the SOP and your role profile.

## pay-intro

> Payroll walkthrough, started from Walk me through it on Payroll.

Hi! This page does the hour-by-hour split that used to be done by hand. The crews' hours come straight from JobTread timesheets, and the app sorts them into your buckets. Let's walk through it once.

## pay-period

> Spotlights the pay period buttons.

Up here you pick the two-week pay period. Previous and Next move a period at a time, and Refresh reads the timesheets again. The two Download buttons give you the summary or every line, as a spreadsheet.

## pay-check

> Spotlights the box at the top.

This box lists anything that would make the split wrong: hours not approved yet, someone still clocked in, or a job with no city. Fix those in JobTread first, then press Refresh, and the box clears itself.

## pay-summary

> Spotlights Hours by employee and bucket.

This is the report you asked for. Each person's hours, split by service line, Edmonton or Calgary, with shop and office time kept in general payroll. ACES temps are shown separately, because they aren't A&M payroll.

## pay-journal

> Spotlights the journal entry.

Once the pay run is done in QuickBooks, type each person's payroll cost here. The app splits it by their share of hours, with overtime counted at one and a half, and builds the journal entry. Press Show the entry to check it, then Post sends it to QuickBooks, once per period.

## pay-settings

> Spotlights Payroll settings.

The first time, open Payroll settings and pick the QuickBooks account for each bucket. After that you shouldn't need to touch it.

## pay-done

> Closing step of the payroll walkthrough.

That's it! Check the box at the top, download or post, and you're done. If anything looks off, press the round Claude button and ask, or press Walk me through it to see this again.

---

# Added 2026-11-15: My day, Cash flow, View as and what is new

The captions on screen can add the person's name after "Hi"; the clips do not.

## myday

My day is your own assistant. It checks in at seven, at noon and at five with what needs you, keeps your hit list in order, and sorts your work inbox into reply drafts that you check and send yourself. It never sends anything on its own. Talk or type to it here. On an iPhone, tap the box and use the microphone on your keyboard. Walk me through it, on that page, shows you the rest.

## cashflow

Cash flow follows Craig's weekly method: room on the line of credit now, money in and money out each week, and where it lands four weeks out. The advice underneath says what to pay and what to hold. Tick a payment once it goes out, and the weeks update.

## viewas

View as shows you the command centre exactly as someone else sees it, so you can check their access or help them over the phone. It is look only: nothing can be saved, sent or changed. Their email stays private.

## md-intro

Hi! This is your own assistant. It keeps one list of what needs you, in order, and checks in three times a day. Let's walk through it once.

## md-talk

Say or type anything here, like: call Integricon about the holdback on Friday, or: I just paid Aces. It goes on your list, or ticks off what you've done. On an iPhone, tap the box and press the microphone on your keyboard, then press Add. Log a walk-in keeps a note of a visitor or a call, and Photo of a paper list reads a handwritten list onto this one.

## md-list

This is your hit list, most pressing first. Press the tick when something is done and it drops off. If it was a payment, the cash flow updates too. Done today, at the bottom, lets you undo a tick.

## md-checkins

At seven, noon and five on weekdays, your assistant looks at everything again and writes you a short check-in. It shows at the top of this page, and it's emailed to you unless you untick that box. You can also ask for one now.

## md-inbox

Connect your own work inbox here, once. Your assistant sorts it at the morning and noon check-ins: what needs you, payments, what is just for your information, and what belongs to someone else. It writes reply drafts that sit in your Gmail drafts. You read them and send them yourself. It never sends anything, and nobody else sees your mail.

## md-jobs

Done, not billed lists every finished job that can't be invoiced yet, and why: a missing purchase order, a quote not approved, or a supplier bill still to come. Press Chase when someone owes us something. Your assistant drafts a note each day for three days, then tells you to pick up the phone.

## md-closeout

Closeout keeps finished jobs on track for Thursday billing. Every purchase order, approved quote and subcontractor invoice goes into JobTread within seven days. Add a document from your phone and it lands in the job's Files in JobTread. Site photos go in Encircle.

## md-done

That's it! Talk to it, tick things off, and read the check-ins. If something looks off, press the round Claude button and ask, or press Walk me through it to see this again.

## cf-intro

Hi! This page is Craig's weekly cash flow sheet, kept up to date for you. Money owed to us and by us comes from QuickBooks. The planned payments, like payroll, WCB and loans, are kept here. Let's walk through it once.

## cf-top

The first number is room on the line of credit right now: the bank balance plus the seven hundred and fifty thousand dollar overdraft. Next is where it ends this week, and where it ends four weeks out. The last one is: if everyone paid me today, and I paid everyone. Type Sunday's bank balance under Money, Cash position, so the weeks start from a real number.

## cf-advice

This is the plain advice. It finds the tightest week ahead and says what to pay now and what to hold, so the line never goes over and your reserve is kept every week.

## cf-view

Switch between this week, line by line, and all four weeks side by side. Tick a payment once it has gone out. Anything not ticked by the end of its week rolls into the next week, so nothing quietly disappears.

## cf-plan

Open Planned payments to add, change or remove the regular lines: payroll, source deductions, WCB, insurance, loans. Lines marked Check were copied from the sheet and want a second look.

## cf-done

That's it! Glance at the top numbers, read the advice, and tick payments as they go. Ask Claude can go deeper, for example: what if a client pays a week late?

## new-intro

Hi! A few new things have arrived in the command centre. This takes about a minute.

## new-payroll

Payroll now builds the workbook for Danielle: wages split by city and division, with overtime counted at time and a half, and expenses split the same way. Press Workbook for Danielle at the top.

## new-done

That's it! My day and Cash flow each have a Walk me through it button if you want the longer version. Enjoy!
