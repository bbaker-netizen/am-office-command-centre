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
