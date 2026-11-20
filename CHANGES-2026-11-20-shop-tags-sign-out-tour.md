# Changes 2026-11-20: unit tags, name list, sign out, walkthrough, shop for admins (am-inv-v92)

Asked for by Craig, 20 November 2026.

## 1. Add gear: the tag follows the unit number
- The shop's list has always tagged a machine by its own number: Air Mover #1 is AMV-1, Large Dehumidifier #801 is DEH-801. The Add form ignored the unit number and handed out the next free number instead (AFM-03 and so on).
- Now a unit number given on Add makes the tag: Air Mover, unit number #9118, is tagged AMV-9118. Typing "AMV #9118" into the unit number is understood the same way.
- New box, "Tag (on the sticker)". Leave it empty and the tag follows the unit number. Type your own (for example "amv #9118") and that is used, tidied to AMV-9118.
- A tag already in use, or used once and removed, is refused before saving, with a plain message.
- Pasted lists follow the same rule.
- Files: public/office.js

## 2. Add gear: Name is a drop-down
- Name lists every name already on the list: the chosen group's names first, then names in other groups.
- "+ Add a new name" opens a box to type it. Once that machine is added, the new name is on the list for everyone.
- Picking a name before a group fills in the group where that name already lives.
- The name stays picked after each Add, as before.
- Files: public/office.js

## 3. Sign out is easy to find
- Command centre top bar: Sign out is cyan, set apart from the other buttons, and keeps its words on a phone where the others shrink to icons.
- My account: Sign out on this device is now at the top, not the bottom.
- Shop: a Sign out button beside your name. It used to be hidden behind tapping your own name.
- Files: public/command.html, public/app.js, public/styles.css

## 4. The walkthrough opens on its own once per person, and closes easily
- Amir's walkthrough opened every time. It was only marked seen in that one browser, and only once finished or skipped, so closing the tab part way, another computer, or a browser that clears its storage brought it back.
- Now it is marked seen the moment it opens on its own, in the browser and on the person's account (new account action tourSeen, returned on /api/command?part=me as tours). Another computer or a cleared browser stays shut.
- "Close the tour" is a proper button with an X, and Escape closes it. The Tour button at the top still replays it any time.
- The shop's own walkthrough gets the same "marked as it opens" fix and a clear Close button.
- Files: public/command.html, public/tour.js, public/styles.css, netlify/functions/account.mjs, netlify/functions/_accounts.mjs, netlify/functions/command.mjs
- Test: test/tour-seen.test.mjs (10 checks)

## 5. Admins can open the shop, and reach shop PINs, from the command centre
- Admins sign in to the command centre with email and password and many have no shop PIN, so they could not get into the shop, and shop PINs are only managed inside the shop.
- Shop is now on the Admin section's page row for admins (it stays on Field for everyone with Field).
- For an admin, Shop goes in as themselves with no PIN: the command centre asks for a short shop pass (account action shopPass), hands it to the shop in that browser tab only, and the shop signs them in with office rights.
- The pass is good for 12 hours (SHOP_PASS_HOURS) and is checked against the account on every request: switched off, no longer an admin, or password changed, and it stops at once. It cannot be used as a command centre sign-in, and View as cannot get one. Each one is written to the accounts log.
- People and access has a new card, Shop PINs, with "Change or reset shop PINs". It opens the shop's Settings at Who can use it, where PINs are issued and reset.
- When the pass ends or the admin signs out, the shop says to open it again from the command centre, with a button back, instead of a PIN pad they cannot use. "Somebody else, sign in with a PIN" is underneath.
- Crew PIN sign-in is unchanged.
- Files: netlify/functions/_auth.mjs, netlify/functions/account.mjs, public/command.html, public/app.js, public/office.js
- Test: test/shop-pass.test.mjs (12 checks)

## Version
- public/sw.js VERSION am-inv-v92.

## Tested
- All 19 test files pass (17 existing plus the two new ones).
- Headless browser, desktop and phone width, stand-in data: Add screen (tag from unit number, typed tag, taken tag refused, new name joins the list, group from name), command centre (walkthrough marked at once, Escape closes, a fresh browser stays shut, Sign out visible with words on a phone, Shop on Admin), and the admin shop pass end to end (People and access, Shop PINs, lands on Who can use it signed in as the admin, Sign out goes to the back-to-command-centre screen). No script errors.
- Not yet run against the live site.
