# Changes 2026-11-15: natural voice for the new walkthrough steps

The 20 new walkthrough lines (My day, Cash flow, View as, What's new) now have recorded clips in the same natural voice (Andrew) as the rest of the tour, instead of the phone's own voice.

## How they were made

Claude's workspace cannot reach the voice service, so the clips are made in GitHub's cloud. A new GitHub Actions job (.github/workflows/narration-clips.yml):

- runs on any branch except main when the narration script changes, or by hand from the Actions tab;
- makes only clips that are missing, so existing clips (and any real recordings saved over them) are never touched;
- tries a clip again if the voice service answers with no audio;
- commits the new clips back to the same branch, so they arrive in the pull request.

To redo a clip after changing its words, delete its mp3 on a branch and push.

Also fixed: a note in the narration script would have been read out at the end of the payroll walkthrough's last clip if that clip were ever made again.

## Files

.github/workflows/narration-clips.yml (new), public/tour/cc (20 new clips), tools/Narration-Script-Command-Centre.md.
