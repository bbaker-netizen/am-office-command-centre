/* A&M Inventory - the screens a crew member sees on a phone.

   Everything here is built around one measurement: how long it takes from
   picking up the phone to the gear being on the job in the record. If that is
   slower than shouting across the yard, the app loses and the shop goes back to
   not knowing where anything is. So: no forms, no search-then-select-then-
   confirm, no second person having to accept anything. Pick the job once, then
   the camera stays open and every scan lands. */

'use strict';

(function () {
  const { esc, qty, fmtWhen } = AM;
  const S = AM.state;
  const $ = AM.$, $$ = AM.$$;

  /* ------------------------------------------------------------- resolution */

  function findItem(code) {
    const c = String(code || '').trim().toUpperCase();
    if (!c) return null;
    const u = S.catalog.units.find(x => x.id.toUpperCase() === c);
    if (u) return { kind: 'unit', item: u };
    const s = S.catalog.stock.find(x => String(x.id).toUpperCase() === c);
    if (s) return { kind: 'stock', item: s };
    const k = (S.catalog.kits || []).find(x => x.id.toUpperCase() === c);
    if (k) return { kind: 'kit', item: k };
    // A serial written on the machine works too, because that is what is
    // printed under the code and it is what people read out over the radio.
    const bySerial = S.catalog.units.find(x => x.serial && x.serial.toUpperCase() === c);
    if (bySerial) return { kind: 'unit', item: bySerial };
    return null;
  }
  AM.findItem = findItem;

  const nameOf = r => r.kind === 'unit'
    ? `${r.item.name} ${r.item.unitNo || ''}`.trim()
    : r.item.name;

  function jobById(id) { return (S.catalog.jobs || []).find(j => j.id === id) || null; }
  function jobLabel(id) {
    const j = jobById(id);
    if (!j) return id || 'no job';
    return (j.number ? j.number + ' ' : '') + j.name;
  }
  AM.jobLabel = jobLabel;

  function openJobs() {
    return (S.catalog.jobs || []).filter(j => !j.closed)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  /* --------------------------------------------------------------- sessions */

  let session = null;   // { mode, jobId, toJobId, lines: [] }

  /* How many jobs the home screen shows before it folds the rest away. A&M run
     up to ninety at once and everything below the list is what the crew came
     for. */
  const HOME_JOBS = 6;
  let homeJobsOpen = false;

  function startSession(mode, jobId) {
    session = { mode, jobId, lines: [] };
  }

  function sessionRow(r, n, scanned) {
    return `<div class="line ${scanned ? '' : 'unscanned'}">
      <div class="line-main">
        <strong>${esc(nameOf(r))}</strong>
        <span class="line-id">${esc(r.item.id)}</span>
      </div>
      <div class="line-qty">${esc(qty(n))}${r.kind === 'stock' ? ' ' + esc(r.item.uom || '') : ''}</div>
      ${scanned ? '' : '<div class="line-flag">typed in</div>'}
    </div>`;
  }

  /* Adds a line, or bumps the one already there. Scanning the same code twice
     means two of them, which is what happens when somebody is loading a van. */
  function addLine(r, n, scanned) {
    const existing = session.lines.find(l => l.id === r.item.id);
    if (existing) { existing.qty += n; if (!scanned) existing.scanned = false; }
    else session.lines.push({ id: r.item.id, kind: r.kind, qty: n, scanned: !!scanned });
    AM.beep(true); AM.buzz();
    AM.scanFeed(sessionRow(r, n, scanned));
  }

  /* Bulk stock needs a number. Serialised machines never do: one code, one
     machine, and asking for a quantity would only slow the scan down. */
  function askQty(r, then) {
    const inc = r.item.increments && r.item.increments.length ? r.item.increments : null;
    AM.modal(`
      <h3>${esc(nameOf(r))}</h3>
      <p class="muted">${esc(r.item.uom || 'each')}${r.item.shelf ? ' · ' + esc(r.item.shelf) : ''}</p>
      <div class="pad">
        ${[1, 2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 50].map(n => `<button class="pad-n" data-q="${n}">${n}</button>`).join('')}
      </div>
      <div class="pad-row">
        <input id="qFree" type="number" inputmode="decimal" step="0.25" placeholder="Other">
        <button class="btn" id="qGo">Add</button>
      </div>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
    `, el => {
      $$('.pad-n', el).forEach(b => b.onclick = () => { AM.closeModal(); then(parseFloat(b.dataset.q)); });
      $('#qGo', el).onclick = () => {
        const v = parseFloat($('#qFree', el).value);
        if (!isFinite(v) || v <= 0) return;
        AM.closeModal(); then(v);
      };
      setTimeout(() => { const i = $('#qFree', el); i && i.focus(); }, 60);
    });
  }

  function handleCode(code, scanned) {
    const r = findItem(code);
    if (!r) { AM.beep(false); AM.toast(`Nothing here is tagged ${esc(code)}`, 'bad'); return; }
    /* Broken gear does not leave the shop. The block is here rather than in a
       warning because a machine that will not start is a wasted trip and a day
       of a crew's time, and nobody reads a red banner at six in the morning. */
    if (r.kind === 'unit') {
      const at = AM.derive().unitAt.get(r.item.id);
      if (at && at.where === 'repair') {
        AM.beep(false);
        AM.toast(`${nameOf(r)} is out of service: ${at.note || 'no note'}`, 'bad');
        return;
      }
      if (at && at.where === 'writeoff') {
        AM.beep(false);
        AM.toast(`${nameOf(r)} was written off. Tell the office it has turned up.`, 'bad');
        return;
      }
      /* Scanning a machine that is on the lost list is proof it turned up, so it
         comes off the list right here rather than someone having to remember. */
      if (at && at.where === 'missing') {
        AM.record({ type: 'FOUND', itemId: r.item.id, note: 'turned up, scanned back into use' });
        AM.toast(`${nameOf(r)} was on the lost list. Off it now.`, 'ok');
      }
    }
    if (r.kind === 'stock') askQty(r, n => addLine(r, n, scanned));
    else addLine(r, 1, scanned);
  }

  /* The pick list. It exists because one man on the phone while another pulls
     off the shelf is genuinely faster, and taking it away would just move the
     work back to paper. It is one tap behind the camera, and everything added
     through it is marked so the shop can see how much of the day never got
     scanned. That is the whole guard rail. */
  function pickList(onPick) {
    const rows = [
      ...S.catalog.stock.map(s => ({ kind: 'stock', item: s })),
      ...S.catalog.units.map(u => ({ kind: 'unit', item: u }))
    ];
    AM.modal(`
      <h3>Pick it off the list</h3>
      <p class="muted small">Anything added this way is marked, so the shop can see what never got scanned.</p>
      <input id="plq" class="search" placeholder="Type a few letters" autocomplete="off">
      <div class="pl-list" id="plList"></div>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
    `, el => {
      const list = $('#plList', el);
      const draw = q => {
        const t = q.trim().toLowerCase();
        const hits = (t
          ? rows.filter(r => (r.item.name + ' ' + r.item.id + ' ' + (r.item.group || '') + ' ' + (r.item.model || '')).toLowerCase().includes(t))
          : rows.slice(0, 40)).slice(0, 60);
        list.innerHTML = hits.map(r => `<button class="pl-row" data-id="${esc(r.item.id)}">
            <span>${esc(nameOf(r))}</span><span class="line-id">${esc(r.item.id)}</span>
          </button>`).join('') || '<div class="muted pad-y">Nothing matches that.</div>';
        $$('.pl-row', list).forEach(b => b.onclick = () => { AM.closeModal(); onPick(b.dataset.id); });
      };
      draw('');
      $('#plq', el).oninput = e => draw(e.target.value);
      setTimeout(() => $('#plq', el).focus(), 60);
    });
  }
  AM.pickList = pickList;

  /* ------------------------------------------------------------- repairs ----
     A broken machine does not go back on the shelf and it does not stay on the
     job. It goes out of service, and the note is the whole point of the screen:
     "will not start" tells the next man what he is picking up and tells the shop
     what it is buying parts for. Nothing comes back into service on its own. */

  const FAULTS = ['Will not start', 'No suction', 'Hose or cord damaged', 'Leaking water',
    'Filter shot', 'Making a noise', 'Wheels or handle', 'Water damage'];

  function unitName(id) {
    const u = S.catalog.units.find(x => x.id === id);
    return u ? `${u.name} ${u.unitNo || ''}`.trim() : id;
  }

  function repairModal(unitId, jobId, after) {
    AM.modal(`
      <h3>${esc(unitName(unitId))}</h3>
      <p class="muted small">It comes off the shop list until somebody says it is fixed. Say what is wrong so the next man is not guessing.</p>
      <div class="fault-chips">${FAULTS.map(f => `<button class="chip" data-f="${esc(f)}">${esc(f)}</button>`).join('')}</div>
      <label class="fld">What is wrong<input id="rpNote" placeholder="in your own words" autocomplete="off"></label>
      <div class="row"><button class="btn big" id="rpGo">Out of service</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
    `, el => {
      const inp = $('#rpNote', el);
      $$('.chip', el).forEach(c => c.onclick = () => {
        inp.value = inp.value.trim() ? inp.value.trim() + ', ' + c.dataset.f.toLowerCase() : c.dataset.f;
      });
      $('#rpGo', el).onclick = async () => {
        const note = inp.value.trim();
        if (!note) { AM.toast('Put a line in about what is wrong.', 'warn'); inp.focus(); return; }
        await AM.record({ type: 'REPAIR', itemId: unitId, jobId: jobId || null, qty: 1, note });
        AM.closeModal();
        AM.beep(true); AM.buzz();
        AM.toast('Out of service. It will not load onto a job until it is signed back in.', 'warn');
        if (after) after();
      };
      setTimeout(() => inp.focus(), 60);
    });
  }
  AM.repairModal = repairModal;

  /* Cannot find it. The job settles here, because a job held open never made a
     machine turn up. It goes on the lost list with the last man who had it and
     where it was last seen, and somebody chases it. */
  function lostModal(unitId, jobId, after) {
    AM.modal(`
      <h3>${esc(unitName(unitId))}</h3>
      <p class="muted small">It goes on the lost list and somebody chases it. Where was it last seen, and who had it? That line is what makes it findable a week from now.</p>
      <label class="fld">Last seen<input id="lsNote" placeholder="on the third floor by the decon, Tuesday" autocomplete="off"></label>
      <div class="row"><button class="btn big" id="lsGo">Put it on the lost list</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
    `, el => {
      const inp = $('#lsNote', el);
      $('#lsGo', el).onclick = async () => {
        await AM.record({ type: 'MISSING', itemId: unitId, jobId: jobId || null, qty: 1, note: inp.value.trim() });
        AM.closeModal();
        AM.toast('On the lost list. The job is no longer held open by it.', 'warn');
        if (after) after();
      };
      setTimeout(() => inp.focus(), 60);
    });
  }
  AM.lostModal = lostModal;

  function foundModal(unitId, after) {
    const r = AM.derive().lost.get(unitId);
    AM.modal(`
      <h3>${esc(unitName(unitId))}</h3>
      ${r ? `<p class="muted small">Lost ${esc(fmtWhen(r.since))}${r.by ? ' · ' + esc(r.by) : ''}${r.note ? '<br><strong>' + esc(r.note) + '</strong>' : ''}</p>` : ''}
      ${r && r.chase.length ? `<p class="muted small">${r.chase.map(c => esc(c.by || '') + ': ' + esc(c.note)).join('<br>')}</p>` : ''}
      <label class="fld">Note<input id="lnNote" placeholder="found it in the trailer, or rang the GC" autocomplete="off"></label>
      <div class="row"><button class="btn big" id="lnFound">Found it, it is in the shop</button>
      <button class="btn-ghost" id="lnNoteGo">Add a chase note</button></div>
    `, el => {
      const inp = $('#lnNote', el);
      $('#lnFound', el).onclick = async () => {
        await AM.record({ type: 'FOUND', itemId: unitId, note: inp.value.trim() });
        AM.closeModal();
        AM.beep(true); AM.buzz();
        AM.toast('Back in the shop, and off the lost list.');
        if (after) after();
      };
      $('#lnNoteGo', el).onclick = async () => {
        const n = inp.value.trim();
        if (!n) { inp.focus(); return; }
        await AM.record({ type: 'LOST_NOTE', itemId: unitId, note: n });
        AM.closeModal();
        AM.toast('Noted. It stays on the lost list.');
        if (after) after();
      };
      setTimeout(() => inp.focus(), 60);
    });
  }
  AM.foundModal = foundModal;

  function fixedModal(unitId, after) {
    const log = (AM.derive().repairLog.get(unitId) || []).slice().reverse();
    const last = log.find(x => x.kind === 'out');
    AM.modal(`
      <h3>${esc(unitName(unitId))}</h3>
      ${last ? `<p class="muted small">Went out of service ${esc(fmtWhen(last.at))}${last.by ? ' · ' + esc(last.by) : ''}<br><strong>${esc(last.note || '')}</strong></p>` : ''}
      <label class="fld">What was done<input id="fxNote" placeholder="new hose, new float switch, sent out and back" autocomplete="off"></label>
      <div class="row"><button class="btn big" id="fxGo2">Back in service</button>
      <button class="btn-ghost" id="fxNote2">Just add a note</button></div>
    `, el => {
      const inp = $('#fxNote', el);
      $('#fxGo2', el).onclick = async () => {
        await AM.record({ type: 'FIXED', itemId: unitId, note: inp.value.trim() });
        AM.closeModal();
        AM.beep(true); AM.buzz();
        AM.toast('Back in the shop and ready to go out.');
        if (after) after();
      };
      $('#fxNote2', el).onclick = async () => {
        const n = inp.value.trim();
        if (!n) { inp.focus(); return; }
        await AM.record({ type: 'REPAIR_NOTE', itemId: unitId, note: n });
        AM.closeModal();
        AM.toast('Noted. It stays out of service.');
        if (after) after();
      };
      setTimeout(() => inp.focus(), 60);
    });
  }
  AM.fixedModal = fixedModal;

  /* -------------------------------------------------------------- home ---- */

  AM.screens['#/'] = function () {
    const d = AM.derive();
    const jobs = openJobs();
    const outCount = [...d.outstanding.values()].reduce((a, rows) => a + rows.length, 0);
    const onJobs = [...d.unitAt.values()].filter(x => x.where === 'job').length;
    const broken = [...d.unitAt.values()].filter(x => x.where === 'repair').length;
    const lostCount = d.lost.size;

    /* There was a "finish setting this up" card here, with JobTread,
       QuickBooks and People on it. It has been taken off, and it is worth
       saying why so nobody puts it back.

       This is the shop screen. A man standing at a van at six in the morning
       cannot connect QuickBooks and is not being asked to. Worse, this is the
       one screen in the app with no Settings button on it, on purpose, because
       the office lives behind a single switch. So the card told somebody to go
       and set something up from the only place they could not get to it, and
       its links jumped them into the office side with no way back except the
       tab bar. That card now sits on the office Today screen, where Settings
       is one button along. */

    return `
    <div class="wrap">
      <div class="tiles">
        <a class="tile go" href="#/out" data-tour="mobilize"><span class="tile-k">Mobilize</span><span class="tile-s">gear leaving the shop</span></a>
        <a class="tile back" href="#/back" data-tour="teardown"><span class="tile-k">Tear down</span><span class="tile-s">bringing it back</span></a>
        <a class="tile move" href="#/move" data-tour="transfer"><span class="tile-k">Transfer</span><span class="tile-s">site to site</span></a>
        <a class="tile find" href="#/find" data-tour="find"><span class="tile-k">Find</span><span class="tile-s">where is it</span></a>
        <a class="tile in wide" href="#/in" data-tour="arrived"><span class="tile-k">Stock arrived</span><span class="tile-s">put a delivery on the shelves</span></a>
      </div>

      <div class="panel">
        <h2>Out right now</h2>
        <div class="stat-row">
          <a class="stat tap" href="#/find?f=__job"><b>${onJobs}</b><span>machines on jobs</span></a>
          <div class="stat"><b>${outCount}</b><span>lines not back yet</span></div>
          <div class="stat"><b>${jobs.length}</b><span>jobs open</span></div>
          ${broken ? `<a class="stat warn tap" href="#/find?f=__repair"><b>${broken}</b><span>out of service</span></a>` : ''}
          ${lostCount ? `<a class="stat bad tap" href="#/find?f=__missing"><b>${lostCount}</b><span>lost</span></a>` : ''}
        </div>
        ${(() => {
          /* Ninety jobs open is a normal week here, and a list ninety long
             buries everything under it. The ones with gear standing on them
             come first, because those are the ones anybody is looking for, and
             the rest folds away until somebody asks for it. */
          if (!jobs.length) return `<p class="muted">No jobs open yet. Start one when you mobilize.</p>`;
          /* The street under the job name, not the phase. Every row on this
             list was showing the phase, and most jobs are in the same phase,
             so four different jobs read identically at six in the morning.
             The phase is only used when a job has no address on it. */
          const withRows = jobs.map(j => ({ j, rows: (d.outstanding.get(j.id) || []).length }))
            .sort((a, b) => b.rows - a.rows);
          const shown = homeJobsOpen ? withRows : withRows.slice(0, HOME_JOBS);
          const hidden = withRows.length - shown.length;
          return `<div class="job-list">${shown.map(({ j, rows }) => {
            const ph = window.SOP.phase(j.division, j.phase);
            return `<a class="job-row" href="#/back?job=${encodeURIComponent(j.id)}">
              <div><strong>${esc(jobLabel(j.id))}</strong>
                <div class="muted small">${esc(j.address || (ph ? ph.name : ''))}</div></div>
              <div class="job-count ${rows ? 'has' : ''}">${rows ? rows + ' out' : 'clear'}</div>
            </a>`;
          }).join('')}</div>
          ${hidden > 0 || homeJobsOpen
            ? `<button class="btn-ghost wide" id="jobsMore">${homeJobsOpen
                ? 'Fold the job list away'
                : `Show the other ${hidden} job${hidden === 1 ? '' : 's'}`}</button>`
            : ''}`;
        })()}
      </div>

      <div class="panel">
        <div class="panel-head">
          <div><h2>Need something for tomorrow?</h2>
          <p class="muted small">In by two o'clock and the shop has it ready. That is the manual's own deadline, not a new rule.</p></div>
          <button class="btn" id="reqBtn">Ask the shop</button>
        </div>
        ${(() => {
          /* An ask that vanishes the moment it is sent gets asked again, by
             phone, which is the habit this was meant to replace. It stays on
             the screen until the shop pulls it. */
          const open = d.requests.filter(r => !r.filled);
          /* A request that was pulled yesterday is not news. It stays up for
             the rest of the day it was filled, so the man who asked sees it
             happened, and then it goes. */
          const today = AM.dayISO();
          const done = d.requests.filter(r => r.filled && String(r.filled.at || r.at || '').slice(0, 10) === today).slice(-3);
          if (!open.length && !done.length) return '';
          return `<div class="req-list">
            ${open.map(r => `<div class="req-row">
              <div><strong>${esc(qty(r.qty || 1))} &times; ${esc(r.text)}</strong>
                <div class="muted small">${esc(jobLabel(r.jobId))} · asked ${esc(AM.fmtWhen ? AM.fmtWhen(r.at) : '')}</div></div>
              <div class="req-state waiting">${r.afterTwo ? 'after two' : 'with the shop'}</div>
            </div>`).join('')}
            ${done.map(r => `<div class="req-row">
              <div><strong>${esc(qty(r.qty || 1))} &times; ${esc(r.text)}</strong>
                <div class="muted small">${esc(jobLabel(r.jobId))}</div></div>
              <div class="req-state done">pulled, it is on the job</div>
            </div>`).join('')}
          </div>`;
        })()}
      </div>

      ${S.outbox.length ? `<div class="panel note">
        <h2>${S.outbox.length} still waiting to reach the office</h2>
        <p>They are safe on this phone. They go across the next time you have a bar of signal with the app open.</p>
      </div>` : ''}
    </div>`;
  };

  AM.after['#/'] = function () {
    const b = $('#reqBtn');
    if (b) b.onclick = () => requestModal();
    const more = $('#jobsMore');
    if (more) more.onclick = () => { homeJobsOpen = !homeJobsOpen; AM.render(); };
  };

  /* The 2pm requisition, off the SOP. One job, one item, one number, done in
     four taps standing in a hallway. Anything more and it goes back to being a
     text message somebody forgets to read. */
  /* Type what you want in plain words. If it happens to match something on the
     shelf the app quietly attaches it, which is what lets the request count
     against stock and pull the reorder forward. If it does not match, the
     request still goes, as words, and somebody in the shop reads it. Never make
     a man on a site pick from a list to ask for a roll of poly. */
  function requestModal() {
    const jobs = openJobs();
    AM.modal(`
      <h3>For tomorrow</h3>
      <label class="fld">What do you need<input id="rqWhat" placeholder="poly, gloves, filters" autocomplete="off"></label>
      <div class="pl-list" id="rqList"></div>
      <div class="two-up">
        <label class="fld">How many<input id="rqQty" type="number" inputmode="decimal" step="1" value="1"></label>
        <label class="fld">Which job
          <select id="rqJob">${jobs.map(j => `<option value="${esc(j.id)}">${esc(jobLabel(j.id))}</option>`).join('')}</select></label>
      </div>
      <div class="row"><button class="btn big" id="rqGo">Send it</button></div>
    `, el => {
      let picked = null;
      const list = $('#rqList', el);
      $('#rqWhat', el).oninput = e => {
        const t = e.target.value.trim().toLowerCase();
        picked = null;
        if (t.length < 2) { list.innerHTML = ''; return; }
        const hits = S.catalog.stock
          .filter(s => (s.name + ' ' + s.group).toLowerCase().includes(t))
          .slice(0, 5);
        list.innerHTML = hits.map(s => `<button class="pl-row" data-id="${esc(s.id)}">
          <span>${esc(s.name)}</span><span class="line-id">${esc(s.uom || '')}</span></button>`).join('');
        $$('.pl-row', list).forEach(b => b.onclick = () => {
          picked = b.dataset.id;
          $('#rqWhat', el).value = (S.catalog.stock.find(s => s.id === picked) || {}).name || '';
          list.innerHTML = '';
        });
      };
      $('#rqGo', el).onclick = async () => {
        const what = $('#rqWhat', el).value.trim();
        if (!what) return;
        const late = new Date().getHours() >= 14;
        await AM.record({
          type: 'REQUEST',
          jobId: $('#rqJob', el).value,
          itemId: picked || null,          // attached when it matches the shelf
          text: what,
          qty: parseFloat($('#rqQty', el).value) || 1,
          afterTwo: late
        });
        AM.closeModal();
        AM.toast(late ? 'Sent. It is after two though, so ring the shop as well.' : 'Sent. The shop has it for the morning.', late ? 'warn' : 'ok');
      };
      setTimeout(() => $('#rqWhat', el).focus(), 60);
    });
  }

  /* ---------------------------------------------------------- check out ---- */

  /* The manual's pre-mobilization list is the step everybody skips, because it
     is a desk job and the van is running. So it sits in front of mobilize
     rather than beside it: the office walks it the day before, and a crew that
     finds it unfinished at six in the morning can still go, but says why and
     the override lands on the office screen with a name on it. */
  function preMobState(jobId) {
    const j = jobById(jobId) || {};
    const type3 = j.division !== 'restoration' && String(j.containment) === '3';
    const items = window.SOP.preMob.filter(i => i.appliesTo === 'all' || (i.appliesTo === 'type3' && type3));
    const missing = items.filter(i => !(j.preMob && j.preMob[i.id]));
    const overridden = S.events.some(e => e.type === 'PREMOB_OVERRIDE' && e.jobId === jobId);
    return { j, items, missing, ready: !missing.length, overridden };
  }

  AM.screens['#/out'] = function () {
    if (!session || session.mode !== 'out') {
      return jobPicker('Mobilize', 'Which job is this going to?', () => {});
    }
    const pm = preMobState(session.jobId);
    if (!pm.ready && !pm.overridden) {
      return `
      <div class="wrap">
        <div class="panel note bad">
          <h2>${esc(jobLabel(session.jobId))} is not ready to mobilize</h2>
          <p>${pm.missing.length} thing${pm.missing.length === 1 ? '' : 's'} on the pre-mobilization list ${pm.missing.length === 1 ? 'has' : 'have'} not been confirmed. It is a desk job, done the day before, and this is the point where it either happened or it did not.</p>
        </div>
        <div class="panel">
          <h2>Not confirmed</h2>
          <div class="chk-list">
            ${pm.missing.map(i => `<div class="chk"><span><strong>${esc(i.text)}</strong>${i.note ? `<em class="muted small">${esc(i.note)}</em>` : ''}</span></div>`).join('')}
          </div>
          ${pm.j.mobDate ? `<p class="muted small">This job is down to go out ${esc(pm.j.mobDate)}.</p>` : '<p class="muted small">This job has no mobilization date on it, so it never showed up on anybody\'s list the day before.</p>'}
        </div>
        <div class="panel">
          <h2>Going anyway</h2>
          <p class="muted">Ring the office and get it walked if you can. If the work cannot wait, say why and load the van.</p>
          <div class="row"><button class="btn-ghost" id="pmBack">Pick a different job</button>
          <button class="btn" id="pmGo">Go anyway</button></div>
        </div>
      </div>`;
    }
    return sessionScreen('Mobilizing to', 'Everything here goes on the job the moment you send it.');
  };

  function openOutScanner() {
    AM.openScanner(code => handleCode(code, true), {
      title: 'Check out to ' + jobLabel(session.jobId),
      hint: 'Scan the machine, or the card on the shelf edge',
      altLabel: 'Cannot scan it',
      onAlt: () => pickList(id => { handleCode(id, false); openOutScanner(); }),
      onClose: () => AM.render()
    });
  }

  /* ------------------------------------------------------------- return ---- */

  AM.screens['#/back'] = function () {
    const d = AM.derive();
    const m = /job=([^&]+)/.exec(location.hash);
    const jobId = m ? decodeURIComponent(m[1]) : (session && session.mode === 'back' ? session.jobId : null);

    if (!jobId) {
      return jobPicker('Tear down', 'Which job are you tearing down?', id => { location.hash = '#/back?job=' + encodeURIComponent(id); });
    }

    const rows = d.outstanding.get(jobId) || [];
    const load = d.jobLoad.get(jobId);
    const settled = [];
    if (load) for (const l of load.values()) {
      if ((l.back || 0) > 0.001 || (l.consumed || 0) > 0.001) settled.push(l);
    }
    const w = d.waste.get(jobId) || { bags: 0, trailers: 0 };
    const bagsPerBin = (S.catalog.settings && S.catalog.settings.bagsPerBin) || 600;
    const job = jobById(jobId) || {};
    const type23 = job.division !== 'restoration' && String(job.containment) !== '1';

    return `
    <div class="wrap">
      <div class="panel">
        <div class="panel-head">
          <div><h2>${esc(jobLabel(jobId))}</h2>
          <p class="muted">${rows.length ? rows.length + ' things still on this job' : 'Nothing outstanding. This one is clear.'}</p></div>
          <button class="btn" id="scanBack">Scan it back</button>
        </div>

        ${rows.length ? `<div class="ret-list" data-tour="outlist">${rows.map(r => renderReturnRow(r, jobId)).join('')}</div>`
          : `<p class="clear-note">Every machine and every roll that went out on this job has been accounted for.</p>`}
      </div>

      ${settled.length ? `<div class="panel">
        <h2>Checked in</h2>
        <p class="muted small">Everything already off the truck. It saves as you go, so a second load carries on from here.</p>
        <div class="ret-list settled">${settled.map(l => renderSettledRow(l, jobId)).join('')}</div>
      </div>` : ''}

      <div class="panel">
        <h2>Coming off site</h2>
        <p class="muted small">Work down it. The last one is the one that finds the missing gear.</p>
        ${AM.why('The manual takes a job from the client walkthrough straight to counting equipment, so nothing in it ever tells anyone to strike the containment. This is that step.')}
        <div class="chk-list">
          ${window.SOP.strike.filter(s => !s.gate || type23).map(s => `<label class="chk">
            <input type="checkbox" class="st-chk" data-id="${esc(s.id)}" data-job="${esc(jobId)}" ${job.strike && job.strike[s.id] ? 'checked' : ''}>
            <span><strong>${esc(s.text)}</strong>${s.note ? `<em class="muted small">${esc(s.note)}</em>` : ''}</span></label>`).join('')}
        </div>
      </div>

      <div class="panel">
        <h2>Waste off this job</h2>
        <p class="muted small">One load at a time. Asbestos and clean demolition are logged apart, because they go to different places at different money.</p>
        <div class="waste-kind">
          <button class="chip on" id="wAsb" data-s="asbestos">Asbestos</button>
          <button class="chip" id="wCln" data-s="clean">Clean demo</button>
        </div>
        <div class="waste-row">
          <label>Bags back<input type="number" id="wBags" inputmode="numeric" min="0" step="1" placeholder="0"></label>
          <label>Trailer loads<input type="number" id="wTrl" inputmode="decimal" min="0" step="0.25" placeholder="0"></label>
          <button class="btn" id="wSave">Log it</button>
        </div>
        <div class="muted small">
          Asbestos so far: ${w.asbestos ? w.asbestos.bags : w.bags} bags${(w.asbestos ? w.asbestos.bags : w.bags) ? ` · about ${Math.round((w.asbestos ? w.asbestos.bags : w.bags) / bagsPerBin * 100)}% of a bin` : ''}${(w.asbestos ? w.asbestos.trailers : w.trailers) ? ` · ${qty(w.asbestos ? w.asbestos.trailers : w.trailers)} trailer loads` : ''}<br>
          Clean demo so far: ${w.clean ? w.clean.bags : 0} bags${w.clean && w.clean.trailers ? ` · ${qty(w.clean.trailers)} trailer loads` : ''}
        </div>
      </div>

      <div class="panel ${rows.length ? '' : 'ready'}">
        <h2>Finish the demob</h2>
        ${rows.length
          ? `<p class="muted">${rows.length} ${rows.length === 1 ? 'thing is' : 'things are'} still showing out on this job, which is why it is still open. Check them in, mark them used, or flag a machine that cannot be found.</p>
             <button class="btn big" disabled>Finalize demob</button>`
          : `<p class="muted">Nothing is out. Closing it here takes the job off the crew list and stops it sitting open in the office.</p>
             <button class="btn big" id="finGo">Finalize demob</button>`}
      </div>
    </div>`;
  };

  /* Rolls and pails come back as part of a thing. Everything else comes back
     as a whole thing or does not come back. You cannot have two and a half
     cases of coveralls unless somebody is checking in garbage for the half,
     which is why the step depends on how the item is bought. */
  function partialOK(item) {
    return item.uom === 'RL' || item.uom === 'PL' || item.cls === 'roll';
  }

  function renderReturnRow(r, jobId) {
    const d = AM.derive();
    const isUnit = d.unitById.has(r.id);
    const item = isUnit ? d.unitById.get(r.id) : d.stockById.get(r.id);
    if (!item) return '';
    const rr = { kind: isUnit ? 'unit' : 'stock', item };

    const head = `
      <div class="ret-main">
        <strong>${esc(nameOf(rr))}</strong>
        <span class="line-id">${esc(r.id)}</span>
        <div class="muted small">${qty(r.still)} still out${item.uom ? ' (' + esc(item.uom) + ')' : ''}${r.back ? ' · ' + qty(r.back) + ' already checked in' : ''}${r.unscanned ? ' · ' + qty(r.unscanned) + ' was typed in, not scanned' : ''}</div>
      </div>`;

    /* A machine is one thing. It is back or it cannot be found, and there is
       nothing in between worth asking a man at a van door. */
    if (isUnit) {
      return `<div class="ret-row" data-id="${esc(r.id)}">
        ${head}
        <div class="ret-actions">
          <button class="inc" data-id="${esc(r.id)}" data-f="1" data-job="${esc(jobId)}">Back</button>
          <button class="inc broke" data-id="${esc(r.id)}" data-f="repair" data-job="${esc(jobId)}">Broken</button>
          <button class="inc missing" data-id="${esc(r.id)}" data-f="missing" data-job="${esc(jobId)}">Cannot find it</button>
        </div>
      </div>`;
    }

    /* Consumables get a count, not a percentage. What does not come back was
       used on the job, so "used it all" closes the line and the job wears it.
       Nobody has to find a box that was never lost. */
    const step = partialOK(item) ? 0.25 : 1;
    return `<div class="ret-row" data-id="${esc(r.id)}">
      ${head}
      <div class="ret-count">
        <button class="stp" data-id="${esc(r.id)}" data-d="-1">&minus;</button>
        <input class="cnt" id="cnt-${esc(r.id)}" type="number" inputmode="decimal"
               step="${step}" min="0" max="${r.still}" value="${r.still}"
               data-step="${step}" data-max="${r.still}">
        <button class="stp" data-id="${esc(r.id)}" data-d="1">+</button>
        <button class="btn chkin" data-id="${esc(r.id)}" data-job="${esc(jobId)}">Check in</button>
      </div>
      <div class="ret-actions">
        <button class="inc used" data-id="${esc(r.id)}" data-f="used" data-job="${esc(jobId)}">Used it all</button>
        ${item.cls === 'roll' ? `<button class="inc scrap" data-id="${esc(r.id)}" data-f="scrap" data-job="${esc(jobId)}">Under half, scrap it</button>` : ''}
      </div>
    </div>`;
  }

  /* What has already come off the truck. It sits here so that a second load
     does not start from nothing, and so somebody in the shop can check the
     count against what is actually on the bench before the job is closed. */
  function renderSettledRow(l, jobId) {
    const d = AM.derive();
    const isUnit = d.unitById.has(l.id);
    const item = isUnit ? d.unitById.get(l.id) : d.stockById.get(l.id);
    if (!item) return '';
    const rr = { kind: isUnit ? 'unit' : 'stock', item };
    const bits = [];
    if (l.back > 0.001) bits.push(qty(l.back) + ' back on the shelf');
    if (l.consumed > 0.001) bits.push(qty(l.consumed) + ' used on the job');

    return `<div class="ret-row done" data-id="${esc(l.id)}">
      <div class="ret-main">
        <strong>${esc(nameOf(rr))}</strong>
        <span class="line-id">${esc(l.id)}</span>
        <div class="muted small">${bits.join(' · ')}${item.uom ? ' (' + esc(item.uom) + ')' : ''}</div>
      </div>
      <div class="ret-actions">
        ${isUnit ? '' : `<button class="inc fix" data-id="${esc(l.id)}" data-job="${esc(jobId)}">Fix the count</button>`}
      </div>
    </div>`;
  }

  AM.after['#/back'] = function () {
    const m = /job=([^&]+)/.exec(location.hash);
    const jobId = m ? decodeURIComponent(m[1]) : null;
    if (!jobId) {
      wireJobPicker(id => { location.hash = '#/back?job=' + encodeURIComponent(id); });
      return;
    }

    const sb = $('#scanBack');
    if (sb) sb.onclick = () => {
      AM.openScanner(code => {
        const r = findItem(code);
        if (!r) { AM.beep(false); AM.toast('That code is not on this job', 'bad'); return; }
        returnOne(r, jobId, 1);
      }, {
        title: 'Returning from ' + jobLabel(jobId),
        hint: 'Scan each machine at the van door',
        altLabel: 'Use the list instead',
        onAlt: () => AM.render(),
        onClose: () => AM.render()
      });
    };

    /* The counter. Steps by whatever the item is bought in, and never goes
       past what is actually still out, so nobody can check in more coveralls
       than left the shop. */
    const clamp = inp => {
      const step = parseFloat(inp.dataset.step) || 1;
      const max = parseFloat(inp.dataset.max) || 0;
      let v = parseFloat(inp.value);
      if (!isFinite(v) || v < 0) v = 0;
      v = Math.round(v / step) * step;
      if (v > max) v = max;
      inp.value = Math.round(v * 100) / 100;
      return parseFloat(inp.value);
    };

    $$('.stp').forEach(b => b.onclick = () => {
      const inp = document.getElementById('cnt-' + b.dataset.id);
      if (!inp) return;
      const step = parseFloat(inp.dataset.step) || 1;
      inp.value = (parseFloat(inp.value) || 0) + step * parseFloat(b.dataset.d);
      clamp(inp);
    });
    $$('.cnt').forEach(inp => inp.onchange = () => clamp(inp));

    $$('.chkin').forEach(b => b.onclick = async () => {
      const id = b.dataset.id, job = b.dataset.job;
      const inp = document.getElementById('cnt-' + id);
      if (!inp) return;
      const n = clamp(inp);
      if (!n) { AM.toast('Set a count first, or say it was all used.', 'warn'); return; }
      await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: n, scanned: false, toLocation: 'SHOP' });
      AM.beep(true); AM.buzz();
      AM.toast(qty(n) + ' checked in. Anything else on the next load carries on from here.');
    });

    /* Correcting a count is another movement, not an edit. A quarter box found
       on the final sweep adds; an over-count subtracts. Either way the history
       still says what happened. */
    $$('.fix').forEach(b => b.onclick = () => {
      const id = b.dataset.id, job = b.dataset.job;
      const d = AM.derive();
      const l = (d.jobLoad.get(job) || new Map()).get(id);
      const item = d.stockById.get(id);
      if (!l || !item) return;
      const step = partialOK(item) ? 0.25 : 1;
      AM.modal(`
        <h3>${esc(item.name)}</h3>
        <p class="muted small">Checked in so far: ${qty(l.back)}${item.uom ? ' ' + esc(item.uom) : ''}. Set it to what is actually on the bench.</p>
        <label class="fld">Checked in<input id="fxN" type="number" inputmode="decimal" step="${step}" min="0" max="${l.out}" value="${l.back}"></label>
        <div class="row"><button class="btn" id="fxGo">Set it</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
      `, el => {
        $('#fxGo', el).onclick = async () => {
          let v = parseFloat($('#fxN', el).value);
          if (!isFinite(v) || v < 0) return;
          v = Math.min(v, l.out);
          const diff = Math.round((v - l.back) * 100) / 100;
          if (!diff) { AM.closeModal(); return; }
          await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: diff, scanned: false, correction: true, toLocation: 'SHOP' });
          AM.closeModal();
          AM.toast('Corrected to ' + qty(v));
        };
      });
    });

    $$('.inc').forEach(b => b.onclick = async () => {
      const id = b.dataset.id, f = b.dataset.f, job = b.dataset.job;
      const d = AM.derive();
      const isUnit = d.unitById.has(id);
      const rows = d.outstanding.get(job) || [];
      const row = rows.find(x => x.id === id);
      if (!row) return;

      /* It came off the site, so the job's line settles. It just does not go
         back on the shelf, because it is broken. */
      if (f === 'repair') {
        repairModal(id, job);
        return;
      }

      if (f === 'missing') {
        lostModal(id, job);
        return;
      }
      /* Used is not lost. A box of coveralls that went out and did not come
         back was worn, and the job should wear the cost rather than the shop
         going looking for it. */
      if (f === 'used') {
        await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: row.still, reason: 'used on the job' });
        AM.toast('The job wears it. That line is done.');
        return;
      }
      if (f === 'scrap') {
        // Below half does not go back on the shelf. It goes in the scrap box,
        // which sits outside the count on purpose, and the job wears it.
        await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: row.still, reason: 'under half, scrap box' });
        AM.toast('Put it in the scrap box. The job wears it.');
        return;
      }
      const back = isUnit ? Math.min(1, row.still) : row.still;
      await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: back, scanned: false, toLocation: 'SHOP' });
      AM.beep(true); AM.buzz();
    });

    const fin = $('#finGo');
    if (fin) fin.onclick = async () => {
      const job = jobById(jobId);
      await AM.record({ type: 'DEMOB', jobId });
      if (job) { job.closed = AM.nowISO(); await AM.saveCatalog(); }
      AM.toast('Demob finished. This one is closed.');
      location.hash = '#/';
    };

    $$('.st-chk').forEach(c => c.onchange = async () => {
      const job = jobById(c.dataset.job);
      if (!job) return;
      job.strike = job.strike || {};
      job.strike[c.dataset.id] = c.checked ? { by: S.me, at: AM.nowISO() } : null;
      await AM.saveCatalog();
    });

    /* Which stream this load was. It stays on whatever was picked last, because
       a man logging four asbestos loads should not have to say so four times. */
    let stream = 'asbestos';
    const kind = [$('#wAsb'), $('#wCln')].filter(Boolean);
    kind.forEach(b => b.onclick = () => {
      stream = b.dataset.s;
      kind.forEach(x => x.classList.toggle('on', x === b));
    });

    const ws = $('#wSave');
    if (ws) ws.onclick = async () => {
      const bags = parseFloat($('#wBags').value) || 0;
      const trailers = parseFloat($('#wTrl').value) || 0;
      if (!bags && !trailers) return;
      await AM.record({ type: 'WASTE', jobId, bags, trailers, stream });
      AM.toast((stream === 'clean' ? 'Clean demo' : 'Asbestos') + ' logged against the job');
    };
  };

  async function returnOne(r, jobId, n) {
    await AM.record({ type: 'RETURN', itemId: r.item.id, jobId, qty: n, scanned: true, toLocation: 'SHOP' });
    AM.beep(true); AM.buzz();
    AM.scanFeed(sessionRow(r, n, true));
  }

  /* ----------------------------------------------------------- transfer ---- */

  AM.screens['#/move'] = function () {
    const d = AM.derive();
    const onJobs = S.catalog.units.filter(u => (d.unitAt.get(u.id) || {}).where === 'job');

    return `
    <div class="wrap">
      <div class="panel">
        <h2>Site to site</h2>
        <p class="muted">Straight to the next job. It never has to come back through the shop.</p>
        ${AM.why('Cost picks up on the new job from the moment you do this, which is why it is one action rather than a return and then a check out. If it is a negative air unit or a HEPA vacuum, the app will remind you it needs a fresh certificate on the new site before it runs.')}
        <button class="btn big" id="mvScan">Scan the machine</button>
        <button class="btn-ghost" id="mvList">Or pick it off the list</button>
      </div>

      <div class="panel">
        <h2>On jobs right now</h2>
        ${onJobs.length ? `<div class="mv-list">${AM.groupFolds(onJobs.slice(0, 200),
          u => jobLabel((d.unitAt.get(u.id) || {}).jobId),
          u => {
            const a = d.unitAt.get(u.id);
            return `<button class="mv-row" data-id="${esc(u.id)}">
              <div><strong>${esc(u.name)} ${esc(u.unitNo || '')}</strong> <span class="line-id">${esc(u.id)}</span></div>
              <div class="muted small">${esc(jobLabel(a.jobId))} · since ${esc(fmtWhen(a.at))}</div>
            </button>`;
          })}</div>` : '<p class="muted">Nothing is out on a job yet.</p>'}
      </div>
    </div>`;
  };

  AM.after['#/move'] = function () {
    const start = r => {
      const d = AM.derive();
      const at = d.unitAt.get(r.item.id);
      if (!at || at.where !== 'job') { AM.toast('That one is not on a job, so check it out instead.', 'warn'); return; }
      pickJobModal('Move it to which job?', toId => {
        if (toId === at.jobId) { AM.toast('That is the job it is already on.', 'warn'); return; }
        AM.record({ type: 'TRANSFER', itemId: r.item.id, fromJobId: at.jobId, toJobId: toId, qty: 1, scanned: true })
          .then(() => {
            AM.beep(true); AM.buzz();
            const dop = needsDOP(r.item);
            AM.toast(dop
              ? `Moved. This one needs a fresh certificate on the new site before it runs.`
              : 'Moved to ' + jobLabel(toId));
          });
      });
    };

    const b = $('#mvScan');
    if (b) b.onclick = () => AM.openScanner(code => {
      const r = findItem(code);
      if (!r) { AM.beep(false); AM.toast('Nothing here is tagged that', 'bad'); return; }
      AM.closeScanner(() => start(r));
    }, { title: 'Transfer', hint: 'Scan the machine you are moving', onClose: () => AM.render() });

    const l = $('#mvList');
    if (l) l.onclick = () => pickList(id => { const r = findItem(id); if (r) start(r); });

    $$('.mv-row').forEach(x => x.onclick = () => { const r = findItem(x.dataset.id); if (r) start(r); });
  };

  function needsDOP(unit) { return !!unit.dop; }
  AM.needsDOP = needsDOP;


  /* ------------------------------------------------------------ arrived ----
     A delivery landing on the shelves is shop floor work, not office work. It
     happens at the back door with a pallet and a packing slip, by whoever
     signed for it, which is why this is a box on the crew's first screen and
     not something the office types in later off a piece of paper.

     It adds, and it never replaces. A count is a different act, done by
     somebody standing at the shelf, and it stays on the office screen. Mixing
     the two is how the one number worth having, the gap between what was
     bought and what is there, quietly disappears. */

  function arrivedModal(id, after) {
    const s = S.catalog.stock.find(x => String(x.id) === String(id));
    if (!s) { AM.toast('That is a machine, not a shelf item. Machines come in through Settings.', 'warn'); return; }
    const n = AM.derive().onHand.get(s.id);
    AM.modal(`
      <h3>${esc(s.name)}</h3>
      <p class="muted small">${esc(s.id)} · ${n == null ? 'never counted' : qty(n) + ' ' + esc(s.uom || '') + ' on the shelf now'}</p>
      <label class="fld">How many arrived
        <input id="inQty" type="number" inputmode="decimal" step="0.25" placeholder="0"></label>
      <p class="muted small">Count what is actually in the box, not what the packing slip says. If they shorted you, this is where the shop finds out.</p>
      <div class="row"><button class="btn big" id="inGo">On the shelf</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
    `, el => {
      $('#inGo', el).onclick = async () => {
        const q = parseFloat($('#inQty', el).value);
        if (!isFinite(q) || q <= 0) { AM.toast('How many arrived?', 'warn'); return; }
        await AM.record({ type: 'RECEIVE', itemId: s.id, qty: q });
        AM.closeModal();
        AM.beep(true); AM.buzz();
        AM.toast(`${qty(q)} ${s.uom || ''} on the shelf.`);
        if (after) after();
        AM.render();
      };
      setTimeout(() => $('#inQty', el).focus(), 60);
    });
  }

  AM.screens['#/in'] = function () {
    const today = AM.dayISO();
    const mine = S.events.filter(e => e.type === 'RECEIVE' && String(e.at).slice(0, 10) === today).slice(-12).reverse();
    return `
    <div class="wrap">
      <div class="panel">
        <h2>Stock arrived</h2>
        <p class="muted">Scan the card on the shelf edge, or pick it off the list. This adds to what is already there.</p>
        <button class="btn big" id="inScan" data-tour="arrivedscan">Scan the shelf card</button>
        <button class="btn-ghost" id="inList">Or pick it off the list</button>
      </div>

      <div class="panel">
        <h2>Put away today</h2>
        ${mine.length ? `<div class="req-list">${mine.map(e => {
          const s = S.catalog.stock.find(x => x.id === e.itemId);
          return `<div class="req-row">
            <div><strong>${esc(qty(e.qty))} &times; ${esc(s ? s.name : e.itemId)}</strong>
              <div class="muted small">${esc(e.by || '')} · ${esc(fmtWhen(e.at))}</div></div>
            <div class="req-state done">on the shelf</div>
          </div>`;
        }).join('')}</div>`
        : '<p class="muted">Nothing has come in today yet.</p>'}
      </div>
    </div>`;
  };

  AM.after['#/in'] = function () {
    const again = () => AM.after['#/in']();
    const b = $('#inScan');
    if (b) b.onclick = () => AM.openScanner(code => {
      const r = findItem(code);
      if (!r) { AM.beep(false); AM.toast('Nothing here is tagged that', 'bad'); return; }
      AM.closeScanner(() => arrivedModal(r.item.id, again));
    }, {
      title: 'Stock arrived',
      hint: 'Scan the card on the shelf edge',
      altLabel: 'Cannot scan it',
      onAlt: () => pickList(id => arrivedModal(id, again)),
      onClose: () => AM.render()
    });
    const l = $('#inList');
    if (l) l.onclick = () => pickList(id => arrivedModal(id, again));
  };

  /* --------------------------------------------------------------- find ---- */

  AM.screens['#/find'] = function () {
    return `
    <div class="wrap">
      <div class="panel">
        <h2>Find anything</h2>
        <p class="muted">Machines and everything on the shelf. Type a name, a unit number, a serial, or what you are after: gloves, poly, filters.</p>
        <input id="fq" class="search big" data-tour="findbox" placeholder="dehumidifier, NEG-44, gloves, poly…" autocomplete="off">
        <div class="find-chips">
          <!-- The shelf was always searchable here and nobody could tell,
               because the screen only ever talked about machines and the
               shelf results only appeared once you had already typed. It gets
               a button of its own now. -->
          <button class="chip" data-q="__stock">On the shelf</button>
          <button class="chip" data-q="__job">On jobs</button>
          <button class="chip" data-q="__shop">In the shop</button>
          <button class="chip" data-q="__repair">Out of service</button>
          <button class="chip" data-q="__missing">Lost</button>
          <button class="chip" data-q="__dop">Needs a certificate</button>
        </div>
      </div>
      <div id="findOut"></div>
    </div>`;
  };

  AM.after['#/find'] = function () {
    const out = $('#findOut');
    const draw = q => {
      const d = AM.derive();
      const t = String(q || '').trim().toLowerCase();
      let list = S.catalog.units;

      if (t === '__job') list = list.filter(u => (d.unitAt.get(u.id) || {}).where === 'job');
      else if (t === '__shop') list = list.filter(u => !d.unitAt.has(u.id) || d.unitAt.get(u.id).where === 'shop');
      else if (t === '__repair') list = list.filter(u => (d.unitAt.get(u.id) || {}).where === 'repair');
      else if (t === '__missing') list = list.filter(u => (d.unitAt.get(u.id) || {}).where === 'missing');
      else if (t === '__dop') list = list.filter(u => u.dop && dopState(u.id).state !== 'ok');
      else if (t) list = list.filter(u =>
        (u.id + ' ' + u.name + ' ' + (u.unitNo || '') + ' ' + (u.serial || '') + ' ' + (u.model || '') + ' ' + u.group).toLowerCase().includes(t));
      else list = list.slice(0, 0);

      /* Anything out of the shop sits at the top: missing first, then out on a
         job, then everything sitting in the shop. Inside each band, alphabetical
         so the list stays readable. */
      const band = u => {
        const a = d.unitAt.get(u.id);
        if (a && a.where === 'missing') return 0;
        if (a && a.where === 'repair') return 1;
        if (a && a.where === 'job') return 2;
        return 3;
      };
      list = list.slice().sort((x, y) => {
        const b = band(x) - band(y);
        if (b) return b;
        return (x.name + ' ' + (x.unitNo || '')).localeCompare(y.name + ' ' + (y.unitNo || ''), undefined, { numeric: true });
      });

      const onlyStock = t === '__stock';
      if (onlyStock) list = [];
      const stockHits = onlyStock
        ? S.catalog.stock.slice().sort((a, b) => (a.group + a.name).localeCompare(b.group + b.name))
        : (t && !t.startsWith('__')
          ? S.catalog.stock.filter(s => (s.id + ' ' + s.name + ' ' + s.group).toLowerCase().includes(t))
          : []);

      /* A list longer than a screenful arrives shut, grouped, with the count on
         each heading. A short one, or one somebody has typed a word into, stays
         open, because folding away four results somebody just searched for is
         its own kind of unhelpful. */
      const stockRow = s => {
        const n = d.onHand.get(s.id);
        const lowFlag = s.min != null && n != null && n <= s.min;
        return `<div class="find-row"><div><strong>${esc(s.name)}</strong> <span class="line-id">${esc(s.id)}</span>
          <div class="muted small">${esc(s.group)}${s.shelf ? ' · ' + esc(s.shelf) : ''}</div></div>
          <div class="find-where ${lowFlag ? 'bad' : ''}">${n == null ? '<span class="muted">not counted</span>' : qty(n) + ' ' + esc(s.uom || '')}
          ${lowFlag ? '<div class="muted small">running low</div>' : ''}</div></div>`;
      };

      out.innerHTML = `
        ${stockHits.length ? `<div class="panel"><h2>On the shelf</h2>
          <p class="muted small">Not counted means nobody has been round the shelf yet. Trust your eyes over the screen.</p>
          ${AM.groupFolds(stockHits.slice(0, 400), s => s.group, stockRow, s => {
            const n = d.onHand.get(s.id);
            return n == null ? 'not counted' : null;
          })}</div>` : ''}

        ${onlyStock ? '' : `<div class="panel">
          <h2>${list.length} machine${list.length === 1 ? '' : 's'}</h2>
          ${list.length ? AM.groupFolds(list.slice(0, 300), u => u.group, u => {
            const a = d.unitAt.get(u.id);
            const where = !a || a.where === 'shop' ? 'Shop'
              : a.where === 'missing' ? 'LOST'
              : a.where === 'writeoff' ? 'WRITTEN OFF'
              : a.where === 'repair' ? 'OUT OF SERVICE' : jobLabel(a.jobId);
            const ds = u.dop ? dopState(u.id) : null;
            return `<div class="find-row tap" data-unit="${esc(u.id)}">
              <div><strong>${esc(u.name)} ${esc(u.unitNo || '')}</strong> <span class="line-id">${esc(u.id)}</span>
                <div class="muted small">${esc(u.model || u.group)}${u.serial ? ' · ' + esc(u.serial) : ''}</div>
                ${a && (a.where === 'repair' || a.where === 'missing') && a.note ? `<div class="fault">${esc(a.note)}</div>` : ''}</div>
              <div class="find-where ${a && a.where !== 'shop' && a.where !== 'job' ? 'bad' : ''}">${esc(where)}
                ${a ? `<div class="muted small">${esc(fmtWhen(a.at))}${a.by ? ' · ' + esc(a.by) : ''}</div>` : ''}
                ${ds && ds.state !== 'ok' ? `<div class="cert ${ds.state}">${esc(ds.label)}</div>` : ''}
              </div>
            </div>`;
          }) : '<p class="muted">Type something above, or tap one of the buttons.</p>'}
        </div>`}`;
    };

    /* Tapping a machine here is how one that breaks in the shop, rather than on
       a job, gets pulled, and how it comes back. Same screen, both directions. */
    const wireRows = () => {
      $$('.find-row.tap').forEach(row => row.onclick = () => {
        const id = row.dataset.unit;
        const at = AM.derive().unitAt.get(id);
        const redraw = () => AM.after['#/find']();
        if (at && at.where === 'repair') fixedModal(id, redraw);
        else if (at && at.where === 'missing') foundModal(id, redraw);
        else if (at && at.where === 'writeoff') AM.toast('Written off. The office takes it off the fleet.', 'warn');
        else if (at && at.where === 'job') {
          AM.toast('It is out on ' + jobLabel(at.jobId) + '. Pull it in on tear down.', 'warn');
        } else repairModal(id, null, redraw);
      });
    };

    const drawAndWire = q => {
      draw(q);
      wireRows();
      $$('.find-chips .chip').forEach(c => c.classList.toggle('on', c.dataset.q === q));
    };
    $('#fq').oninput = e => drawAndWire(e.target.value);
    $$('.find-chips .chip').forEach(c => c.onclick = () => { $('#fq').value = ''; drawAndWire(c.dataset.q); });

    /* Opened from a count on the home screen: "eleven out of service" is a
       question, and this is the answer, already filtered. */
    const m = /[?&]f=([^&]+)/.exec(location.hash);
    drawAndWire(m ? decodeURIComponent(m[1]) : '');
  };

  /* Certificates. Alberta wants a DOP or PAO test on a HEPA vacuum or a
     negative air unit at least every 30 days while it is running, at least once
     a year while it is sitting, whenever a filter is changed, and on site
     before a negative air system starts filtering. No product on the market
     keeps this register, which is exactly why it is in here. */
  function dopState(unitId) {
    const d = AM.derive();
    const rec = d.dop.get(unitId);
    const at = d.unitAt.get(unitId);
    const inService = at && at.where === 'job';
    const settings = S.catalog.settings || {};
    const windowDays = inService ? (settings.dopDaysInService || 30) : (settings.dopDaysIdle || 365);

    if (!rec || !rec.last) return { state: 'none', label: 'no certificate on file', days: null };
    if (rec.result === 'fail') return { state: 'fail', label: 'FAILED, do not deploy', days: null };
    const age = AM.daysBetween(rec.last, new Date());
    const left = windowDays - age;
    if (left < 0) return { state: 'overdue', label: `certificate expired ${-left} days ago`, days: left };
    if (left <= 5) return { state: 'due', label: `certificate due in ${left} days`, days: left };
    return { state: 'ok', label: `tested ${age} days ago`, days: left };
  }
  AM.dopState = dopState;

  /* ------------------------------------------------------------ shared ui -- */

  /* Picking the job. With ninety open, scrolling is not a way to find one, so
     the box at the top takes a number, a street or a name, and the list under
     it stays short until somebody asks for the rest. Jobs with gear standing on
     them sit at the top, because that is what a tear down is. */
  const PICK_JOBS = 8;

  function jobRowsHtml(jobs) {
    return jobs.map(j => {
      const out = (AM.derive().outstanding.get(j.id) || []).length;
      return `<button class="job-btn" data-id="${esc(j.id)}">
        <strong>${esc(jobLabel(j.id))}</strong>
        <span class="muted small">${esc(j.address || '')}${out ? ' · ' + out + ' out' : ''}</span></button>`;
    }).join('');
  }

  function jobPicker(title, question, onPick) {
    const jobs = openJobs();
    return `
    <div class="wrap">
      <div class="panel">
        <h2>${esc(title)}</h2>
        <p class="muted">${esc(question)}</p>
        ${jobs.length > PICK_JOBS
          ? `<input id="jpq" class="search" placeholder="Job number, street or name" autocomplete="off">` : ''}
        <div class="job-pick" data-tour="jobpick" id="jpList"></div>
        <button class="btn-ghost wide" id="jpMore" hidden></button>
        <div class="job-pick">
          <button class="job-btn new" id="newJob"><strong>New job</strong>
            <span class="muted small">emergency call, nothing in JobTread yet</span></button>
        </div>
      </div>
    </div>`;
  }

  function wireJobPicker(onPick) {
    const list = $('#jpList');
    const more = $('#jpMore');
    let open = false;

    const draw = () => {
      if (!list) return;
      const t = (($('#jpq') || {}).value || '').trim().toLowerCase();
      const d = AM.derive();
      let jobs = openJobs();
      if (t) jobs = jobs.filter(j =>
        ((j.number || '') + ' ' + j.name + ' ' + (j.address || '')).toLowerCase().includes(t));
      jobs = jobs.slice().sort((a, b) =>
        ((d.outstanding.get(b.id) || []).length) - ((d.outstanding.get(a.id) || []).length));
      const shown = (open || t) ? jobs : jobs.slice(0, PICK_JOBS);
      const hidden = jobs.length - shown.length;
      list.innerHTML = jobRowsHtml(shown) ||
        '<p class="muted">Nothing matches that. Check the number, or start a new job below.</p>';
      if (more) {
        if (hidden > 0) { more.hidden = false; more.textContent = `Show the other ${hidden} job${hidden === 1 ? '' : 's'}`; }
        else if (open && !t) { more.hidden = false; more.textContent = 'Show fewer'; }
        else more.hidden = true;
      }
      $$('.job-btn[data-id]', list).forEach(b => b.onclick = () => onPick(b.dataset.id));
    };

    if (more) more.onclick = () => { open = !open; draw(); };
    const q = $('#jpq');
    if (q) q.oninput = draw;
    draw();

    const nj = $('#newJob');
    if (nj) nj.onclick = () => newJobModal(onPick);
  }

  /* Emergency work mobilises at night and at weekends, before anybody has
     opened JobTread. The job is created HERE and held unlinked. It is not
     created in JobTread at 2am, because over there a job's address can never be
     changed afterwards, its customer can never be changed either, and there is
     no way to merge two jobs. A placeholder made in the middle of the night can
     never be pointed at the real customer. The office links it in the morning
     and everything logged over the weekend goes across then. */
  /* One box and two buttons. This gets opened at two in the morning by somebody
     standing in a wet basement. Containment type, area, crew size and the
     paperwork all belong to the office and can be filled in later, on a
     desk, by whoever actually knows. Never ask the field for something the
     office already has. */
  function newJobModal(onPick) {
    AM.modal(`
      <h3>New job</h3>
      <label class="fld">Where is it<input id="njName" placeholder="10423 82 Ave basement" autocomplete="off"></label>
      <div class="two-up">
        <button class="job-btn" id="njAb"><strong>Abatement</strong></button>
        <button class="job-btn" id="njRe"><strong>Restoration</strong></button>
      </div>
      <p class="muted small">Nothing needs to exist in JobTread. The office picks it up later.</p>
    `, el => {
      const make = async division => {
        const name = $('#njName', el).value.trim();
        if (!name) { $('#njName', el).focus(); return; }
        const id = 'INV-' + AM.dayISO().replace(/-/g, '') + '-' + Math.random().toString(36).slice(2, 5).toUpperCase();
        S.catalog.jobs = S.catalog.jobs || [];
        S.catalog.jobs.push({
          id, name, number: '', address: name, division,
          // Restoration is on site within two to four hours and estimates
          // afterwards, so it starts at its own phase, not at estimating.
          phase: division === 'restoration' ? 'R2' : 'P4',
          containment: null, waterCategory: null, areaSqFt: null, crewSize: null,
          preMob: {}, strike: {},
          jobtreadId: null, createdAt: AM.nowISO(), createdBy: S.me, closed: false
        });
        await AM.saveCatalog();
        AM.closeModal();
        onPick(id);
      };
      $('#njAb', el).onclick = () => make('abatement');
      $('#njRe', el).onclick = () => make('restoration');
      setTimeout(() => $('#njName', el).focus(), 60);
    });
  }

  function pickJobModal(question, onPick) {
    const jobs = openJobs();
    AM.modal(`
      <h3>${esc(question)}</h3>
      <div class="who-list">
        ${jobs.map(j => `<button class="who-pick" data-id="${esc(j.id)}">${esc(jobLabel(j.id))}</button>`).join('')}
      </div>
      <button class="btn-ghost" id="njOpen">New job</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
    `, el => {
      $$('.who-pick', el).forEach(b => b.onclick = () => { AM.closeModal(); onPick(b.dataset.id); });
      $('#njOpen', el).onclick = () => { AM.closeModal(); newJobModal(onPick); };
    });
  }
  AM.pickJobModal = pickJobModal;

  /* The running list during a check out, and the one button that commits it. */
  function sessionScreen(title, note) {
    const job = jobById(session.jobId) || {};
    // One line on the screen, with the reasoning one tap behind it. If the
    // office has told the app what shape this job is, say what it usually
    // takes. If it has not, say nothing at all.
    const suggest = window.SOP.suggest(job, S.catalog);
    const hint = suggest.length
      ? suggest.map(s => s.count + ' × ' + s.group.toLowerCase()).join(', ')
      : '';

    // The manual's own pre-mobilization list, as a count rather than a gate.
    const type3 = job.division !== 'restoration' && String(job.containment) === '3';
    const pm = window.SOP.preMob.filter(i => i.appliesTo === 'all' || (i.appliesTo === 'type3' && type3));
    const pmOpen = pm.filter(i => !(job.preMob && job.preMob[i.id]));

    return `
    <div class="wrap">
      <div class="panel">
        <div class="panel-head">
          <div><h2>${esc(title)} ${esc(jobLabel(session.jobId))}</h2><p class="muted">${esc(note)}</p></div>
          <button class="btn" id="ssScan">Scan more</button>
        </div>
        ${hint ? `<button class="hint" id="ssWhy">A job this shape usually takes ${esc(hint)}. <span class="hint-more">why</span></button>` : ''}
        ${pmOpen.length && job.preMob ? `<p class="hint warn-hint">${pmOpen.length} thing${pmOpen.length === 1 ? '' : 's'} on the pre-mobilization list not confirmed yet. Not a blocker, but somebody in the office should know.</p>` : ''}
        ${(() => {
          /* What the estimator priced, as a list to load against. It ticks
             itself off as things are scanned, and it never blocks anything:
             an estimate is a good guess made from an office, and the man at
             the van is the one looking at the job. */
          const pull = job.pullList || [];
          if (!pull.length || session.mode !== 'out') return '';
          const got = id => session.lines.filter(l => l.id === id).reduce((a, l) => a + l.qty, 0);
          const left = pull.filter(l => !l.itemId || got(l.itemId) + 0.001 < (l.qty || 0)).length;
          return `<div class="pull">
            <div class="pull-head">On the estimate for this job${left ? ` · ${left} still to load` : ' · all of it is on'}</div>
            ${pull.map(l => {
              const n = l.itemId ? got(l.itemId) : 0;
              const done = l.itemId && n + 0.001 >= (l.qty || 0);
              return `<div class="pull-row ${done ? 'done' : ''}">
                <span>${done ? '✓ ' : ''}${esc(l.name)}</span>
                <span class="muted small">${qty(l.qty || 0)}${l.uom ? ' ' + esc(l.uom) : ''}${l.itemId && n ? ' · ' + qty(n) + ' on' : ''}</span>
              </div>`;
            }).join('')}
          </div>`;
        })()}
        ${session.lines.length ? `<div class="ret-list" data-tour="session">${session.lines.map(l => {
          const r = findItem(l.id);
          return r ? sessionRow(r, l.qty, l.scanned) : '';
        }).join('')}</div>` : '<p class="muted">Nothing on the list yet.</p>'}
        <div class="row">
          <button class="btn big" id="ssDone" data-tour="send" ${session.lines.length ? '' : 'disabled'}>Send it to the job</button>
          <button class="btn-ghost" id="ssList">Add off the list</button>
          <button class="btn-ghost" id="ssCancel">Start over</button>
        </div>
      </div>
    </div>`;
  }

  AM.after['#/out'] = function () {
    if (!session || session.mode !== 'out') {
      wireJobPicker(id => {
        startSession('out', id);
        AM.render();
        // Straight to the camera, unless the pre-mobilization list stops it.
        if (preMobState(id).ready || preMobState(id).overridden) openOutScanner();
      });
      return;
    }

    /* The gate. Either it gets walked, or somebody puts their name to going
       without it. There is no third door and no silent skip. */
    const pmGo = $('#pmGo');
    if (pmGo) {
      $('#pmBack').onclick = () => { session = null; AM.render(); };
      pmGo.onclick = () => {
        const pm = preMobState(session.jobId);
        AM.modal(`
          <h3>Going without the pre-mobilization list</h3>
          <p class="muted small">${pm.missing.map(i => esc(i.text)).join(' · ')}</p>
          <label class="fld">Why<input id="pmWhy" placeholder="emergency call, office not open yet" autocomplete="off"></label>
          <div class="row"><button class="btn big" id="pmYes">Load the van</button>
          <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
        `, el => {
          $('#pmYes', el).onclick = async () => {
            const why = $('#pmWhy', el).value.trim();
            if (!why) { AM.toast('Say why. It is one line and it is what the office reads.', 'warn'); return; }
            await AM.record({ type: 'PREMOB_OVERRIDE', jobId: session.jobId, note: why,
              missing: pm.missing.map(i => i.id) });
            AM.closeModal();
            AM.render();
            openOutScanner();
          };
          setTimeout(() => $('#pmWhy', el).focus(), 60);
        });
      };
      return;
    }

    $('#ssScan').onclick = openOutScanner;

    /* Where those numbers came from. Two of them are quoted out of A&M's own
       restoration flow. The rest are defaults somebody typed once, and they say
       so, because a ratio in a settings file should never be able to pass
       itself off as a regulation. */
    const why = $('#ssWhy');
    if (why) why.onclick = () => {
      const job = jobById(session.jobId) || {};
      const suggest = window.SOP.suggest(job, S.catalog);
      AM.modal(`
        <h3>Where these numbers come from</h3>
        <div class="sug-list">
          ${suggest.map(s => `<div class="sug ${s.assumed ? 'guess' : ''}">
            <strong>${esc(String(s.count))} × ${esc(s.group)}</strong>
            <div class="muted small">${esc(s.why)}</div>
            ${s.assumed ? '<div class="cert due">A&amp;M default, not from the manual. Craig should set this.</div>' : ''}
          </div>`).join('')}
        </div>
        <p class="muted small">A starting point, not an order. Pull what the job actually needs.</p>
        <button class="btn" onclick="AM.closeModal()">Right</button>
      `);
    };
    $('#ssList').onclick = () => pickList(id => { handleCode(id, false); AM.render(); });
    $('#ssCancel').onclick = () => { session = null; AM.render(); };
    $('#ssDone').onclick = async () => {
      const blocked = [];
      for (const l of session.lines) {
        if (l.kind !== 'unit') continue;
        const u = AM.state.catalog.units.find(x => x.id === l.id);
        if (u && u.dop) {
          const st = dopState(u.id);
          if (st.state === 'fail' || st.state === 'overdue' || st.state === 'none') blocked.push({ u, st });
        }
      }
      const job = jobById(session.jobId) || {};
      const send = async () => {
        await AM.recordMany(session.lines.map(l => ({
          type: 'ISSUE', itemId: l.id, jobId: session.jobId, qty: l.qty,
          scanned: l.scanned, fromLocation: 'SHOP',
          dueBack: job.expectedReturn || null   // SOP: sign-out carries an expected return date
        })));
        const n = session.lines.length;
        session = null;
        AM.toast(`${n} line${n === 1 ? '' : 's'} on the job`);
        AM.go('#/');
      };

      if (blocked.length) {
        AM.modal(`
          <h3>Certificates first</h3>
          <p>These need a DOP or PAO test before they run on a job. Alberta wants one on site before a negative air system starts filtering.</p>
          <ul class="warn-list">${blocked.map(b => `<li><strong>${esc(b.u.name)} ${esc(b.u.unitNo || '')}</strong> ${esc(b.u.id)} — ${esc(b.st.label)}</li>`).join('')}</ul>
          <div class="row">
            <button class="btn-ghost" id="blkGo">Send anyway, test on site</button>
            <button class="btn" onclick="AM.closeModal()">Go back</button>
          </div>
        `, el => { $('#blkGo', el).onclick = () => { AM.closeModal(); send(); }; });
        return;
      }
      send();
    };
  };

  AM.screens['#/more'] = function () {
    return `<div class="wrap"><div class="panel"><h2>Office</h2>
      <div class="more-list">
        ${['#/dash|Today','#/shelf|Shelf','#/jobs|Jobs','#/order|Order','#/dop|Certificates','#/labels|Labels','#/link|JobTread','#/setup|Settings']
          .map(x => { const [h, l] = x.split('|'); return `<a class="more-row" href="${h}">${esc(l)}</a>`; }).join('')}
      </div></div></div>`;
  };

})();
