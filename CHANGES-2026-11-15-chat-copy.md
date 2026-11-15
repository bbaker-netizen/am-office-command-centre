# Changes 2026-11-15: copying from Ask Claude

Phone version am-inv-v75.

## What went wrong

On 6 November Craig copied a reply out of Ask Claude and pasted it into his own Claude. A block of instruction text came with it that he never saw on screen.

The cause was the "Continue in my own Claude" link under the chat. To save a step, the app kept that link filled in all the time with a ready-made prompt: "I am looking at the A&M Abatement Office Command Centre, on the ... page. This is what it shows:" followed by up to 1,800 characters of the page. A selection that ran over the link copied the link too, and pasting it brought the whole hidden prompt along.

## What changed

- The prompt for the person's own Claude is built only at the moment the link is pressed, then cleared. Nothing hidden sits in the chat any more.
- Copying anything inside the chat now copies plain words only, with no links or hidden parts.
- Each answer has its own Copy button that copies exactly the words of that answer.
- The link, the suggestion chips and the Copy buttons cannot be selected, so they never ride along in a copy.

Nothing changed in what Claude is told or what it can see.
