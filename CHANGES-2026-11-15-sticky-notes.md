# Changes 2026-11-15: Sticky notes board

Phone version am-inv-v86.

Bruce: instead of paper sticky notes on monitors and desks, a sticky notes board where anyone can click and drag, talk or type to add a note, in handwriting, on brand and engaging.

## What it is

A new page, **Sticky notes**, beside My day, for everyone with an account. Each person has their own board.

- **Add a note:** type in the box and press Stick it (or Enter), or press **Talk** and say it. On an iPhone home screen app, Talk points to the microphone on the keyboard, as on My day.
- **Six paper colours:** yellow, cyan, pink, green, orange and white. The colour picked is remembered.
- **Handwriting:** notes are written in Caveat, a handwriting font with an open licence, kept with the app (public/fonts) so it works with no signal.
- **Drag** a note anywhere on the board with a mouse or a finger. It lifts as it moves and lands on top. The board grows downward as notes are dropped lower.
- **Tap the words** to change them. Click away to save, Esc to cancel. Emptying a note throws it away.
- **On each note:** Colour, To my list (copies it onto the My day hit list, for people with My day), and a cross to throw it away, with **Undo**.
- **Tidy up** lines every note up in a neat grid, oldest first.
- **Keyboard:** Tab to a note, Enter to change it, arrow keys to move it (Shift for bigger steps), Delete to throw it away.
- **On a phone** the notes flow into two columns in the order they sit on the board, so notes placed on a computer never pile on top of each other.
- **Brand:** charcoal and cyan strip across the top of the board, A&M cyan tape holding each note, Arial everywhere except the handwriting.

## Privacy

Each board is private to its owner. An admin using View as sees it look only; nothing can be moved or changed. Notes go nowhere else unless the person presses To my list.

## Also

- Ask Claude knows the page.
- The tour and What's new have a Sticky notes step. Its voice clip is made in GitHub's cloud by the narration job.

## Checked

6 new server checks (adding, colours, placing, moving, editing, throwing away and undo, tidy up, full board, own board per person, view-only accounts can keep notes, View as is look only). All other checks pass. In a browser: add, drag, tap to edit, colour, throw away, undo and tidy up all save; phone width and empty board checked; no script errors.

## Files

netlify/functions/notes.mjs (new), netlify/functions/_notes.mjs (new), netlify/functions/_guide.mjs, public/command.html, public/sw.js, public/fonts (Caveat and its licence), tools/Narration-Script-Command-Centre.md, test/notes.test.mjs (new).
