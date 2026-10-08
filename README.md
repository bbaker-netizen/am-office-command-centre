# A&M Office Command Centre

The A&M app: the shop's inventory screens, the office screens, and the command centre at /command.html: 548 machines and the shelf, on crew phones, working
with no signal. Live at https://am-office-command-centre.netlify.app once the Netlify site
is renamed. Before that it was https://am-inventory.netlify.app

Plain JavaScript, no build step. Netlify serves `public/` and runs the three
functions in `netlify/functions/`.

**Bump `VERSION` in `public/sw.js` on every deploy.** Phones hold the whole app
so they can open in a basement, and that string is the only thing that tells a
phone a new version exists. Miss it and people keep running yesterday's app.
