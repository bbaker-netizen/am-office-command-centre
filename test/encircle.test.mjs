import { strict as assert } from 'node:assert';
import { syncJob, settings, jobIdFromWebhook, encircleClient, jobtreadClient } from '../netlify/functions/_encircle.mjs';

const env = { ENCIRCLE_MODE: 'test', ENCIRCLE_TOKEN: 't', ENCIRCLE_ORG_ID: 'O1', ENCIRCLE_BRAND_ID: '208451', JOBTREAD_GRANT_KEY: 'k', ENCIRCLE_CLAIM_URL: 'https://enc.example/claims/{id}' };
const testJob = { id: 'J1', number: '99-00001', closed: false, createdOn: '2026-09-01', address: '12650 118 Ave NW, Edmonton', client: 'Aldergrove Builders Inc.', status: 'Bid Accepted', pm: 'Ryan', hasEncircleComment: false };

function fakes(job, claims = []) {
  const log = { created: [], comments: [] };
  const jt = { getJob: async () => job && { ...job }, postComment: async (id, m) => log.comments.push(m) };
  const enc = {
    findByJobNumber: async (n) => claims.filter((c) => c.contractor_identifier === n),
    create: async (f) => { const c = { id: 'C' + (claims.length + 1), permalink_url: 'https://app.encircleapp.com/c/' + (claims.length + 1), ...f }; claims.push(c); log.created.push(f); return c; },
  };
  return { jt, enc, log, claims };
}
let n = 0;
async function t(name, fn) { await fn(); n++; console.log('ok', name); }

await t('off does nothing', async () => {
  const f = fakes(testJob);
  const r = await syncJob('J1', { s: settings({ ...env, ENCIRCLE_MODE: 'off' }), ...f });
  assert.equal(r.result, 'off'); assert.equal(f.log.created.length, 0);
});
await t('missing token stops', async () => {
  const f = fakes(testJob);
  const r = await syncJob('J1', { s: settings({ ...env, ENCIRCLE_TOKEN: '' }), ...f });
  assert.equal(r.result, 'problem'); assert.match(r.why, /ENCIRCLE_TOKEN/);
});
await t('test mode ignores real jobs', async () => {
  const f = fakes({ ...testJob, number: '26-00640' });
  const r = await syncJob('J1', { s: settings(env), ...f });
  assert.equal(r.result, 'skip'); assert.equal(f.log.created.length, 0);
});
await t('test mode creates TEST job with TEST prefix and comment', async () => {
  const f = fakes(testJob);
  const r = await syncJob('J1', { s: settings(env), ...f });
  assert.equal(r.result, 'created');
  assert.equal(f.log.created[0].contractor_identifier, '99-00001');
  assert.equal(f.log.created[0].policyholder_name, 'TEST - Aldergrove Builders Inc.');
  assert.equal(f.log.created[0].organization_id, 'O1');
  assert.equal(f.log.comments.length, 1); assert.match(f.log.comments[0], /app\.encircleapp\.com\/c\/1/);
  assert.equal(f.log.created[0].brand_id, 208451);
});
await t('second run does not duplicate', async () => {
  const f = fakes(testJob);
  await syncJob('J1', { s: settings(env), ...f });
  const r = await syncJob('J1', { s: settings(env), ...f, jt: { ...f.jt, getJob: async () => ({ ...testJob, hasEncircleComment: true }) } });
  assert.equal(r.result, 'linked'); assert.equal(f.log.created.length, 1); assert.equal(f.log.comments.length, 1);
});
await t('existing Encircle job gets linked and one comment', async () => {
  const f = fakes(testJob, [{ id: 'X9', contractor_identifier: '99-00001', permalink_url: 'https://app.encircleapp.com/c/x9' }]);
  const r = await syncJob('J1', { s: settings(env), ...f });
  assert.equal(r.result, 'linked'); assert.equal(f.log.created.length, 0); assert.equal(f.log.comments.length, 1);
  assert.match(f.log.comments[0], /c\/x9/);
});
await t('two Encircle jobs is a problem, nothing made', async () => {
  const f = fakes(testJob, [{ id: 'A', contractor_identifier: '99-00001' }, { id: 'B', contractor_identifier: '99-00001' }]);
  const r = await syncJob('J1', { s: settings(env), ...f });
  assert.equal(r.result, 'problem'); assert.equal(f.log.created.length, 0);
});
await t('not awarded yet is skipped', async () => {
  const f = fakes({ ...testJob, status: 'Estimate Sent' });
  assert.equal((await syncJob('J1', { s: settings(env), ...f })).result, 'skip');
});
await t('Pending and Follow Up Required are not awarded', async () => {
  for (const status of ['Pending', 'Follow Up Required', 'Invoicing', 'Closed Won']) {
    const f = fakes({ ...testJob, status });
    assert.equal((await syncJob('J1', { s: settings(env), ...f })).result, 'skip', status);
  }
});
await t('closed job is skipped', async () => {
  const f = fakes({ ...testJob, closed: true });
  assert.equal((await syncJob('J1', { s: settings(env), ...f })).result, 'skip');
});
await t('no address stops', async () => {
  const f = fakes({ ...testJob, address: '' });
  const r = await syncJob('J1', { s: settings(env), ...f });
  assert.equal(r.result, 'problem'); assert.equal(f.log.created.length, 0);
});
await t('live mode needs a start date', async () => {
  const f = fakes({ ...testJob, number: '26-00700' });
  const r = await syncJob('J1', { s: settings({ ...env, ENCIRCLE_MODE: 'live' }), ...f });
  assert.equal(r.result, 'problem'); assert.match(r.why, /ENCIRCLE_START_DATE/);
});
await t('live mode: old job goes to match-by-hand', async () => {
  const f = fakes({ ...testJob, number: '26-00640', createdOn: '2026-08-01' });
  const r = await syncJob('J1', { s: settings({ ...env, ENCIRCLE_MODE: 'live', ENCIRCLE_START_DATE: '2026-10-20' }), ...f });
  assert.equal(r.result, 'match-by-hand'); assert.equal(f.log.created.length, 0);
});
await t('live mode: new job is created with real client name', async () => {
  const f = fakes({ ...testJob, number: '26-00700', createdOn: '2026-10-21' });
  const r = await syncJob('J1', { s: settings({ ...env, ENCIRCLE_MODE: 'live', ENCIRCLE_START_DATE: '2026-10-20' }), ...f });
  assert.equal(r.result, 'created'); assert.equal(f.log.created[0].policyholder_name, 'Aldergrove Builders Inc.');
});
await t('live mode: old job already in Encircle is still linked', async () => {
  const f = fakes({ ...testJob, number: '26-00640', createdOn: '2026-08-01' }, [{ id: 'Z', contractor_identifier: '26-00640' }]);
  const r = await syncJob('J1', { s: settings({ ...env, ENCIRCLE_MODE: 'live', ENCIRCLE_START_DATE: '2026-10-20' }), ...f });
  assert.equal(r.result, 'linked');
});
await t('Encircle search filter not working fails closed', async () => {
  const fakeFetch = async () => new Response(JSON.stringify([{ id: 'Q', contractor_identifier: '26-00001' }]), { status: 200 });
  const enc = encircleClient(settings(env), fakeFetch);
  await assert.rejects(() => enc.findByJobNumber('99-00001'), /Stopping so nothing is duplicated/);
});
await t('Encircle error codes are reported', async () => {
  const enc = encircleClient(settings(env), async () => new Response('no', { status: 401 }));
  await assert.rejects(() => enc.findByJobNumber('99-00001'), /401/);
});
await t('JobTread pages are all walked and counted', async () => {
  let call = 0;
  const pages = [{ count: 3, nextPage: 'p2', nodes: [{ id: 'a' }, { id: 'b' }] }, { count: 3, nextPage: null, nodes: [{ id: 'c' }] }];
  const jt = jobtreadClient(settings(env), async () => new Response(JSON.stringify({ organization: { jobs: pages[call++] } })));
  assert.deepEqual(await jt.awardedJobIds(), ['a', 'b', 'c']);
});
await t('JobTread short count is an error', async () => {
  const jt = jobtreadClient(settings(env), async () => new Response(JSON.stringify({ organization: { jobs: { count: 5, nextPage: null, nodes: [{ id: 'a' }] } } })));
  await assert.rejects(() => jt.awardedJobIds(), /only 1 came back/);
});
await t('fallback link used when Encircle gives none', async () => {
  const f = fakes(testJob, [{ id: 'Y1', contractor_identifier: '99-00001' }]);
  await syncJob('J1', { s: settings(env), ...f });
  assert.match(f.log.comments[0], /enc\.example\/claims\/Y1/);
});
await t('webhook job id found in several shapes', async () => {
  assert.equal(jobIdFromWebhook({ job: { id: '22PfLAwMzfAn' } }), '22PfLAwMzfAn');
  assert.equal(jobIdFromWebhook({ data: { id: '22PfLAwMzfAn' } }), '22PfLAwMzfAn');
  assert.equal(jobIdFromWebhook({ nothing: 1 }), null);
  assert.equal(jobIdFromWebhook(null), null);
});
console.log(`\nAll ${n} tests passed.`);
