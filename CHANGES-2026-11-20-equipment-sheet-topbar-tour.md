# Changes 2026-11-20: equipment Google Sheet as the master list, shop top bar, tour "try it" steps (am-inv-v96)

Asked for by Craig, 20 November 2026.

## 1. The equipment Google Sheet is the master list of machines
- Sheet: "AM_equipment_list_-_2026-09-22" (one tab, header row, tag in column A, then Machine, Group, Unit number, Serial, In-shop?, Make and model, Status, Notes). Columns are found by their headings, so moving or adding a column does not scramble anything.
- An admin connects it once under Admin, Connections, by pasting its link. It is read with that admin's own Google Drive connection (My account, Connect Google Drive, read only), so no new Google setup is needed. The first read only shows what it would add. Nothing is added until Start is pressed.
- After Start, a check runs every 15 minutes, 7:00 to 5:30 on weekdays, plus "Check now" on Equipment.
- A new row (a tag not in the shop yet) is added only if:
  - its tag is in the house form, it has a Machine name and a Group,
  - its tag agrees with its unit number (AMV-9118 is #9118),
  - its serial is not already on another machine,
  - and it is next in sequence for its letters (AMV-8040 after AMV-8039). A row that skips a number waits.
- Anything else waits on the Equipment page with the reason. An admin can press Add anyway for a row that is out of sequence or missing a detail, but never for a repeated tag or serial: those are fixed on the sheet.
- A tag taken off the list in the shop is never put back.
- Changes to rows already in the shop (serial, model, name, group, unit number, status) are listed, never applied on their own. An admin presses "Use the sheet" for one machine or "Use the sheet's values for all".
- Machines in the shop but not on the sheet are listed, so the sheet stays the full list.
- Machines are added with the same "only if nobody saved since" rule the phones use, so a phone saving at the same moment is never overwritten.
- The shop's Add gear screen says the sheet is the master list, with a link to it. The Add form stays.
- Problems (rows waiting, a failed check, differences) show on Equipment, on Overview and on the shop lead's My day.
- First read against the app's starting list: 10 new machines (AMV-9118 to 9123, DEH-871 to 874), none waiting, and 177 machines where the sheet has newer serials or status.
- Files: netlify/functions/_equipsheet.mjs (new), equipment-sheet.mjs (new), equipment-sheet-sweep.mjs (new, every 15 minutes), public/command.html, public/office.js
- Test: test/equipsheet.test.mjs (14 checks), with the real sheet as of 2026-11-20 in test/support.

## 2. Shop top bar
- Certificates and its count were sliding under Settings: the tab strip scrolled with no sign it did. Below 1400 pixels wide the tabs now get their own line, and a strip that still does not fit fades at the edge.
- One way back to the command centre: the "← Command centre" link at the left. The second Command centre button on the right is gone.
- On a phone the name chip gives way to Sign out, which does the same thing.
- Files: public/app.js, public/styles.css

## 3. Tour steps that ask you to press something
- Pressing a step on the job flow strip opened the job list under the tour's dark shade, and the tour only lit up Next, so it looked like nothing happened.
- Now doing what the step asks moves the tour on by itself, to the step that shows what opened. The same in the shop's tour for a press or a scan; typing still waits for Next.
- Files: public/command.html, public/tour.js

## Version
- public/sw.js VERSION am-inv-v96.

## Tested
- All 24 test files pass.
- Headless browser: the command centre tour at desktop and phone width (press a section, then press a flow step: the job list opens and the tour shows it), and the shop top bar at 1260, 1700 and 390 pixels wide. No script errors.
- Not yet run against the live sheet from the app; the Google Drive read is the same export the Drive search already uses.
