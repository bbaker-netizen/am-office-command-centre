#!/usr/bin/env python3
"""
Turn a narration script into the mp3 clips a walkthrough plays.

    pip install edge-tts --break-system-packages
    python3 generate-narration.py Narration-Script.md ../my-app/public/tour

Reads a markdown script where every clip is a level-two heading naming
the file, and the prose under it is what gets spoken:

    ## ch0-welcome
    Welcome to NuvoCrew. This takes about four minutes.

    ## ch1-open-items
    Anything waiting on you shows up here first.

Writes ch0-welcome.mp3 and ch1-open-items.mp3 into the output folder.

Why edge-tts: it is free, needs no API key, and produces 24 kHz mono mp3
at 48 kbps, which is the same format the Builder app clips already use,
so a re-recorded clip and a generated one sit side by side without any
of them sounding different in kind. Voice defaults to Canadian.

These clips are placeholders with a long shelf life. On a client-facing
app they get replaced one at a time with Bruce's own voice: record it,
export mp3, save over the file under the same name, no code change. On
an internal tool they can stay as they are.

Options:
    --voice en-US-AndrewMultilingualNeural
                                Andrew is the default, and the choice is
                                deliberate. The Canadian voices
                                (en-CA-LiamNeural, en-CA-ClaraNeural) are
                                older models and read flat, like a
                                disclaimer. The multilingual voices are a
                                generation newer and sound like a person
                                explaining something, which matters more
                                than the accent being Canadian. Brian and
                                Ava are the other two worth auditioning.
    --rate -5%                  Slightly slower reads less like a
                                disclaimer. Default is -5%.
    --only ch3-threads          Regenerate a single clip.
    --list-voices               Print the English voices and exit.
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

try:
    import edge_tts
except ImportError:
    sys.exit(
        "edge-tts is not installed.\n"
        "  pip install edge-tts --break-system-packages"
    )

HEADING = re.compile(r"^##\s+([A-Za-z0-9._-]+)\s*$")
# Strip the light markdown a script picks up, so none of it gets spoken.
INLINE = [
    (re.compile(r"\*\*(.+?)\*\*"), r"\1"),
    (re.compile(r"\*(.+?)\*"), r"\1"),
    (re.compile(r"`(.+?)`"), r"\1"),
    (re.compile(r"\[(.+?)\]\((.+?)\)"), r"\1"),
]


def parse_script(path: Path) -> list[tuple[str, str]]:
    """Return [(clip name, spoken text)] in document order."""
    clips: list[tuple[str, list[str]]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.rstrip()
        m = HEADING.match(line)
        if m:
            clips.append((m.group(1), []))
            continue
        if not clips:
            continue  # preamble above the first clip
        if line.startswith("#"):
            continue  # a section header, not narration
        if line.strip().startswith(("<!--", "> ")):
            continue  # notes to the reader, never spoken
        clips[-1][1].append(line)

    out: list[tuple[str, str]] = []
    for name, lines in clips:
        text = " ".join(l.strip() for l in lines if l.strip())
        for pattern, repl in INLINE:
            text = pattern.sub(repl, text)
        text = re.sub(r"\s+", " ", text).strip()
        if text:
            out.append((name, text))
    return out


async def synth(text: str, dest: Path, voice: str, rate: str) -> None:
    comm = edge_tts.Communicate(text, voice, rate=rate)
    await comm.save(str(dest))


async def list_voices() -> None:
    for v in await edge_tts.list_voices():
        if v["Locale"].startswith("en-"):
            print(f"{v['ShortName']:<34} {v['Gender']:<7} {v['Locale']}")


def main() -> int:
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("script", nargs="?", help="Narration script markdown")
    ap.add_argument("outdir", nargs="?", help="Where the mp3s go, usually public/tour")
    ap.add_argument("--voice", default="en-US-AndrewMultilingualNeural")
    ap.add_argument("--rate", default="-5%")
    ap.add_argument("--only", default=None, help="Regenerate one clip by name")
    ap.add_argument("--list-voices", action="store_true")
    args = ap.parse_args()

    if args.list_voices:
        asyncio.run(list_voices())
        return 0

    if not args.script or not args.outdir:
        ap.print_usage()
        return 2

    script = Path(args.script)
    outdir = Path(args.outdir)
    if not script.is_file():
        print(f"No script at {script}", file=sys.stderr)
        return 1
    outdir.mkdir(parents=True, exist_ok=True)

    clips = parse_script(script)
    if not clips:
        print("No clips found. Each clip needs a '## clip-name' heading.", file=sys.stderr)
        return 1
    if args.only:
        clips = [c for c in clips if c[0] == args.only]
        if not clips:
            print(f"No clip named {args.only} in {script}", file=sys.stderr)
            return 1

    # edge-tts writes constant bitrate 48 kbps mono, so the real duration
    # falls straight out of the file size. Guessing from a word count was
    # out by a quarter and flagged clips that were fine.
    bytes_per_second = 48000 / 8
    failures = 0
    for name, text in clips:
        dest = outdir / f"{name}.mp3"
        try:
            asyncio.run(synth(text, dest, args.voice, args.rate))
        except Exception as exc:  # noqa: BLE001 - report and carry on
            print(f"  FAILED  {name}: {exc}", file=sys.stderr)
            failures += 1
            continue
        size = dest.stat().st_size
        secs = size / bytes_per_second
        flag = "  <-- over 35s, trim it" if secs > 35 else ""
        print(f"  {name:<28} {size:>7} bytes  {secs:5.1f}s{flag}")

    print(f"\n{len(clips) - failures} of {len(clips)} clips written to {outdir}")
    if failures:
        print("Some clips failed. Re-run with --only <name> once the cause is fixed.")
    return 1 if failures else 0


if __name__ == "__main__":
    raise SystemExit(main())
