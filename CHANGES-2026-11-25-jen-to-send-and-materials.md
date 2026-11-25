# Changes 2026-11-25: To send held back by kind, Materials, editing, the scroll jump, inventory for Claude (am-inv-v103)

Asked for by Jen, 25 November 2026 (three emails to Bruce: "Command centre is not useful yet", "Command center/Inventory" and her Claude's note on the connector).

## 1. To send: only what the office has to look at
- **Every robot email gets a kind**, read off its subject and first line: Insurance and WCB paperwork from subtrades, Purchase order and contract chasers, Payment reminders, Quote follow-ups and site visits, Everything else. The kind shows on each line.
- **Hold a kind back.** A card on To send, "What the assistants write, and what shows here", lists the kinds with how many are waiting and a Show on To send switch. One setting for everyone, saved with who changed it. Anyone who can make changes can switch it.
- **Purchase order and contract chasers start held back**, because A&M does not get a signed PO on every job yet.
- **Emails about a finished job are always held back**: a job number in the subject or first line that is closed, at Job Post Mortem or Closed Won in JobTread. A job still being invoiced is left alone.
- **Held back is not deleted.** They sit in a Held back card with the reason on each line, can be read, sent or discarded one at a time, and "Throw away all held back" clears them (asks once).
- **One number.** The banner and the list now count the same emails. Before, the banner counted only those over a day old (26) and the list showed all of them (40). Held-back emails are counted on neither, and the banner says how many are held back.
- **"A&amp;M" in the list** was Gmail's escaped preview escaped again. The preview is turned back into plain words on the server.
- **Where the instructions live is said on the page**, and Ask Claude's guide knows it: the morning assistants are scheduled Claude tasks in the A&M Automation Claude account; the command centre cannot see or change their instructions. To change what they write, change or pause those scheduled tasks in that account.
- Files: netlify/functions/mail.mjs, public/command.html, netlify/functions/_guide.mjs

## 2. Ask Claude: "I did not get an answer back"
- The panel showed that whenever the answer came back with no words. The likeliest cause is the answer running out of room before any words (900 tokens, with the newer models thinking first). The room is now 2,000.
- An answer with no words now says why (ran out of room, would not answer, or the stop reason), and the function log gets a line "ask-claude: no words back" with who, the reason and the model.
- Not confirmed against the live site: the Netlify function log for Jen's two questions on 25 November would show the real reason.
- Files: netlify/functions/claude.mjs

## 3. Materials (was Shelf)
- **Renamed** on the tab, the screen and the stickers page. The address stays #/shelf, so links and bookmarks still work. One line in public/app.js to put it back.
- **Edit on every material line**: name, group (or a new group), Pulled by, how many in one, where it sits, notes. The tag can change only while nothing has been counted or pulled against it, the same rule as machines. An untouched supplier code (ANSL37-145-10) is never retagged by accident. A line added by mistake can be taken off.
- **Pulled by, per line.** Adding a material one at a time used to save every line as "each". It now has a Pulled by choice, starting at the unit most used in its group. Nitrile gloves can be a box while the rest of the PPE stays each.
- **Search** finds by name, code or group.
- Files: public/office.js, public/app.js

## 4. Stickers
- **The search sits on top of the Pick which ones list**, where the Filter box used to be off to the right. Every word must match, in any order ("nitrile l"). The printed book keeps the search.
- **The unit is big on a material sticker**: BOX, ROLL, EACH in a boxed, large line with "per scan", above the name, plus how many are in one.
- Files: public/office.js, public/styles.css

## 5. The list jumping back to the top
- The shop app syncs every minute and redrew the whole screen, which threw every scroll box (the Pick which ones list scrolls in its own box) back to the top and shut every open group, sometimes mid-scroll.
- A redraw of the same screen now puts back the window's scroll, every scroll box's position and the open groups. A search typed on Materials is applied again after a redraw.
- Files: public/app.js, public/office.js

## 6. Each person's own Claude can read the inventory
- New connector tool **list_inventory_items** (read only): materials with tag, name, group, the unit one scan takes, how many in one, count on hand, minimum, maximum and where it sits; machines with tag, name, group, unit number, serial, make and model, status and where they are now (Shop, Out on job, Out for repair, Missing). Optional kind, search words and group.
- Served by a new part of /api/command, part=items, open to the same people as the inventory part.
- Ten tools now.
- Files: netlify/functions/mcp.mjs, netlify/functions/command.mjs

## 7. The equipment sheet: serials the spreadsheet shortened
- The sheet holds some serials as short numbers (3.5202E+12, 2.41E+14): the real digits are gone. These are never copied onto a machine, never used to add one, and are listed on Equipment under "Serials to retype on the sheet". Before, "Use the sheet's values for all" would have written them over the good serials.
- A new row whose serial is already on another new row waits (NEG-65 and PVAC-18 both say 204871 on the sheet today; NEG-65 goes in, PVAC-18 waits).
- Files: netlify/functions/_equipsheet.mjs, public/command.html

## Version
- public/sw.js VERSION am-inv-v103.

## Tested
- All 27 test files pass, including the new test/to-send.test.mjs (5 checks), two new equipment sheet checks and the connector's inventory check.
- Headless browser against stand-in data: Materials (open group and scroll kept through a redraw, search kept, Edit saves a box of 100 and keeps the tag), Labels (pick list scroll kept, search, big unit on the sticker, the book), Add (Pulled by shown for materials only), and To send as Jen (kinds, held back with reasons, a finished job held, the switch saved). No script errors.
- Not run against the live site.
