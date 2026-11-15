# Changes 2026-11-15: talk button on iPhones, and the guide

Phone version am-inv-v84.

## Talk button

Apple does not let an app added to an iPhone or iPad home screen use the browser's listening. It works in a Safari tab, not in the installed app. Some browsers also say they can listen and then refuse.

Now, in those cases, pressing Talk opens the talk box and says: "Tap the box and press the microphone on your keyboard, say it, then press Add." The keyboard microphone does the same job everywhere. Android phones and Safari tabs still listen as before. A refused or blocked microphone now gives the same pointer instead of "I did not catch that".

## The guide (tour)

- **Full tour:** three new steps (My day, Cash flow, View as). Each only shows to people who have that page; View as only to admins.
- **What's new:** plays once, by itself, for anyone who already took the tour: My day, Cash flow, View as, the payroll workbook. Reloading does not start it again.
- **Walk me through it** buttons on My day (8 steps) and Cash flow (6 steps), like Payroll's. Done, not billed shows for Craig and Amir; Closeout for project managers.
- After the full tour, people with My day land back on My day.
- Narration: 20 new lines in tools/Narration-Script-Command-Centre.md. The voice clips could not be made here (the voice service is not reachable from Claude's workspace), so these steps read in the phone's own voice until the clips exist. To make them, on a computer with the repo:

      pip install edge-tts --break-system-packages
      python3 tools/generate-narration.py tools/Narration-Script-Command-Centre.md public/tour/cc

  Then commit the new mp3 files in public/tour/cc.

## Checked

All existing checks pass. In a browser: What's new (6 steps), My day walk (7 for an executive), Cash flow walk (6), iPhone home screen app (no listening attempted, keyboard pointer, box focused), iPhone Safari tab (listens), refused microphone (keyboard pointer). No script errors.

## Files

public/command.html, public/sw.js, tools/Narration-Script-Command-Centre.md.
