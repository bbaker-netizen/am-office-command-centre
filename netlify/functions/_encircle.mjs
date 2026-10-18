// A&M app: Encircle link.
//
// Encircle owns site photos. JobTread owns jobs. The join between them is our
// JobTread job number (for example 26-00640), stored on the Encircle job as
// the contractor identifier. Nothing else is copied, and no JobTread field is
// used (jobs already hold the 25-field maximum).
//
// When a job is awarded, the app makes the Encircle job and posts one pinned,
// internal-only comment on the JobTread job saying so.

export const AWARDED = [
  'Bid Accepted',
  'Upcoming To Be Scheduled',
  'Scheduling required',
  'Scheduled (Date promised)',
  'Turnover Meeting Required',
  'NOP',
  'Site work',
];
export const TEST_JOB_NUMBER = '99-00001';
export const COMMENT_SUBJECT = 'Encircle';

// Encircle field names, confirmed against Encircle's own spec on 2026-10-18.
// Only organization_id and brand_id are required by Encircle.
export const F = {
  org: 'organization_id',
  brand: 'brand_id',
  jobNumber: 'contractor_identifier',
  client: 'policyholder_name',
  address: 'full_address',
  pm: 'project_manager_name',
  link: 'permalink_url',
};

export function settings(env = process.env) {
  return {
    // off: does nothing. test: only the TEST job 99-00001. live: real jobs.
    mode: String(env.ENCIRCLE_MODE || 'off').toLowerCase(),
    // In live mode, only jobs created on or after this date (YYYY-MM-DD) get
    // a new Encircle job. Older jobs are listed for a person to match by hand,
    // because many already have an Encircle job made without our job number.
    startDate: env.ENCIRCLE_START_DATE || '',
    token: env.ENCIRCLE_TOKEN || '',
    orgId: env.ENCIRCLE_ORG_ID || '',
    brandId: env.ENCIRCLE_BRAND_ID || '',
    // Only a fallback: Encircle gives each job its own link (permalink_url).
    claimUrl: env.ENCIRCLE_CLAIM_URL || '',
    jtKey: env.JOBTREAD_GRANT_KEY || '',
    jtOrg: env.JOBTREAD_ORG_ID || '22PRQFH4cHFm',
  };
}

// The app's own JobTread key, the one pasted in Settings, JobTread. Using it
// keeps one copy of the key. JOBTREAD_GRANT_KEY in Netlify only overrides it.
export const STORE = 'am-inventory';
export const SWEEP_KEY = 'encircle-last-sweep';
export async function loadSettings(store, env = process.env) {
  const s = settings(env);
  if (!s.jtKey && store) {
    try {
      const c = (await store.get('jobtread-key', { type: 'json' })) || {};
      s.jtKey = c.grantKey || '';
      if (c.organizationId) s.jtOrg = c.organizationId;
    } catch (e) {}
  }
  return s;
}

export function missingSettings(s) {
  const need = { ENCIRCLE_TOKEN: s.token, ENCIRCLE_ORG_ID: s.orgId, ENCIRCLE_BRAND_ID: s.brandId, 'the JobTread key (Settings, JobTread)': s.jtKey };
  if (s.mode === 'live') need.ENCIRCLE_START_DATE = s.startDate;
  return Object.keys(need).filter((k) => !need[k]);
}

function asList(d) {
  if (Array.isArray(d)) return d;
  if (d && Array.isArray(d.list)) return d.list;
  if (d && Array.isArray(d.data)) return d.data;
  return [];
}

export function encircleClient(s, fetchFn = fetch) {
  async function call(method, path, body) {
    const res = await fetchFn('https://api.encircleapp.com' + path, {
      method,
      headers: { Authorization: `Bearer ${s.token}`, 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { data = text; }
    if (!res.ok) throw new Error(`Encircle ${method} ${path.split('?')[0]} returned ${res.status}`);
    return data;
  }

  return {
    // Fails closed: if Encircle hands back any claim that is not this job,
    // the search filter is not working and creating would risk a duplicate.
    async findByJobNumber(n) {
      const rows = asList(await call('GET', `/v1/property_claims?${F.jobNumber}=${encodeURIComponent(n)}&limit=10`));
      if (rows.some((c) => c[F.jobNumber] !== n)) {
        throw new Error('Encircle search by job number returned other jobs. Stopping so nothing is duplicated.');
      }
      return rows;
    },
    async create(fields) {
      return call('POST', '/v1/property_claims', fields);
    },
    async photoCount(claimId) {
      return asList(await call('GET', `/v1/property_claims/${claimId}/media?limit=100`)).length;
    },
  };
}

export function jobtreadClient(s, fetchFn = fetch) {
  async function pave(query) {
    const res = await fetchFn('https://api.jobtread.com/pave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query: { $: { grantKey: s.jtKey }, ...query } }),
    });
    let data = null;
    try { data = await res.json(); } catch { data = null; }
    if (!res.ok || !data) throw new Error(`JobTread returned ${res.status}`);
    return data;
  }

  return {
    async getJob(id) {
      const d = await pave({
        job: {
          $: { id },
          id: {}, number: {}, name: {}, closedOn: {}, createdAt: {},
          location: { address: {}, account: { name: {} } },
          customFieldValues: { $: { size: 50 }, nodes: { value: {}, customField: { name: {} } } },
          comments: { $: { size: 100 }, nodes: { name: {} } },
        },
      });
      const j = d.job;
      if (!j) return null;
      const cf = {};
      for (const n of j.customFieldValues?.nodes || []) cf[n.customField?.name] = n.value;
      return {
        id: j.id,
        number: j.number || '',
        name: j.name || '',
        closed: Boolean(j.closedOn),
        createdOn: String(j.createdAt || '').slice(0, 10),
        address: j.location?.address || '',
        client: j.location?.account?.name || '',
        status: cf['Status'] || '',
        pm: cf['Project Manager'] || '',
        hasEncircleComment: (j.comments?.nodes || []).some((c) => c.name === COMMENT_SUBJECT),
      };
    },

    // Every open job at an awarded status, walking all pages.
    async awardedJobIds() {
      const ids = [];
      let page = null;
      let total = null;
      do {
        const d = await pave({
          organization: {
            $: { id: s.jtOrg },
            jobs: {
              $: {
                size: 100,
                ...(page ? { page } : {}),
                with: { st: { _: 'customFieldValues', $: { where: { and: [[['customField', 'name'], 'Status'], ['value', 'in', AWARDED]] } }, count: {} } },
                where: { and: [['closedOn', null], [['st', 'count'], '>', 0]] },
              },
              count: {}, nextPage: {}, nodes: { id: {} },
            },
          },
        });
        const jobs = d.organization.jobs;
        total = jobs.count;
        for (const n of jobs.nodes) ids.push(n.id);
        page = jobs.nextPage;
      } while (page);
      // Same lesson as the 100-job fault in September: say so if we come up short.
      if (total !== null && ids.length !== total) {
        throw new Error(`JobTread said ${total} awarded jobs but only ${ids.length} came back.`);
      }
      return ids;
    },

    async postComment(jobId, message) {
      await pave({
        createComment: {
          $: {
            targetType: 'job', targetId: jobId, name: COMMENT_SUBJECT, message,
            isPinned: true, isVisibleToInternalRoles: true,
            isVisibleToCustomerRoles: false, isVisibleToVendorRoles: false,
          },
          createdComment: { id: {} },
        },
      });
    },
  };
}

// Encircle's brand id is a number; settings arrive as text.
function brandValue(v) {
  return /^\d+$/.test(String(v)) ? Number(v) : v;
}

function commentText(s, job, claim, made) {
  const claimId = claim && claim.id;
  const link = (claim && claim[F.link]) || (s.claimUrl && claimId ? s.claimUrl.replace('{id}', claimId) : '');
  const first = made
    ? `The A&M app made the Encircle job for ${job.number}.`
    : `This job is linked to its Encircle job.`;
  const where = link ? `Open it here: ${link}` : `In Encircle, search for ${job.number}.`;
  return `${first} ${where} Site photos go in Encircle only.`;
}

// Decide and act for one JobTread job. Returns what happened, in plain words.
export async function syncJob(jobId, { s, jt, enc }) {
  const out = (result, why, extra = {}) => ({ jobId, result, why, ...extra });

  if (s.mode === 'off') return out('off', 'ENCIRCLE_MODE is off.');
  const missing = missingSettings(s);
  if (missing.length) return out('problem', `Missing settings: ${missing.join(', ')}.`);

  const job = await jt.getJob(jobId);
  if (!job) return out('skip', 'Job not found in JobTread.');
  const base = { number: job.number };

  if (s.mode === 'test' && job.number !== TEST_JOB_NUMBER) return out('skip', 'Test mode: only the TEST job is touched.', base);
  if (job.closed) return out('skip', 'Job is closed.', base);
  if (!AWARDED.includes(job.status)) return out('skip', `Status is ${job.status || 'blank'}, not awarded yet.`, base);
  if (!job.number) return out('problem', 'Job has no job number.', base);

  const found = await enc.findByJobNumber(job.number);
  if (found.length > 1) {
    return out('problem', `${found.length} Encircle jobs carry ${job.number}. A person must merge them in Encircle.`, base);
  }
  if (found.length === 1) {
    const claimId = found[0].id;
    if (!job.hasEncircleComment) await jt.postComment(job.id, commentText(s, job, found[0], false));
    return out('linked', 'Already in Encircle.', { ...base, claimId });
  }

  if (s.mode === 'live' && (!job.createdOn || job.createdOn < s.startDate)) {
    return out('match-by-hand', `Opened ${job.createdOn || 'on an unknown date'}, before go-live. It may already be in Encircle under another name. Add ${job.number} to that Encircle job, or tell the office to let the app make one.`, base);
  }
  if (!job.address) return out('problem', 'No site address in JobTread. Add it, and the app will try again.', base);
  if (!job.client) return out('problem', 'No client on the JobTread job.', base);

  const fields = {
    [F.org]: s.orgId,
    [F.brand]: brandValue(s.brandId),
    [F.jobNumber]: job.number,
    [F.client]: s.mode === 'test' ? `TEST - ${job.client}` : job.client,
    [F.address]: job.address,
  };
  if (job.pm) fields[F.pm] = job.pm;

  const made = await enc.create(fields);
  const claimId = made && made.id;
  if (!claimId) return out('problem', 'Encircle did not return an id. Check Encircle before trying again.', base);

  // Two runs at the same moment could both create. Check, and say so if they did.
  const after = await enc.findByJobNumber(job.number);
  if (after.length > 1) {
    return out('problem', `Encircle now has ${after.length} jobs for ${job.number}. Delete the extra one in Encircle.`, { ...base, claimId });
  }

  await jt.postComment(job.id, commentText(s, job, made, true));
  return out('created', 'Encircle job made and comment posted.', { ...base, claimId });
}

// Pull a JobTread job id out of a webhook body, whatever shape it arrives in.
// The body is only a hint: syncJob always re-reads the job from JobTread.
export function jobIdFromWebhook(body) {
  if (!body || typeof body !== 'object') return null;
  const tries = [body.job?.id, body.data?.job?.id, body.data?.id, body.record?.id, body.targetId, body.id];
  const hit = tries.find((v) => typeof v === 'string' && v.length > 5);
  return hit || null;
}
