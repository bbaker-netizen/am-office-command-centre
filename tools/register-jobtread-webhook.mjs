// A&M app: tells JobTread to call the app whenever a job is created or changed.
// Safe to run again: it removes any earlier trigger pointing at the app,
// so JobTread never calls the app twice for one change.
//
// Run it from the folder this file is in:
//   node register-jobtread-webhook.mjs
// It asks for the two keys, so nothing has to be typed on the command line
// (PowerShell changes keys that contain $ and similar symbols).
//   JobTread grant key: from an A&M admin login.
//   Hook key: exactly the value of ENCIRCLE_HOOK_KEY in Netlify.
// Never save either key in this file, in Drive, or in an email.

import { createInterface } from 'node:readline/promises';

const ORG = '22PRQFH4cHFm';
const APP = 'https://am-office-command-centre.netlify.app/api/encircle-hook';

async function ask(question) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(question);
  rl.close();
  return answer.trim();
}

const grantKey = process.env.JOBTREAD_GRANT_KEY || await ask('Paste the JobTread grant key, then press Enter: ');
const hookKey = process.env.ENCIRCLE_HOOK_KEY || await ask('Paste ENCIRCLE_HOOK_KEY from Netlify, then press Enter: ');
console.clear();

if (!grantKey || !hookKey) { console.error('Stop: both keys are needed. Nothing was changed.'); process.exit(1); }
if (hookKey.length < 32) { console.error('Stop: the hook key must be at least 32 characters. Nothing was changed.'); process.exit(1); }

const hide = (t) => String(t).split(hookKey).join('[hook key]').split(encodeURIComponent(hookKey)).join('[hook key]').split(grantKey).join('[grant key]');

async function pave(query) {
  const res = await fetch('https://api.jobtread.com/pave', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: { $: { grantKey }, ...query } }),
  });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch (e) { data = null; }
  if (!res.ok || !data || text.includes('"error')) {
    console.error(`JobTread said ${res.status}: ${hide(text).slice(0, 400)}`);
    return null;
  }
  return data;
}

// 1. Find triggers already pointing at the app.
const list = await pave({ organization: { $: { id: ORG }, webhooks: { $: { size: 100 }, nodes: { id: {}, url: {} } } } });
if (!list) { console.error('Could not read the existing triggers. Nothing was changed.'); process.exit(1); }
const old = (list.organization?.webhooks?.nodes || []).filter((w) => String(w.url || '').startsWith(APP));

// 2. Make the new one. The key is encoded so symbols survive the web address.
const made = await pave({
  createWebhook: {
    $: { organizationId: ORG, url: `${APP}?key=${encodeURIComponent(hookKey)}`, eventTypes: ['jobCreated', 'jobUpdated'] },
    createdWebhook: { id: {} },
  },
});
if (!made) { console.error('Could not make the new trigger. The old one, if any, was left in place.'); process.exit(1); }

// 3. Only then remove the old ones, so there is never a moment with none.
for (const w of old) {
  const gone = await pave({ deleteWebhook: { $: { id: w.id } } });
  console.log(gone ? `Removed an older trigger (${w.id}).` : `Could not remove older trigger ${w.id}. Tell Claude.`);
}
console.log('Done. JobTread will now call the app when jobs change.');
