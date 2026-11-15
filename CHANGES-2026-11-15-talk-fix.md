# Changes 2026-11-15: Talk always says what happened

Phone version am-inv-v87.

Bruce, on a computer in Chrome or Edge: pressing Talk on Sticky notes (and on My day) did nothing at all.

## Why it could look like nothing

A browser can start listening and stop again with no words and no error: microphone switched off, blocked by Windows, no microphone plugged in, or a microphone question from the browser that went unanswered. The app put the button back to Talk without a word, so it looked like nothing happened.

## What changed (My day and Sticky notes)

- **The button shows each stage:** "Starting…", then "Listening… speak now". Press it again to stop.
- **Every ending says what happened:**
  - Microphone blocked: where to allow it (the icon at the left of the address bar, and Windows microphone privacy).
  - No microphone: says so.
  - Nothing heard: the app checks the microphone itself, so the message says whether the microphone is on, blocked or missing.
  - The browser never starts: look for the browser's microphone question and press Allow.
  - Speech service unreachable (Chrome and Edge send speech away to turn it into words): says so.
- **Adding a note shows "Sticking it on…"** straight away, and if the server does not answer in 20 seconds it says so instead of waiting silently.
- iPhone home screen app: unchanged, points to the keyboard microphone.

## Checked

In a browser with every case faked (no microphone, microphone on but nothing said, blocked, words heard, browser never starts), on Sticky notes and on My day: each shows the right message, and words become a note or a list item. The earlier talk-button checks and all server checks pass. No script errors.

## Files

public/command.html, public/sw.js.
