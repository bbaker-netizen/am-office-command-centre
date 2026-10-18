// A&M app: one-time setup. Tells JobTread to call the app whenever a job is
// created or changed. Run it once, after the app is deployed with Encircle.
//
// Needs a JobTread key from an A&M account with "updateOrganization" allowed.
//   JOBTREAD_GRANT_KEY=... ENCIRCLE_HOOK_KEY=... node register-jobtread-webhook.mjs
// ENCIRCLE_HOOK_KEY must be the same value saved in Netlify.
// Never save either key in this file, in Drive, or in an email.

const ORG = '22PRQFH4cHFm';
const APP = 'https://am-office-command-centre.netlify.app/api/encircle-hook';
const { JOBTREAD_GRANT_KEY: grantKey, ENCIRCLE_HOOK_KEY: hookKey } = process.env;

if (!grantKey || !hookKey) {
  console.error('Stop: set JOBTREAD_GRANT_KEY and ENCIRCLE_HOOK_KEY first.');
  process.exit(1);
}
if (hookKey.length < 32) {
  console.error('Stop: ENCIRCLE_HOOK_KEY must be at least 32 characters.');
  process.exit(1);
}

const res = await fetch('https://api.jobtread.com/pave', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    query: {
      $: { grantKey },
      createWebhook: {
        $: { organizationId: ORG, url: `${APP}?key=${hookKey}`, eventTypes: ['jobCreated', 'jobUpdated'] },
        createdWebhook: { id: {} },
      },
    },
  }),
});
const text = await res.text();
if (!res.ok || text.includes('error')) {
  console.error(`JobTread said ${res.status}. Nothing was set up.`);
  console.error(text.replace(hookKey, '[hook key]').slice(0, 500));
  process.exit(1);
}
console.log('Done. JobTread will now call the app when jobs change.');
console.log(text.replace(hookKey, '[hook key]'));
