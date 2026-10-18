// A&M Abatement - Encircle connection check
//
// What it does: proves the Encircle token works and shows the exact field
// names Encircle wants, before anything is built into the app.
// It only reads, unless you add --create. Then it makes ONE claim in
// Encircle for the TEST job 99-00001 and nothing else.
//
// How to run (Node 18 or newer):
//   ENCIRCLE_TOKEN=paste-token-here node encircle-check.mjs
//   ENCIRCLE_TOKEN=paste-token-here node encircle-check.mjs --create
//
// Never save the token in this file, in Drive, or in an email.

const BASE = 'https://api.encircleapp.com';
const TOKEN = process.env.ENCIRCLE_TOKEN;
const CREATE = process.argv.includes('--create');

const TEST_JOB = {
  number: '99-00001',
  client: 'TEST - Aldergrove Builders Inc.',
  address: '12650 118 Ave NW, Edmonton, AB T5L 2K6',
};

if (!TOKEN) {
  console.error('Stop: ENCIRCLE_TOKEN is not set. See the run line at the top of this file.');
  process.exit(1);
}

const headers = { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' };

async function call(method, path, body) {
  const res = await fetch(BASE + path, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const text = await res.text();
  let data = null;
  try { data = JSON.parse(text); } catch { data = text; }
  return { status: res.status, data };
}

function list(data) {
  if (Array.isArray(data)) return data;
  if (data && Array.isArray(data.list)) return data.list;
  if (data && Array.isArray(data.data)) return data.data;
  return [];
}

function resolveRef(spec, schema) {
  let s = schema;
  while (s && s.$ref) {
    const parts = s.$ref.replace('#/', '').split('/');
    s = parts.reduce((o, k) => (o ? o[k] : undefined), spec);
  }
  return s;
}

async function main() {
  // 1. Encircle's own published spec, so we use their real field names.
  console.log('\n1. Reading Encircle API spec');
  let spec = null;
  const specRes = await fetch(BASE + '/openapi_v3.json');
  if (specRes.ok) spec = await specRes.json();
  let claimFields = [];
  let claimRequired = [];
  let mediaPath = null;
  if (!spec) {
    console.log('   Could not read the spec. Carry on, but do not use --create.');
  } else {
    const paths = Object.keys(spec.paths || {});
    console.log(`   ${paths.length} paths found:`);
    for (const p of paths) console.log(`   ${Object.keys(spec.paths[p]).join(',').toUpperCase().padEnd(20)} ${p}`);
    const post = spec.paths['/v1/property_claims'] && spec.paths['/v1/property_claims'].post;
    const schema = post && resolveRef(spec, post.requestBody?.content?.['application/json']?.schema);
    claimFields = Object.keys(schema?.properties || {});
    claimRequired = schema?.required || [];
    console.log('   New claim fields:', claimFields.join(', ') || '(none listed)');
    console.log('   Required:', claimRequired.join(', ') || '(none listed)');
    mediaPath = paths.find((p) => p.includes('/v1/property_claims/{') && p.includes('media')) || null;
    console.log('   Photo path:', mediaPath || '(not found)');
  }

  // 2. Which Encircle organization and brand A&M is.
  console.log('\n2. Organization and brand');
  const orgs = await call('GET', '/v1/organizations');
  if (orgs.status === 401) {
    console.error('   Stop: Encircle refused the token (401). Make a new one under Settings, Bots/Public API.');
    process.exit(1);
  }
  const orgList = list(orgs.data);
  const brandsByOrg = {};
  for (const o of orgList) {
    const b = await call('GET', `/v1/organizations/${o.id}/brands`);
    brandsByOrg[o.id] = list(b.data);
    console.log(`   Organization ${o.id} ${o.name || ''}`);
    for (const br of brandsByOrg[o.id]) console.log(`      Brand ${br.id} ${br.name || ''}`);
  }

  // 3. What an existing claim looks like (field names only, no client details).
  console.log('\n3. Shape of an existing claim');
  const claims = await call('GET', '/v1/property_claims?limit=1');
  const first = list(claims.data)[0];
  console.log('   Fields on a claim:', first ? Object.keys(first).join(', ') : '(no claims returned)');

  // 4. Duplicate check: is the TEST job already in Encircle?
  console.log('\n4. Looking for the TEST job', TEST_JOB.number);
  const found = await call('GET', `/v1/property_claims?contractor_identifier=${encodeURIComponent(TEST_JOB.number)}&limit=10`);
  const matches = list(found.data).filter((c) => c.contractor_identifier === TEST_JOB.number);
  console.log(`   ${matches.length} match(es).`);
  for (const m of matches) console.log(`   Claim ${m.id}`);

  // 5. Optional: make the TEST claim, then read its photos.
  if (!CREATE) {
    console.log('\nDone. Read only. Send the output above (it holds no token) to Claude.');
    return;
  }
  if (matches.length) {
    console.log('\nStop: TEST job is already in Encircle. Nothing created.');
    return;
  }
  if (orgList.length !== 1 || (brandsByOrg[orgList[0].id] || []).length !== 1) {
    console.log('\nStop: more than one organization or brand. Tell Claude which one to use.');
    return;
  }
  const payload = {
    organization_id: orgList[0].id,
    brand_id: brandsByOrg[orgList[0].id][0].id,
    contractor_identifier: TEST_JOB.number,
    policyholder_name: TEST_JOB.client,
    full_address: TEST_JOB.address,
  };
  const unknown = Object.keys(payload).filter((k) => claimFields.length && !claimFields.includes(k));
  const missing = claimRequired.filter((k) => !(k in payload));
  if (!claimFields.length || unknown.length || missing.length) {
    console.log('\nStop: field names do not match the spec. Nothing created.');
    console.log('   Not in spec:', unknown.join(', ') || 'none', '| Missing required:', missing.join(', ') || 'none');
    return;
  }
  const made = await call('POST', '/v1/property_claims', payload);
  console.log(`\n5. Create returned ${made.status}`);
  const id = made.data && made.data.id;
  if (!id) { console.log('   No claim id came back:', JSON.stringify(made.data).slice(0, 300)); return; }
  console.log('   New TEST claim id:', id);
  if (mediaPath) {
    const media = await call('GET', mediaPath.replace(/\{[^}]+\}/, id));
    console.log(`   Photos on it: ${list(media.data).length} (expect 0 until someone adds one)`);
  }
  console.log('\nDone. Add one photo to this claim in the Encircle app, then run without --create to confirm.');
}

main().catch((e) => { console.error('Error:', e.message); process.exit(1); });
