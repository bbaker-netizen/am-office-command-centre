# A&M shop walkthrough, narration script

Every clip below is one step, or part of a step, of the shop walkthrough. The heading is the file name, and the prose under it is
spoken word for word and captioned on screen at the same time. The
captions live in public/tour.js; change a line in one
place, change it in the other.

To make the audio, from the am-inventory folder:

    pip install edge-tts --break-system-packages
    python3 tools/generate-narration.py tools/Narration-Script-Shop.md public/tour

To replace a clip with a real recording, export it as mp3 and save it
over the file of the same name in public/tour. Nothing else changes.

---

## 01-welcome

> Opens on the shop's home screen.

Hi, and welcome to the shop! This is where every machine and every roll of poly lives, and you can see where all of it is right now. Let's take a quick walk through. It takes about three minutes. I'll talk as we go, and the words are on screen too, so if you're somewhere you can't use sound, just press Stop the voice and I'll stay quiet.

## 02-who

> Spotlights the name picker. Asks for: picking a name.

First up, your name. Every scan and every return carries the name of whoever's holding the phone. It's not about checking up on anyone. It's so that when something lands on the wrong job, and it happens, it takes ten seconds to find and fix instead of an afternoon of asking around. Pick your name from the list, or type it in if it's not there.

## 03-mobilize

> Spotlights the job picker on Gear out. Asks for: adding one item.

Gear heading out to a job starts here. Pick the job it's going to, and the camera opens right away. Scan the code on the machine, or the card on the shelf edge, and it pops onto the list. If a code won't read, there's a button to pick it from a list instead, and that's fine. It just gets marked, so the shop can see how much never got scanned. Go ahead and add one thing.

## 04-send

> Spotlights Send. Asks for: sending it.

That list is what's going out. Nothing's on the job until you send it, so you can pull the whole pile, check it against the van, and send it all in one go. Once you do, every item is on that job with your name and the time. Go ahead and send it now.

## 05-teardown

> Spotlights the list at tear down. Asks for: tapping one item back.

This is the part that gets the gear home. Open the job at tear down and you'll see everything still out on it. Tap things back as they go in the van, and the list shrinks right in front of you, so you know what's missing while you're still on site. And sweep the closets last, because that's usually where it is! Tap one item back.

## 06-transfer

> Spotlights site to site moves.

Moving a machine straight to the next job? It never has to come back through the shop. Scan it, pick the new job, and you're done. It's one step, not a return and then a check out, and the cost moves to the new job from that moment. If it's a negative air unit or a HEPA vacuum, the app will remind you it needs a fresh certificate on the new site before it runs.

## 07-find

> Spotlights the search box on Find. Asks for: typing something.

Twenty dehumidifiers, and you need to know where all twenty are? Type a name, a number or a serial, and it shows you where each one is, who took it, and when. JobTread doesn't track equipment at all, so this is the place to answer that question from now on. Type something in and have a look.

## 08-done

> Closing step.

And that's it! Out, back, moved and found. Everything you just did works with no signal, so a basement with no bars is no problem. The phone holds onto it and sends it when you're back in range. If you're in the office, the button at the top right opens jobs, ordering and certificates, with the one-time setup behind Settings. You can run this walkthrough again any time from Settings. Thanks, and welcome aboard!
