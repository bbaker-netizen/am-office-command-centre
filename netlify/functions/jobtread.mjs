/* A&M Abatement Services - JobTread connector.

   JobTread holds no equipment, no assets, no serials and no inventory. Nothing
   about where a machine is can live over there, so this connector is one-way
   by design: cost goes out, job records come in, and equipment location stays
   here permanently.

   Five rules are baked in because breaking any of them is expensive:

   1. The grant key never leaves the server. JobTread answers cross-origin
      requests from any website, so a key sitting in phone code is a key anyone
      can read. It is stored in its own blob and is never included in anything
      the app sends to a phone.

   2. notify defaults to TRUE on the JobTread side. Every write here sets it
      false. Without that, a catch-up push emails real customers and pages real
      crew about work that happened last week.

   3. Actual cost cannot be written. JobTread adds it up from bills and time
      entries. Writing a quantity onto a budget line edits the ESTIMATE, moves
      the budget, and makes every variance column meaningless. This file never
      touches a budget line's quantity or unit cost.

   4. Internal bills set qboIsIgnored. An A&M-to-A&M bill flowing into
      QuickBooks corrupts payables. Real vendor bills are not this connector's
      business and are left alone.

   5. There is no upsert and no unique constraint. Every create queries first
      and writes only on an empty result, keyed on a custom field that carries
      our own job id. */

import { authGate, requireOffice } from "./_auth.mjs";
import { getStore } from "@netlify/blobs";

const STORE = "am-inventory";
const KEY_BLOB = "jobtread-key";
const LOG_BLOB = "jobtread-log";
const PAVE = "https://api.jobtread.com/pave";

const store = () => getStore({ name: STORE, consistency: "strong" });

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

async function creds() {
  return (await store().get(KEY_BLOB, { type: "json" })) || null;
}

/* JobTread publishes no rate limit and returns no rate-limit headers, so there
   is no signal to back off against. You find the ceiling by hitting it. Writes
   are therefore paced and never fanned out. */
const wait = ms => new Promise(r => setTimeout(r, ms));
let lastCall = 0;
async function pace(gapMs = 250) {
  const since = Date.now() - lastCall;
  if (since < gapMs) await wait(gapMs - since);
  lastCall = Date.now();
}

async function pave(query, grantKey) {
  await pace();
  const body = { query: { $: { grantKey }, ...query } };
  const r = await fetch(PAVE, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await r.text();
  let parsed;
  try { parsed = JSON.parse(text); } catch { parsed = { raw: text }; }
  if (!r.ok) {
    const msg = typeof parsed === "string" ? parsed : (parsed.raw || parsed.message || `HTTP ${r.status}`);
    const err = new Error(`JobTread refused the request: ${msg}`.slice(0, 400));
    err.status = r.status;
    throw err;
  }
  return parsed;
}

async function log(entry) {
  const s = store();
  const doc = (await s.get(LOG_BLOB, { type: "json" })) || { entries: [] };
  doc.entries.unshift({ at: new Date().toISOString(), ...entry });
  doc.entries = doc.entries.slice(0, 300);
  await s.setJSON(LOG_BLOB, doc);
}

/* ------------------------------------------------------------------ actions */

/* Answers the one blocking question in the spec: JobTread has no native job
   status. What A&M calls "won" is a text string somebody typed into an option
   custom field. Match the string wrong and the query returns zero rows without
   erroring, which looks exactly like "no won jobs this week". This lists the
   real field ids and the real option strings so they can be picked, not
   guessed. */
/* JobTread's schema is not published and there is no introspection, so the
   exact shape of a custom field's options had to be found by asking. It is not
   a nested list. Asking for it as one comes back as:
   'The field "nodes" is not expected at organization.customFields.nodes.options'

   So: ask for options as a plain value, and if even that is refused, ask for
   the fields without them. Better to hand somebody a list of fields and let
   them type the option than to fail the whole screen. */
function normaliseOptions(raw) {
  if (!raw) return [];
  if (Array.isArray(raw)) {
    return raw.map(o => (o && typeof o === 'object')
      ? { id: o.id ?? o.value ?? o.name, name: o.name ?? o.label ?? o.value ?? String(o.id) }
      : { id: String(o), name: String(o) });
  }
  if (typeof raw === 'object') {
    // An object keyed by id, which is how JobTread returns several of these.
    return Object.entries(raw).map(([k, v]) => ({
      id: k,
      name: (v && typeof v === 'object') ? (v.name ?? v.label ?? k) : String(v ?? k)
    }));
  }
  return [];
}

/* Two queries, not one, and this is the whole trick.

   Asking for `options` alongside the other fields makes JobTread hand back ONLY
   the fields that have options. A&M has eleven custom fields on Job and that
   query returned two, both picklists, which made a plain text field look as
   though it had never been created. Somebody had made it correctly and was
   being told it was not there.

   So: ask once without options to get everything, ask again with options to get
   the picklist values, and join them on id. */
/* JobTread pages everything and caps a page at 100. Ask for more and it refuses
   outright: "Expected size of 400 to be no more than 100". Ask for none and it
   quietly hands back a short default, which is what made eleven job fields look
   like two and had somebody being told to create a field that was already
   sitting there. Always name a size, and never go above 100. */
const PAGE = 100;

async function fetchFields(grantKey, organizationId, nodes) {
  const res = await pave({
    organization: {
      $: { id: organizationId }, id: {}, name: {},
      customFields: { $: { size: PAGE }, nodes }
    }
  }, grantKey);
  return res?.organization?.customFields?.nodes || [];
}

/* The organisation-level list does not return everything. A&M has eleven
   custom fields on Job and it hands back two. Rather than keep guessing at why,
   ask a second way that is known to work: read the fields off real jobs, which
   is the same shape the job pull already uses. Whatever either route finds gets
   merged, so a field only has to show up once to be usable. */
async function fieldsSeenOnJobs(grantKey, organizationId) {
  const res = await pave({
    organization: {
      $: { id: organizationId },
      id: {},
      jobs: {
        $: term
          ? { size: 25, sortBy: [{ field: "createdAt", order: "desc" }],
              where: { or: [["name", "like", "%" + term + "%"], ["number", "like", "%" + term + "%"]] } }
          : { size: 25, sortBy: [{ field: "createdAt", order: "desc" }] },
        nodes: {
          id: {},
          customFieldValues: {
            nodes: { id: {}, customField: { id: {}, name: {}, type: {} } }
          }
        }
      }
    }
  }, grantKey);

  const seen = new Map();
  for (const j of (res?.organization?.jobs?.nodes || [])) {
    for (const v of (j.customFieldValues?.nodes || [])) {
      const cf = v.customField;
      if (cf && cf.id && !seen.has(cf.id)) seen.set(cf.id, { id: cf.id, name: cf.name, type: cf.type });
    }
  }
  return [...seen.values()];
}

async function discoverFields(grantKey, organizationId) {
  const merged = new Map();
  const add = f => {
    if (!f || !f.id) return;
    const prev = merged.get(f.id) || {};
    merged.set(f.id, {
      id: f.id,
      name: f.name ?? prev.name,
      type: f.type ?? prev.type,
      options: (f.options && f.options.length) ? f.options : (prev.options || [])
    });
  };

  // Route one: the organisation list, with and without options.
  try {
    const base = await fetchFields(grantKey, organizationId, { id: {}, name: {}, type: {}, targetType: {} })
      .catch(() => fetchFields(grantKey, organizationId, { id: {}, name: {}, type: {} }));
    for (const f of base) {
      if (f.targetType && f.targetType !== "job") continue;
      add({ id: f.id, name: f.name, type: f.type });
    }
  } catch (e) { /* route two may still carry it */ }

  try {
    const withOpts = await fetchFields(grantKey, organizationId, { id: {}, options: {} });
    for (const f of withOpts) add({ id: f.id, options: normaliseOptions(f.options) });
  } catch (e) { /* options are a nicety, not a requirement */ }

  // Route two: whatever is actually hanging off real jobs.
  try {
    for (const f of await fieldsSeenOnJobs(grantKey, organizationId)) add(f);
  } catch (e) { /* route one may have been enough */ }

  return [...merged.values()].filter(f => f.name);
}

/* Who the internal bill comes from. An A&M-to-A&M vendor account, so shop
   consumption lands on the job the same way a bill for extra gas would. Listed
   here so it gets picked off a list rather than somebody hunting an id. */
/* JobTread owns the supplier list, not this app.

   A&M has 263 vendors in JobTread and 274 in QuickBooks, and those two are
   already synced to each other. So this app must never hold its own copy: the
   moment somebody adds a supplier in one place, a copy here is wrong and
   nobody knows it. It reads, it caches for the basement, and that is all.

   The list runs past one page and JobTread caps a page at 100, so it has to be
   walked. Their paging syntax is not published, so three shapes are tried and
   whichever answers is used. If none of them page, we still return the first
   hundred rather than nothing. */
async function listVendors(grantKey, organizationId) {
  const shape = (extra) => ({
    $: { size: PAGE, ...extra },
    nextPage: {},
    nodes: { id: {}, name: {}, type: {} }
  });

  const pageOnce = async (extra) => {
    const res = await pave({ organization: { $: { id: organizationId }, id: {}, accounts: shape(extra) } }, grantKey);
    const a = res?.organization?.accounts;
    return { nodes: a?.nodes || [], next: a?.nextPage || null };
  };

  const all = [];
  let next = null, pages = 0, paged = true;

  try {
    let first = await pageOnce({});
    all.push(...first.nodes);
    next = first.next;
  } catch (e) {
    // nextPage is not a field they accept, so take a single flat page.
    paged = false;
    const res = await pave({
      organization: { $: { id: organizationId }, id: {}, accounts: { $: { size: PAGE }, nodes: { id: {}, name: {}, type: {} } } }
    }, grantKey);
    all.push(...(res?.organization?.accounts?.nodes || []));
  }

  while (paged && next && pages < 12) {
    pages++;
    try {
      const r = await pageOnce({ page: next });
      if (!r.nodes.length) break;
      all.push(...r.nodes);
      next = r.next;
    } catch (e) { break; }
  }

  const seen = new Set();
  return all
    .filter(a => (!a.type || a.type === "vendor"))
    .filter(a => { if (seen.has(a.id)) return false; seen.add(a.id); return true; })
    .map(a => ({ id: a.id, name: a.name }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

/* JobTread has no external id on a job, so the only way to know whether we have
   already stamped one is a custom field carrying our own job id. Without it
   there is no idempotency key at all and the same emergency job can be linked
   twice. This finds it, and creates it if it is not there. */
async function ensureInventoryField(grantKey, organizationId) {
  const fields = await discoverFields(grantKey, organizationId);
  // Loose match on purpose. Somebody typing the name by hand will put a stray
  // space in it or capitalise it differently, and being told to make a field
  // that is already sitting there is maddening.
  const tidy = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const found = fields.find(f => tidy(f.name) === 'inventoryjobid');
  if (found) return { id: found.id, created: false };

  /* JobTread wants the value-count bounds spelled out and will not default
     them: 'A non-null value is required at createCustomField.$.minValuesRequired'.
     One optional text value is what we want, so nought to one. */
  const shapes = [
    { organizationId, name: 'Inventory Job ID', type: 'text', targetType: 'job', minValuesRequired: 0, maxValuesAllowed: 1 },
    { organizationId, name: 'Inventory Job ID', type: 'text', targetType: 'job', minValuesRequired: 0, maxValuesRequired: 1 },
    { organizationId, name: 'Inventory Job ID', type: 'text', targetType: 'job', minValuesRequired: 0 }
  ];

  let lastErr = null;
  try {
    for (const $ of shapes) {
      try {
        const res = await pave({ createCustomField: { $, createdCustomField: { id: {} } } }, grantKey);
        const id = res?.createCustomField?.createdCustomField?.id;
        if (id) return { id, created: true };
      } catch (e) { lastErr = e; }
    }
    throw lastErr || new Error('no id returned');
  } catch (e) {
    // The write shape is not publicly documented, so if it is refused, say
    // exactly what to make by hand rather than failing silently.
    return {
      id: null, created: false,
      manual: 'In JobTread, go to Settings, Custom Fields, and add a Text field on Job named exactly "Inventory Job ID". Then press Check again.',
      detail: e.message
    };
  }
}

async function pullJobs(grantKey, organizationId, cfg, search = "") {
  /* Typed a job number or part of a name: look it up across every job, not
     only the newest twenty five. Before 2026-10 an older job could never be
     matched at all. */
  const term = String(search || "").trim().slice(0, 60);
  const q = {
    organization: {
      $: { id: organizationId },
      id: {},
      /* Twenty five, not a hundred. Every job drags its location and all of its
         custom field values along with it, and a hundred of those comes back as
         "Request Entity Too Large". The matching queue only ever looks at
         recent work, so a short page is the right answer anyway. */
      jobs: {
        $: { size: 25, sortBy: [{ field: "createdAt", order: "desc" }] },
        nodes: {
          id: {}, name: {}, number: {}, closedOn: {}, createdAt: {},
          location: { id: {}, address: {}, latitude: {}, longitude: {} },
          customFieldValues: { nodes: { value: {}, customField: { id: {} } } }
        }
      }
    }
  };
  const res = await pave(q, grantKey);
  const nodes = res?.organization?.jobs?.nodes || [];
  const statusField = cfg?.statusFieldId || "";
  const wonOption = (cfg?.wonOption || "").toLowerCase();

  return nodes.map(j => {
    const cfv = j.customFieldValues?.nodes || [];
    const statusVal = cfv.find(v => v.customField?.id === statusField)?.value || "";
    const invId = cfv.find(v => v.customField?.id === cfg?.inventoryIdFieldId)?.value || "";
    return {
      id: j.id,
      name: j.name,
      number: j.number,
      closed: !!j.closedOn,
      address: j.location?.address || "",
      lat: j.location?.latitude ?? null,
      lng: j.location?.longitude ?? null,
      status: statusVal,
      won: wonOption ? String(statusVal).toLowerCase() === wonOption : null,
      inventoryJobId: invId
    };
  });
}

/* The estimate, read back the other way. Everything else here pushes; this is
   the one thing the shop wants pulled, because what the estimator priced is the
   best guess anybody has at what a job is going to need, and it is currently
   retyped from a screen. Documents are not filtered by type in the query: what
   JobTread calls an estimate has moved before, and a list that returns nothing
   looks exactly like a job with no estimate on it. Filter on the way out. */
async function jobDocuments(grantKey, jobtreadJobId) {
  const res = await pave({
    job: {
      $: { id: jobtreadJobId },
      id: {},
      name: {},
      documents: {
        $: { size: 25, sortBy: [{ field: "createdAt", order: "desc" }] },
        nodes: {
          id: {}, type: {}, status: {}, name: {}, createdAt: {},
          lineItems: {
            $: { size: 100 },
            nodes: { id: {}, name: {}, description: {}, quantity: {}, unitCost: {}, unitPrice: {}, uom: {} }
          }
        }
      }
    }
  }, grantKey);

  const docs = (res?.job?.documents?.nodes || []).map(d => ({
    id: d.id,
    type: d.type || "",
    status: d.status || "",
    name: d.name || "",
    createdAt: d.createdAt || "",
    lines: (d.lineItems?.nodes || []).map(l => ({
      name: l.name || l.description || "",
      description: l.description || "",
      qty: Number(l.quantity) || 0,
      uom: l.uom || "",
      unitCost: l.unitCost == null ? null : Number(l.unitCost)
    })).filter(l => l.name)
  }));

  await log({ action: "documents", jobtreadJobId, documents: docs.length });
  return { job: { id: res?.job?.id, name: res?.job?.name }, documents: docs };
}

/* Cost push. Shop consumption, equipment charges, waste and disposal go across
   as one vendor bill from an internal A&M vendor account, landing in draft so a
   person approves it before it hits job costing. Hauling labour goes across as
   time entries, because labour cost is derived from the worker's rate and
   cannot be written any other way. */
async function pushCost(grantKey, organizationId, payload) {
  const { jobtreadJobId, internalVendorId, lines, timeEntries, inventoryPushId } = payload;
  if (!jobtreadJobId) throw new Error("No JobTread job was named for this push.");
  if (!internalVendorId) throw new Error("The internal A&M vendor account has not been set in settings.");

  // Query first. There is no upsert, and the API will happily write the same
  // push twice onto two documents.
  const existing = await pave({
    organization: {
      $: { id: organizationId },
      documents: {
        $: { size: 20, where: [["externalId"], "=", inventoryPushId] },
        nodes: { id: {}, externalId: {} }
      }
    }
  }, grantKey).catch(() => null);

  const already = existing?.organization?.documents?.nodes?.find(d => d.externalId === inventoryPushId);
  if (already) {
    await log({ action: "pushCost", jobtreadJobId, result: "skipped, already pushed", documentId: already.id });
    return { skipped: true, documentId: already.id };
  }

  const q = {
    createDocument: {
      $: {
        type: "vendorBill",
        jobId: jobtreadJobId,
        accountId: internalVendorId,
        includeInBudget: true,
        qboIsIgnored: true,          // never let an A&M-to-A&M bill reach QuickBooks
        status: "draft",             // a person approves before it hits costing
        externalId: inventoryPushId, // our idempotency key
        notify: false,
        lineItems: (lines || []).map(l => ({
          name: l.name,
          description: l.description || "",
          quantity: l.qty,
          unitCost: l.unitCost,
          jobCostItemId: l.jobCostItemId || undefined   // load-bearing: rolls into the right budget row
        }))
      },
      createdDocument: { id: {}, externalId: {} }
    }
  };

  const res = await pave(q, grantKey);
  const documentId = res?.createDocument?.createdDocument?.id || null;

  const timeIds = [];
  for (const t of (timeEntries || [])) {
    const tq = {
      createTimeEntry: {
        $: {
          type: t.type,                 // required, must match a configured type
          jobId: jobtreadJobId,
          userId: t.userId,
          costItemId: t.costItemId || undefined,
          startedAt: t.startedAt,
          endedAt: t.endedAt,
          notes: t.notes || "",
          notify: false
        },
        createdTimeEntry: { id: {} }
      }
    };
    const tr = await pave(tq, grantKey);
    const id = tr?.createTimeEntry?.createdTimeEntry?.id;
    if (id) timeIds.push(id);
  }

  await log({ action: "pushCost", jobtreadJobId, documentId, lines: (lines || []).length, timeEntries: timeIds.length });
  return { documentId, timeEntryIds: timeIds };
}

/* Emergency work starts in this app at 2am, long before anybody opens
   JobTread. Do NOT create the JobTread job then. A job's location cannot be
   changed after it is made, a location's customer cannot be changed either, and
   there is no merge. A placeholder created in the middle of the night can never
   be repointed at the real customer. Hold it here, unlinked, and stamp the link
   once the office creates the real job. */
async function linkJob(grantKey, organizationId, payload) {
  const { jobtreadJobId, inventoryJobId, inventoryIdFieldId } = payload;
  if (!inventoryIdFieldId) throw new Error("The Inventory Job ID custom field has not been set in settings.");

  const dupe = await pave({
    organization: {
      $: { id: organizationId },
      jobs: {
        $: { size: 100, with: { cf: { _: "customFieldValues", $: { customFieldId: inventoryIdFieldId } } } },
        nodes: { id: {}, customFieldValues: { nodes: { value: {}, customField: { id: {} } } } }
      }
    }
  }, grantKey).catch(() => null);
  /* If the check could not be made, nothing is written. A link stamped twice
     sends one job's costs to two jobs. */
  if (!dupe) throw new Error("Could not check JobTread for an existing link, so nothing was changed. Try again.");

  const clash = (dupe?.organization?.jobs?.nodes || []).find(j =>
    j.id !== jobtreadJobId &&
    (j.customFieldValues?.nodes || []).some(v => v.customField?.id === inventoryIdFieldId && v.value === inventoryJobId)
  );
  if (clash) {
    throw new Error(`Inventory job ${inventoryJobId} is already stamped on JobTread job ${clash.id}. Nothing was changed.`);
  }

  const res = await pave({
    updateJob: {
      $: {
        id: jobtreadJobId,
        notify: false,
        /* JobTread takes these as an object keyed by field id. */
        customFieldValues: { [inventoryIdFieldId]: inventoryJobId }
      },
      job: { id: {} }
    }
  }, grantKey);

  await log({ action: "linkJob", jobtreadJobId, inventoryJobId });
  return { ok: true, jobtreadJobId: res?.updateJob?.job?.id || jobtreadJobId };
}

/* ------------------------------------------------------------------- router */

export default async (req) => {
  const denied = await authGate(req);
  if (denied) return denied;
  const url = new URL(req.url);

  if (req.method === "GET") {
    const c = await creds();
    const logDoc = (await store().get(LOG_BLOB, { type: "json" })) || { entries: [] };
    return json({
      connected: !!(c && c.grantKey),
      organizationId: c?.organizationId || "",
      statusFieldId: c?.statusFieldId || "",
      wonOption: c?.wonOption || "",
      inventoryIdFieldId: c?.inventoryIdFieldId || "",
      internalVendorId: c?.internalVendorId || "",
      recent: logDoc.entries.slice(0, 25)
    });
  }

  if (req.method !== "POST") return json({ error: "Method not allowed." }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Body was not valid JSON." }, 400); }

  const action = body.action;

  /* Changing the connection, writing to JobTread, or creating anything there is
     the office's job. Reading is anybody signed in. */
  if (["saveKey", "ensureField", "linkJob", "pushCost"].includes(action)) {
    const notOffice = requireOffice(req);
    if (notOffice) return notOffice;
  }

  try {
    if (action === "saveKey") {
      const c = (await creds()) || {};
      const next = {
        ...c,
        grantKey: body.grantKey || c.grantKey || "",
        organizationId: body.organizationId ?? c.organizationId ?? "",
        statusFieldId: body.statusFieldId ?? c.statusFieldId ?? "",
        wonOption: body.wonOption ?? c.wonOption ?? "",
        inventoryIdFieldId: body.inventoryIdFieldId ?? c.inventoryIdFieldId ?? "",
        internalVendorId: body.internalVendorId ?? c.internalVendorId ?? "",
        savedAt: new Date().toISOString()
      };
      await store().setJSON(KEY_BLOB, next);
      return json({ ok: true, connected: !!next.grantKey });
    }

    const c = await creds();
    if (!c || !c.grantKey) {
      return json({ error: "Not connected to JobTread yet. Add a grant key in Settings." }, 400);
    }

    /* One button that answers "is this thing actually connected". It also
       fills the organisation id in by itself, because nobody should have to go
       and find it. */
    if (action === "probe") {
      const v = await fetch(PAVE, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ query: { version: {} } })
      }).then(r => r.json()).catch(() => null);

      let org = null, orgName = null, err = null;
      try {
        const me = await pave({ currentGrant: { id: {}, organization: { id: {}, name: {} } } }, c.grantKey);
        org = me?.currentGrant?.organization?.id || null;
        orgName = me?.currentGrant?.organization?.name || null;
        if (org && org !== c.organizationId) {
          await store().setJSON(KEY_BLOB, { ...c, organizationId: org });
        }
      } catch (e) { err = e.message; }

      return json({
        reachable: !!v?.version,
        version: v?.version || null,
        organizationId: org,
        organizationName: orgName,
        error: err
      });
    }

    if (action === "vendors") {
      const vendors = await listVendors(c.grantKey, body.organizationId || c.organizationId);
      return json({ vendors });
    }

    if (action === "ensureField") {
      const r = await ensureInventoryField(c.grantKey, body.organizationId || c.organizationId);
      if (r.id) {
        await store().setJSON(KEY_BLOB, { ...c, inventoryIdFieldId: r.id });
      }
      return json(r);
    }

    if (action === "fields") {
      const fields = await discoverFields(c.grantKey, body.organizationId || c.organizationId);
      return json({ fields });
    }

    if (action === "jobs") {
      const jobs = await pullJobs(c.grantKey, body.organizationId || c.organizationId, c, body.search || "");
      return json({ jobs });
    }

    if (action === "documents") {
      if (!body.jobtreadJobId) return json({ error: "No JobTread job was named." }, 400);
      return json(await jobDocuments(c.grantKey, body.jobtreadJobId));
    }

    if (action === "pushCost") {
      /* Off until it has been rebuilt to work out the lines on the server from
         the movement log and tried on a practice job. As written it would bill
         whatever lines and prices a phone sent it. */
      if (process.env.JT_PUSH_ENABLED !== "1") {
        return json({ error: "Sending cost to JobTread is switched off until it has been tested on a practice job." }, 409);
      }
      const out = await pushCost(c.grantKey, c.organizationId, body);
      return json(out);
    }

    if (action === "linkJob") {
      const out = await linkJob(c.grantKey, c.organizationId, {
        ...body, inventoryIdFieldId: body.inventoryIdFieldId || c.inventoryIdFieldId
      });
      return json(out);
    }

    return json({ error: `Unknown action: ${action}` }, 400);
  } catch (e) {
    await log({ action, error: e.message });
    return json({ error: e.message }, 502);
  }
};

export const config = { path: "/api/jobtread" };
