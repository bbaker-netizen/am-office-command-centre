/* A&M Inventory - the screens the office and the shop lead use.

   The crew screens exist to capture what happened. These exist to make it worth
   capturing: what is below minimum at three o'clock, what never came back off a
   job, which machines are out of certificate, and what the consumption on a job
   actually cost. */

'use strict';

(function () {
  const { esc, qty, money, fmtWhen } = AM;
  const S = AM.state;
  const $ = AM.$, $$ = AM.$$;
  const jobLabel = id => AM.jobLabel(id);

  const stockOnHand = id => {
    const d = AM.derive();
    const v = d.onHand.get(id);
    return v == null ? null : v;
  };

  function belowMin() {
    const d = AM.derive();
    const out = [];
    for (const s of S.catalog.stock) {
      if (s.min == null) continue;
      const n = d.onHand.get(s.id);
      if (n == null) continue;
      if (n <= s.min) out.push({ ...s, onHand: n, short: (s.max != null ? s.max : s.min * 2) - n });
    }
    return out.sort((a, b) => (a.onHand / (a.min || 1)) - (b.onHand / (b.min || 1)));
  }
  AM.belowMin = belowMin;

  /* Who a thing is bought from. The spec calls this the master pricing list:
     the draft order picks the supplier from it rather than everything defaulting
     to whoever happened to sell A&M the last one. An item can carry a vendor
     from the list, or a plain name inherited from the invoices it was built
     from, and either works. */
  const vendorList = () => S.catalog.vendors || [];
  function vendorName(item) {
    if (item.vendorId) {
      const v = vendorList().find(x => x.id === item.vendorId);
      if (v) return v.name;
    }
    return item.vendor || 'Not set';
  }
  AM.vendorName = vendorName;

  /* --------------------------------------------------------------- today --- */

  /* Row builders, pulled out so a list can be rendered flat when it is short
     and inside folds when it is long, without the row being written twice. */
  const lowRow = s => `<tr><td><strong>${esc(s.name)}</strong><div class="line-id">${esc(s.id)}</div></td>
    <td>${esc(s.group)}</td><td class="n">${qty(s.onHand)} ${esc(s.uom || '')}</td>
    <td class="n">${qty(s.min)}</td><td class="n bad">${qty(Math.max(0, s.short))}</td></tr>`;

  function lostRow(u) {
    const d = AM.derive();
    const a = d.unitAt.get(u.id) || {};
    const r = d.lost.get(u.id) || {};
    const days = AM.daysBetween(a.at, new Date());
    return `<div class="find-row">
      <div><strong>${esc(u.name)} ${esc(u.unitNo || '')}</strong> <span class="line-id">${esc(u.id)}</span>
        ${a.note ? `<div class="fault">last seen: ${esc(a.note)}</div>` : ''}
        ${(r.chase || []).length ? `<div class="muted small">${r.chase.map(c => esc(c.by || '') + ': ' + esc(c.note)).join(' · ')}</div>` : ''}
        <div class="muted small">off ${esc(jobLabel(a.jobId))} · last had it: ${esc(a.by || 'unknown')} · ${esc(fmtWhen(a.at))}</div></div>
      <div class="find-where bad">${days} day${days === 1 ? '' : 's'} gone
        <div class="row tight">
          <button class="btn-ghost lchase" data-id="${esc(u.id)}">Chase it</button>
          <button class="btn-ghost lwrite" data-id="${esc(u.id)}">Write it off</button>
        </div></div>
    </div>`;
  }

  AM.screens['#/dash'] = function () {
    const d = AM.derive();
    const today = AM.dayISO();
    const todays = S.events.filter(e => (e.at || '').slice(0, 10) === today);
    const issuedToday = todays.filter(e => e.type === 'ISSUE');
    const unscanned = issuedToday.filter(e => !e.scanned).length;
    const scanRate = issuedToday.length ? Math.round((1 - unscanned / issuedToday.length) * 100) : null;

    const low = belowMin();
    const missing = S.catalog.units.filter(u => (d.unitAt.get(u.id) || {}).where === 'missing');
    const broken = S.catalog.units.filter(u => (d.unitAt.get(u.id) || {}).where === 'repair');
    const certs = S.catalog.units.filter(u => u.dop).map(u => ({ u, st: AM.dopState(u.id) }))
      .filter(x => x.st.state !== 'ok');
    const onJobs = S.catalog.units.filter(u => (d.unitAt.get(u.id) || {}).where === 'job');
    const counted = S.catalog.stock.filter(s => d.onHand.get(s.id) != null).length;

    /* This used to sit on the crew's shop screen, which is the one screen in
       the app with no Settings button on it. It belongs here, where Settings
       is one button along the bar. It goes away on its own once both are
       connected. */
    const setup = S.conn.checked && (!S.conn.jobtread || !S.conn.qbo);

    return `
    <div class="wrap wide">
      ${setup ? `<div class="panel setup-card">
        <h2>Finish setting this up</h2>
        <p class="muted small">Everything in the app works without these. They are what connects it to the rest of the business.</p>
        <div class="setup-links">
          <a class="setup-link ${S.conn.jobtread ? 'done' : ''}" href="#/link">
            <strong>JobTread</strong>
            <span>${S.conn.jobtread ? 'connected' : 'not connected yet'}</span></a>
          <a class="setup-link ${S.conn.qbo ? 'done' : ''}" href="#/setup">
            <strong>QuickBooks</strong>
            <span>${S.conn.qbo ? 'connected' : 'not connected yet'}</span></a>
          <a class="setup-link" href="#/setup"><strong>People</strong><span>who can use this</span></a>
        </div>
      </div>` : ''}

      <div class="stat-row big">
        <div class="stat"><b>${onJobs.length}</b><span>machines on jobs</span></div>
        <div class="stat ${low.length ? 'bad' : ''}"><b>${low.length}</b><span>below minimum</span></div>
        <div class="stat ${certs.length ? 'warn' : ''}"><b>${certs.length}</b><span>certificates to sort</span></div>
        <div class="stat ${missing.length ? 'bad' : ''}"><b>${missing.length}</b><span>cannot be found</span></div>
        <div class="stat ${broken.length ? 'warn' : ''}"><b>${broken.length}</b><span>out of service</span></div>
        <div class="stat ${d.requests.filter(r => !r.filled).length ? 'warn' : ''}"><b>${d.requests.filter(r => !r.filled).length}</b><span>asked for</span></div>
        <div class="stat"><b>${scanRate == null ? '—' : scanRate + '%'}</b><span>scanned, not typed</span></div>
      </div>

      <!-- Only worth saying once enough has gone out to mean anything. One
           line typed off the list on a quiet morning is 0% scanned, and a red
           panel over that is noise the first thing every day. -->
      ${scanRate != null && scanRate < 80 && issuedToday.length >= 5 ? `<div class="panel note bad">
        <h2>Only ${scanRate}% of today's gear was scanned</h2>
        <p>The rest was typed off the list rather than scanned. That is allowed and it is not a rule, but when most of a day is typed the record stops matching the shop. Worth a word at the tailgate.</p>
      </div>` : ''}

      <div class="panel">
        <div class="panel-head">
          <div><h2>Below minimum</h2>
          <p class="muted">The three o'clock list. Walk the shelf, confirm it with your own eyes, then draft the order.</p></div>
          <a class="btn" href="#/order">Draft the order</a>
        </div>
        ${low.length ? (low.length <= 15
          ? `<table class="tbl"><thead><tr><th>Item</th><th>Shelf</th><th class="n">On hand</th><th class="n">Minimum</th><th class="n">Short by</th></tr></thead><tbody>
            ${low.map(lowRow).join('')}</tbody></table>`
          : [...new Set(low.map(s => s.group))].map(g => {
              const inG = low.filter(s => s.group === g);
              return `<details class="grp-fold" open><summary><span class="grp">${esc(g)}</span>
                <span class="grp-tally"><b class="bad-text">${inG.length} below</b></span></summary>
                <table class="tbl"><thead><tr><th>Item</th><th>Shelf</th><th class="n">On hand</th><th class="n">Minimum</th><th class="n">Short by</th></tr></thead><tbody>
                ${inG.map(lowRow).join('')}</tbody></table></details>`;
            }).join(''))
        : counted === 0
          ? `<p class="muted">Nothing has been counted yet, so nothing can be below minimum. Count the shelf on the Shelf screen and set a minimum against each item.</p>`
          : `<p class="clear-note">Everything with a minimum against it is above it.</p>`}
      </div>

      ${d.requests.filter(r => !r.filled).length ? `<div class="panel">
        <div class="panel-head"><div><h2>Asked for, for tomorrow</h2>
        <p class="muted">The manual wants these in by two o'clock. Anything marked late came in after that.</p></div></div>
        ${d.requests.filter(r => !r.filled).map(r => `<div class="find-row">
          <div><strong>${esc(r.text)}</strong>
            <div class="muted small">${esc(jobLabel(r.jobId))} · ${esc(r.by || '')} · ${esc(fmtWhen(r.at))}${r.note ? ' · ' + esc(r.note) : ''}</div></div>
          <div class="find-where">
            ${r.afterTwo ? '<span class="cert due">after two</span>' : ''}
            <button class="btn-ghost req-fill" data-id="${esc(r.id)}">Pulled</button></div>
        </div>`).join('')}
      </div>` : ''}

      <div class="panel" id="seedNudge" hidden>
        <h2 id="seedNudgeH"></h2>
        <p class="muted">These came with the app but are not in the list this shop is running. Bringing them in only ever adds. It never touches a count, a minimum, or anything anybody has written.</p>
        <div class="row"><button class="btn" id="seedNudgeGo">Bring them in</button>
        <a class="btn-ghost" href="#/setup">Look at settings first</a></div>
      </div>

      ${(() => {
        /* The manual's pre-mobilization list is a desk job done the day before,
           not something to remember at six in the morning with a van running.
           So it is a dated list: what goes out tomorrow, and how much of it is
           actually ready. A crew cannot mobilize a job that is not. */
        const today = AM.dayISO();
        const tomorrow = AM.dayISO(new Date(Date.now() + 86400000));
        const soon = (S.catalog.jobs || []).filter(j => !j.closed && (j.mobDate === today || j.mobDate === tomorrow))
          .sort((a, b) => (a.mobDate || '').localeCompare(b.mobDate || ''));
        if (!soon.length) return `<div class="panel">
          <h2>Mobilizing tomorrow</h2>
          <p class="muted">No job has a mobilization date on it yet. Put one on a job and its pre-mobilization list turns up here the day before it goes out.</p>
          <div class="row"><a class="btn-ghost" href="#/jobs">Put a date on a job</a></div>
        </div>`;
        return `<div class="panel">
          <h2>Mobilizing today and tomorrow</h2>
          <p class="muted">Walk each list the day before the gear goes out.</p>
          ${AM.why('This is the manual’s own pre-mobilization list, against the day the gear actually goes out. A crew cannot mobilize a job that is not finished here without overriding it, and an override lands on this screen with a name on it.')}
          ${soon.map(j => {
            const type3 = j.division !== 'restoration' && String(j.containment) === '3';
            const items = window.SOP.preMob.filter(i => i.appliesTo === 'all' || (i.appliesTo === 'type3' && type3));
            const done = items.filter(i => j.preMob && j.preMob[i.id]).length;
            const ready = done === items.length;
            return `<div class="find-row">
              <div><strong>${esc(jobLabel(j.id))}</strong>
                <div class="muted small">${j.mobDate === today ? 'goes out today' : 'goes out tomorrow'}${j.address ? ' · ' + esc(j.address) : ''}</div>
                ${ready ? '' : `<div class="fault">${items.filter(i => !(j.preMob && j.preMob[i.id])).map(i => esc(i.text)).join(' · ')}</div>`}</div>
              <div class="find-where ${ready ? '' : 'bad'}">${done} of ${items.length}
                <div class="row tight"><button class="btn-ghost jdetail" data-id="${esc(j.id)}">Walk the list</button></div></div>
            </div>`;
          }).join('')}
        </div>`;
      })()}

      ${d.overdue.length ? `<div class="panel">
        <div class="panel-head"><div><h2>Past its return date</h2>
        <p class="muted">Signed out with a date on it, and the date has gone. Absent is normal on a long job. Overdue is a phone call.</p></div></div>
        ${d.overdue.map(o => {
          const u = d.unitById.get(o.itemId) || {};
          return `<div class="find-row">
            <div><strong>${esc(u.name || o.itemId)} ${esc(u.unitNo || '')}</strong><span class="line-id">${esc(o.itemId)}</span></div>
            <div class="find-where bad">${esc(jobLabel(o.jobId))}
              <div class="muted small">due back ${esc(o.dueBack)} · out since ${esc(fmtWhen(o.since))}</div></div>
          </div>`;
        }).join('')}
      </div>` : ''}

      ${missing.length ? `<div class="panel">
        <div class="panel-head"><div><h2>Lost, someone has to chase these</h2>
        <p class="muted">Nothing leaves this list on its own. It is either found or written off.</p></div></div>
        ${(missing.length > 15 ? AM.groupFolds(missing, u => jobLabel((d.unitAt.get(u.id) || {}).jobId), lostRow) : missing.map(lostRow).join(''))}
      </div>` : ''}
      ${broken.length ? `<div class="panel">
        <h2>Out of service</h2>
        <p class="muted">Pulled by a crew with a note on what is wrong. None of these will load onto a job until somebody signs it back in on the Find screen.</p>
        ${broken.map(u => { const a = d.unitAt.get(u.id);
          const log = (d.repairLog.get(u.id) || []).filter(x => x.kind === 'note');
          return `<div class="find-row"><div><strong>${esc(u.name)} ${esc(u.unitNo || '')}</strong><span class="line-id">${esc(u.id)}</span>
            <div class="fault">${esc(a.note || 'no note')}</div>
            ${log.length ? `<div class="muted small">${log.map(x => esc(x.note)).join(' · ')}</div>` : ''}</div>
          <div class="find-where bad">since ${esc(fmtWhen(a.at))}<div class="muted small">${esc(a.by || '')}</div></div></div>`;
        }).join('')}
      </div>` : ''}

      <div class="panel">
        <h2>What just happened</h2>
        ${S.events.slice(-40).reverse().map(e => `<div class="ev-row">
          <span class="ev-t">${esc(fmtWhen(e.at))}</span>
          <span class="ev-w">${esc(e.by || '')}</span>
          <span class="ev-d">${esc(describe(e))}</span>
        </div>`).join('') || '<p class="muted">Nothing yet.</p>'}
      </div>
    </div>`;
  };

  AM.after['#/dash'] = function () {
    /* Pulled is a movement, not a tick. A request that the shop actually fills
       has to leave the shelf and land on the job, or the numbers say the poly
       is still in the rack while it is going out the door on a truck. Where the
       ask was free text and matched nothing on the shelf, there is nothing to
       move, so the office is told to put it out by hand. */
    $$('.req-fill').forEach(b => b.onclick = async () => {
      const d = AM.derive();
      const r = d.requests.find(x => x.id === b.dataset.id);
      await AM.record({ type: 'REQUEST_FILLED', requestId: b.dataset.id });
      if (r && r.itemId) {
        await AM.record({
          type: 'ISSUE', itemId: r.itemId, jobId: r.jobId,
          qty: r.qty || 1, scanned: false, fromRequest: r.id
        });
        AM.toast('Pulled and put on ' + jobLabel(r.jobId) + '. The shelf and the job both moved.');
      } else {
        AM.toast('Marked as pulled. This one was typed in words, so mobilize it onto the job by hand.', 'warn');
      }
    });

    /* Anything that shipped with the app and is not in this shop's list yet.
       It sits on Today rather than in settings, because settings is a screen
       nobody opens on a Tuesday and a missing material is felt at the shelf. */
    (async () => {
      const box = $('#seedNudge');
      if (!box) return;
      try {
        const seed = window.AM_SEED || await (await fetch('seed.json', { cache: 'no-store' })).json();
        const addU = seed.units.filter(u => !S.catalog.units.some(x => x.id === u.id));
        const addS = seed.stock.filter(u => !S.catalog.stock.some(x => String(x.id) === String(u.id)));
        if (!addU.length && !addS.length) return;
        box.hidden = false;
        $('#seedNudgeH').textContent =
          `${addS.length ? addS.length + ' shelf item' + (addS.length === 1 ? '' : 's') : ''}${addS.length && addU.length ? ' and ' : ''}${addU.length ? addU.length + ' machine' + (addU.length === 1 ? '' : 's') : ''} not in your list yet`;
        $('#seedNudgeGo').onclick = async () => {
          S.catalog.units.push(...addU);
          S.catalog.stock.push(...addS);
          await AM.saveCatalog();
          AM.toast(`Added ${addU.length} machine${addU.length === 1 ? '' : 's'} and ${addS.length} shelf item${addS.length === 1 ? '' : 's'}.`);
          AM.render();
        };
      } catch (e) { /* offline: it will ask again next time */ }
    })();

    /* Walking the pre-mobilization list from Today opens that job where the
       list lives, rather than growing a second copy of it here. */
    $$('#view .jdetail').forEach(b => b.onclick = () => { jobOpen = b.dataset.id; AM.go('#/jobs'); });

    /* Chasing a lost machine, from the office. Same two answers as the crew
       screen: it turned up, or here is what was tried. */
    $$('.lchase').forEach(b => b.onclick = () => AM.foundModal(b.dataset.id));

    /* Writing one off is a decision with a number on it, so it asks for a
       reason and it says the number out loud before it takes it off the fleet. */
    $$('.lwrite').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      const u = AM.derive().unitById.get(id) || {};
      AM.modal(`
        <h3>Write off ${esc(u.name || id)} ${esc(u.unitNo || '')}</h3>
        <p class="muted small">It comes off the fleet and off the shop count${u.cost ? ', at a book value of ' + money(u.cost) : ''}. It stays in the history, and this is the line the insurer reads.</p>
        <label class="fld">Why<input id="woNote" placeholder="never turned up after the Whyte Ave job" autocomplete="off"></label>
        <div class="row"><button class="btn big" id="woGo">Write it off</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
      `, el => {
        $('#woGo', el).onclick = async () => {
          const n = $('#woNote', el).value.trim();
          if (!n) { $('#woNote', el).focus(); return; }
          await AM.record({ type: 'WRITEOFF', itemId: id, note: n });
          AM.closeModal();
          AM.toast('Written off and off the fleet.', 'warn');
        };
        setTimeout(() => $('#woNote', el).focus(), 60);
      });
    });
  };

  function describe(e) {
    const d = AM.derive();
    const nm = id => {
      const u = d.unitById.get(id); if (u) return `${u.name} ${u.unitNo || ''} (${id})`.trim();
      const s = d.stockById.get(id); if (s) return s.name;
      return id || '';
    };
    switch (e.type) {
      case 'ISSUE': return `took ${qty(e.qty)} ${nm(e.itemId)} to ${jobLabel(e.jobId)}${e.scanned ? '' : ' (typed in)'}`;
      case 'RETURN': return `brought back ${qty(e.qty)} ${nm(e.itemId)} from ${jobLabel(e.jobId)}`;
      case 'TRANSFER': return `moved ${nm(e.itemId)} from ${jobLabel(e.fromJobId)} to ${jobLabel(e.toJobId)}`;
      case 'CONSUME': return `used up ${qty(e.qty)} ${nm(e.itemId)} on ${jobLabel(e.jobId)}${e.reason ? ' · ' + e.reason : ''}`;
      case 'MISSING': return `could not find ${nm(e.itemId)} on ${jobLabel(e.jobId)}${e.note ? ' · last seen ' + e.note : ''}`;
      case 'LOST_NOTE': return `chased ${nm(e.itemId)}: ${e.note || ''}`;
      case 'FOUND': return `found ${nm(e.itemId)}${e.note ? ' · ' + e.note : ''}`;
      case 'WRITEOFF': return `wrote off ${nm(e.itemId)} · ${e.note || ''}`;
      case 'WASTE': return `logged ${e.bags || 0} bags${e.trailers ? ' and ' + qty(e.trailers) + ' trailer loads' : ''} of ${e.stream === 'clean' ? 'clean demolition' : 'asbestos'} waste off ${jobLabel(e.jobId)}`;
      case 'REPAIR': return `put ${nm(e.itemId)} out of service: ${e.note || 'no note'}`;
      case 'REPAIR_NOTE': return `added a note on ${nm(e.itemId)}: ${e.note || ''}`;
      case 'FIXED': return `put ${nm(e.itemId)} back in service${e.note ? ' · ' + e.note : ''}`;
      case 'COUNT': return `counted ${qty(e.qty)} ${nm(e.itemId)}`;
      case 'RECEIVE': return `received ${qty(e.qty)} ${nm(e.itemId)}`;
      case 'DOP': return `${e.result === 'pass' ? 'passed' : 'FAILED'} the test on ${nm(e.itemId)}${e.cert ? ' · cert ' + e.cert : ''}`;
      case 'FILTER': return `changed the filter on ${nm(e.itemId)}`;
      case 'REQUEST': return `asked the shop for ${e.text} for ${jobLabel(e.jobId)}${e.afterTwo ? ' (after two)' : ''}`;
      case 'REQUEST_FILLED': return `pulled a request`;
      case 'DEMOB': return `finished the demob on ${jobLabel(e.jobId)}`;
      case 'PREMOB_OVERRIDE': return `mobilized ${jobLabel(e.jobId)} without the pre-mobilization list: ${e.note || ''}`;
      default: return e.type;
    }
  }

  /* --------------------------------------------------------------- shelf --- */

  AM.screens['#/shelf'] = function () {
    const d = AM.derive();
    const groups = [...new Set(S.catalog.stock.map(s => s.group))];
    return `
    <div class="wrap wide">
      <div class="panel">
        <div class="panel-head">
          <div><h2>The shelf</h2>
          <p class="muted">Count what is there, set a minimum, and the app tells you when it runs low.</p></div>
          <input id="shq" class="search" placeholder="Filter" autocomplete="off">
        </div>
        ${AM.why('Two different things happen on this screen. Counting is somebody standing at the shelf saying what is there, and it replaces the number. Arrived is stock coming in off an order, and it adds to it. Never retype a count to record a delivery: the difference between what was bought and what is there is what tells you whether anything is walking. The minimum is meant to be moved: buffer it when it is busy, tighten it when it is slow.')}

        <!-- What you can do to this list belongs on this list. Burying add,
             download and stickers behind Settings meant people stood in front
             of the shelf unable to find any of the three. -->
        <div class="row list-acts">
          <button class="btn-ghost" id="shAll">Open every group</button>
          <button class="btn" id="shDl">Download this list</button>
          <a class="btn-ghost" href="#/sheet">Bring a filled-in sheet back in</a>
          <a class="btn-ghost" href="#/add">Add a material</a>
          <a class="btn-ghost" href="#/labels?kind=shelf&from=shelf">Print the shelf stickers</a>
        </div>
        <!-- Every group shut to start with. Two hundred rows down one page is
             a wall, and the thing anybody came here for is somewhere in the
             middle of it. The group heading carries how many lines are in it
             and how many of those still have no count, so the shelf can be
             read without opening anything. -->
        ${groups.map(g => {
          const vOpts = v => `<option value="">not set</option>` +
            vendorList().map(x => `<option value="${esc(x.id)}" ${v === x.id ? 'selected' : ''}>${esc(x.name)}</option>`).join('');
          const inG = S.catalog.stock.filter(s => s.group === g);
          const todo = inG.filter(s => d.onHand.get(s.id) == null).length;
          const lows = inG.filter(s => s.min != null && d.onHand.get(s.id) != null && d.onHand.get(s.id) <= s.min).length;
          return `
          <details class="grp-fold" data-g="${esc(g)}">
          <summary>
            <span class="grp">${esc(g)}</span>
            <span class="grp-tally">${inG.length} line${inG.length === 1 ? '' : 's'}${todo ? ' · <b class="warn-text">' + todo + ' not counted</b>' : ''}${lows ? ' · <b class="bad-text">' + lows + ' low</b>' : ''}</span>
          </summary>
          <div class="grp-head">
            ${vendorList().length ? `<label class="grp-bulk">Set every one of these to
              <select class="bulk-vendor" data-g="${esc(g)}">${vOpts('')}</select></label>` : ''}
          </div>
          <table class="tbl shelf-tbl"><thead><tr>
            <th>Item</th><th>Unit</th><th class="n">On hand</th><th></th><th class="n">Min</th><th class="n">Max</th><th class="n">Last paid</th><th>Bought from</th><th>Part rolls come back</th>
          </tr></thead><tbody>
          ${S.catalog.stock.filter(s => s.group === g).map(s => {
            const n = d.onHand.get(s.id);
            const lowFlag = s.min != null && n != null && n <= s.min;
            return `<tr data-name="${esc((s.name + ' ' + s.id).toLowerCase())}" class="${lowFlag ? 'low' : ''}">
              <td><strong>${esc(s.name)}</strong><div class="line-id">${esc(s.id)}</div></td>
              <td>${esc(s.uom || 'EA')}</td>
              <td class="n"><input class="cell" data-f="onHand" data-id="${esc(s.id)}" type="number" step="0.25" value="${n == null ? '' : n}" placeholder="count"></td>
              <td><button class="btn-ghost recv" data-id="${esc(s.id)}">Arrived</button></td>
              <td class="n"><input class="cell" data-f="min" data-id="${esc(s.id)}" type="number" step="1" value="${s.min == null ? '' : s.min}"></td>
              <td class="n"><input class="cell" data-f="max" data-id="${esc(s.id)}" type="number" step="1" value="${s.max == null ? '' : s.max}"></td>
              <td class="n">${s.price != null ? money(s.price) : '<span class="muted">—</span>'}</td>
              <td>${vendorList().length
                ? `<select class="cell-v" data-id="${esc(s.id)}">${vOpts(s.vendorId)}</select>`
                : `<span class="muted small">${esc(s.vendor || '—')}</span>`}</td>
              <td class="small">${s.increments && s.increments.length ? s.increments.map(f => f === 1 ? 'full' : (f * 100) + '%').join(', ') : '<span class="muted">used up, nothing comes back</span>'}</td>
            </tr>`;
          }).join('')}
          </tbody></table></details>`;
        }).join('')}
      </div>
    </div>`;
  };

  /* One download, used from both the shelf and the spreadsheet screen, so the
     two can never drift into producing different files. */
  function downloadSheet() {
    const blob = new Blob(['﻿' + sheetCSV()], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'A&M shelf ' + AM.dayISO() + '.csv';
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
    AM.toast('Downloaded. Open it in Excel.');
  }

  AM.after['#/shelf'] = function () {
    const dl = $('#shDl'); if (dl) dl.onclick = downloadSheet;
    $$('.recv').forEach(b => b.onclick = () => receiveModal(b.dataset.id));
    $$('.cell').forEach(inp => inp.onchange = async () => {
      const id = inp.dataset.id, f = inp.dataset.f;
      const v = inp.value === '' ? null : parseFloat(inp.value);
      const s = S.catalog.stock.find(x => x.id === id);
      if (!s) return;
      if (f === 'onHand') {
        // A count is somebody standing in front of the shelf, so it is recorded
        // as a fact with a name on it rather than a quiet edit.
        if (v == null) return;
        await AM.record({ type: 'COUNT', itemId: id, qty: v });
        AM.toast('Counted');
        return;
      }
      s[f] = v;
      await AM.saveCatalog();
    });
    $$('.cell-v').forEach(sel => sel.onchange = async () => {
      const s = S.catalog.stock.find(x => x.id === sel.dataset.id);
      if (!s) return;
      s.vendorId = sel.value || null;
      await AM.saveCatalog();
    });

    // Sixty four items one at a time is how a good idea dies. A shelf group is
    // almost always bought from one place, so set the lot.
    $$('.bulk-vendor').forEach(sel => sel.onchange = async () => {
      if (!sel.value) return;
      const g = sel.dataset.g;
      const v = vendorList().find(x => x.id === sel.value);
      const hit = S.catalog.stock.filter(s => s.group === g);
      hit.forEach(s => { s.vendorId = sel.value; });
      await AM.saveCatalog();
      AM.toast(`${hit.length} item${hit.length === 1 ? '' : 's'} now bought from ${v ? v.name : 'that vendor'}`);
      AM.render();
    });

    /* Typing in the filter box has to open the groups it found something in,
       or the screen looks like it found nothing. Clearing the box shuts them
       again and puts the screen back the way it starts. */
    const q = $('#shq');
    if (q) q.oninput = e => {
      const t = e.target.value.trim().toLowerCase();
      $$('tr[data-name]').forEach(tr => { tr.style.display = !t || tr.dataset.name.includes(t) ? '' : 'none'; });
      $$('.grp-fold').forEach(f => {
        if (!t) { f.open = false; f.style.display = ''; return; }
        const hits = [...f.querySelectorAll('tr[data-name]')].filter(tr => tr.style.display !== 'none').length;
        f.style.display = hits ? '' : 'none';
        f.open = hits > 0;
      });
    };

    const all = $('#shAll');
    if (all) all.onclick = () => {
      const folds = $$('.grp-fold');
      const anyShut = folds.some(f => !f.open);
      folds.forEach(f => { f.open = anyShut; });
      all.textContent = anyShut ? 'Close every group' : 'Open every group';
    };
  };

  /* ----------------------------------------------------------- equipment ---
     The fleet, as its own screen. Until now the only list of machines anywhere
     was the crew's Find screen, which is built for answering "where is that
     one" on a phone, not for working down 548 of them at a desk. */

  AM.screens['#/gear'] = function () {
    const d = AM.derive();
    const groups = [...new Set(S.catalog.units.map(u => u.group))].sort();
    const noSerial = S.catalog.units.filter(u => !u.serial).length;
    const where = u => {
      const a = d.unitAt.get(u.id);
      if (!a || a.where === 'shop') return { t: 'Shop', c: '' };
      if (a.where === 'job') return { t: jobLabel(a.jobId), c: '' };
      if (a.where === 'repair') return { t: 'Out of service', c: 'warn' };
      if (a.where === 'missing') return { t: 'Lost', c: 'bad' };
      return { t: 'Written off', c: 'bad' };
    };
    return `
    <div class="wrap wide">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Equipment</h2>
          <p class="muted">Every machine the shop owns, what its serial is, and where it is right now.</p></div>
          <input id="gq" class="search" placeholder="Filter" autocomplete="off">
        </div>
        ${noSerial ? `<p class="clear-note"><b class="warn-text">${noSerial}</b> ${noSerial === 1 ? 'machine has' : 'machines have'} no serial number on file. Filling those in is the one job on this screen worth doing in Excel rather than here.</p>` : ''}
        <div class="row list-acts">
          <button class="btn-ghost" id="gAll">Open every group</button>
          <button class="btn" id="gDl">Download this list</button>
          <a class="btn-ghost" href="#/sheet">Bring a filled-in sheet back in</a>
          <a class="btn-ghost" href="#/add">Add a machine</a>
          <a class="btn-ghost" href="#/labels?kind=unit&from=gear">Print machine stickers</a>
        </div>

        ${groups.map(g => {
          const inG = S.catalog.units.filter(u => u.group === g);
          const missing = inG.filter(u => !u.serial).length;
          return `<details class="grp-fold">
            <summary><span class="grp">${esc(g)}</span>
              <span class="grp-tally">${inG.length} machine${inG.length === 1 ? '' : 's'}${missing ? ' · <b class="warn-text">' + missing + ' with no serial</b>' : ''}</span>
            </summary>
            <table class="tbl"><thead><tr>
              <th>Machine</th><th>Unit</th><th>Serial</th><th>Make and model</th><th>Where</th><th></th>
            </tr></thead><tbody>
            ${inG.map(u => {
              const w = where(u);
              return `<tr data-name="${esc((u.name + ' ' + (u.unitNo || '') + ' ' + u.id + ' ' + (u.serial || '') + ' ' + (u.model || '')).toLowerCase())}">
                <td><strong>${esc(u.name)}</strong><div class="line-id">${esc(u.id)}</div></td>
                <td class="small">${esc(u.unitNo || '—')}</td>
                <td class="small ${u.serial ? '' : 'warn-text'}">${esc(u.serial || 'not on file')}</td>
                <td class="small">${esc(u.model || '—')}</td>
                <td class="small ${w.c}">${esc(w.t)}</td>
                <td><a class="btn-ghost" href="#/labels?ids=${encodeURIComponent(u.id)}&kind=unit&from=gear">Sticker</a></td>
              </tr>`;
            }).join('')}
            </tbody></table>
          </details>`;
        }).join('')}
      </div>
    </div>`;
  };

  AM.after['#/gear'] = function () {
    const dl = $('#gDl'); if (dl) dl.onclick = () => {
      const blob = new Blob(['﻿' + gearCSV()], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'A&M equipment ' + AM.dayISO() + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      AM.toast('Downloaded. Open it in Excel.');
    };
    const all = $('#gAll');
    if (all) all.onclick = () => {
      const folds = $$('.grp-fold');
      const anyShut = folds.some(f => !f.open);
      folds.forEach(f => { f.open = anyShut; });
      all.textContent = anyShut ? 'Close every group' : 'Open every group';
    };
    const q = $('#gq');
    if (q) q.oninput = e => {
      const t = e.target.value.trim().toLowerCase();
      $$('tr[data-name]').forEach(tr => { tr.style.display = !t || tr.dataset.name.includes(t) ? '' : 'none'; });
      $$('.grp-fold').forEach(f => {
        if (!t) { f.open = false; f.style.display = ''; return; }
        const hits = [...f.querySelectorAll('tr[data-name]')].filter(tr => tr.style.display !== 'none').length;
        f.style.display = hits ? '' : 'none';
        f.open = hits > 0;
      });
    };
  };

  /* ---------------------------------------------------------------- jobs --- */

  /* Ninety jobs open at once is a normal week here. Ninety full panels down one
     page is not a screen anybody can use, so this is a list you can run your eye
     down, and a job opens where it sits when you want the detail on it. */
  let jobQuery = '';
  let jobOpen = null;
  let jobsShowClosed = false;

  AM.screens['#/jobs'] = function () {
    const d = AM.derive();
    let jobs = (S.catalog.jobs || []).slice().sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    const closedCount = jobs.filter(j => j.closed).length;
    if (!jobsShowClosed) jobs = jobs.filter(j => !j.closed);
    const t = jobQuery.trim().toLowerCase();
    if (t) jobs = jobs.filter(j => ((j.number || '') + ' ' + j.name + ' ' + (j.address || '')).toLowerCase().includes(t));

    return `
    <div class="wrap wide">
      <div class="panel">
        <div class="panel-head">
          <div><h2>Jobs</h2>
          <p class="muted">Tap a job to see what went out against it, what came back, what it used, how that compares to the estimate, and the cost summary.</p></div>
          <button class="btn" id="jShowClosed">${jobsShowClosed ? 'Hide finished jobs' : `Past jobs (${closedCount} finished)`}</button>
        </div>
        <input id="jq" class="search" placeholder="Job number, street or name" value="${esc(jobQuery)}" autocomplete="off">
        <div class="muted small pad-y">${jobs.length} job${jobs.length === 1 ? '' : 's'}${t ? ' matching' : jobsShowClosed ? ', open and finished' : ' open'}. A finished job keeps everything, so it can be looked up long after it was closed.</div>
        ${jobs.length ? jobs.map(j => {
          const still = (d.outstanding.get(j.id) || []).length;
          const ph = window.SOP.phase(j.division, j.phase);
          const open = jobOpen === j.id;
          return `<div class="job-fold ${open ? 'open' : ''}">
            <button class="job-head" data-id="${esc(j.id)}">
              <div><strong>${esc(jobLabel(j.id))}</strong>
                <div class="muted small">${esc(j.address || '')}${ph ? ' · ' + esc(ph.name) : ''}${j.closed ? ' · closed' : ''}</div></div>
              <div class="job-count ${still ? 'has' : ''}">${still ? still + ' out' : 'clear'}</div>
            </button>
            ${open ? jobPanel(j, d) : ''}
          </div>`;
        }).join('') : '<p class="muted">Nothing matches that.</p>'}
      </div>
    </div>`;
  };

  /* Matching an estimator's words to a shelf item. Deliberately shy: a wrong
     match puts the wrong material on a van, while no match just leaves a line
     of words that a human reads perfectly well. */
  const STOPW = new Set(['the', 'and', 'of', 'for', 'with', 'ea', 'each', 'box', 'case', 'pk', 'pack', 'per']);
  const wordsOf = t => new Set(String(t || '').toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(x => x && !STOPW.has(x)));
  function matchShelf(name) {
    const a = wordsOf(name);
    if (!a.size) return null;
    let best = null, score = 0;
    for (const s of S.catalog.stock) {
      const b = wordsOf(s.name + ' ' + (s.group || ''));
      let inter = 0;
      a.forEach(w => { if (b.has(w)) inter++; });
      if (!inter) continue;
      const sc = inter / new Set([...a, ...b]).size;
      if (sc > score) { score = sc; best = s; }
    }
    return score >= 0.5 ? best.id : null;
  }
  AM.matchShelf = matchShelf;

  function jobPanel(j, d) {
    const rows = [...(d.jobLoad.get(j.id) || new Map()).values()];
    const still = (d.outstanding.get(j.id) || []).length;
    const w = d.waste.get(j.id) || { bags: 0, trailers: 0 };
    const asb = w.asbestos || { bags: w.bags, trailers: w.trailers };
    const cln = w.clean || { bags: 0, trailers: 0 };
    const bagsPerBin = (S.catalog.settings && S.catalog.settings.bagsPerBin) || 600;
    const ph = window.SOP.phase(j.division, j.phase);
    const cont = window.SOP.containment[String(j.containment)];
    const type3 = j.division !== 'restoration' && String(j.containment) === '3';

    let material = 0, equipmentDays = 0;
    const unitsOnJob = [];
    for (const l of rows) {
      const s = d.stockById.get(l.id);
      if (s) { const used = l.out - l.back; if (used > 0 && s.price) material += used * s.price; }
    }
    // Equipment days: every deployment on this job, counted from when it landed.
    for (const u of S.catalog.units) {
      const a = d.unitAt.get(u.id);
      if (a && a.jobId === j.id && a.where === 'job') {
        equipmentDays += Math.max(1, AM.daysBetween(a.at, new Date()));
        unitsOnJob.push(u);
      }
    }
    const dopOwed = window.SOP.dopOwed(j, unitsOnJob, S.catalog.settings || {});

    // The manual's own pre-mobilization checklist, and how much of it is true.
    const pmItems = window.SOP.preMob.filter(i => i.appliesTo === 'all' || (i.appliesTo === 'type3' && type3));
    const pmDone = pmItems.filter(i => j.preMob && j.preMob[i.id]).length;

    return `<div class="job-panel ${still ? 'open' : ''}">
      <div class="panel-head">
        <div><h3>${esc(jobLabel(j.id))} ${j.jobtreadId ? '<span class="tag ok">linked</span>' : '<span class="tag warn">not in JobTread yet</span>'}</h3>
        <div class="muted small">${esc(j.address || '')} · started ${esc(fmtWhen(j.createdAt))}</div>
        <div class="muted small">${ph ? esc(ph.id + ' ' + ph.name) : 'no phase set'}${cont && j.division !== 'restoration' ? ' · ' + esc(cont.name) : ''}${j.division === 'restoration' ? ' · restoration' : ''}${j.areaSqFt ? ' · ' + esc(String(j.areaSqFt)) + ' sq ft' : ''}</div>
        <div class="muted small">${j.mobDate ? 'Mobilizing ' + esc(j.mobDate) + ' · ' : ''}Before it left the shop: ${pmDone} of ${pmItems.length} confirmed${pmDone < pmItems.length ? ', <span class="bad">' + (pmItems.length - pmDone) + ' not</span>' : ''}${j.expectedReturn ? ' · gear due back ' + esc(j.expectedReturn) : ''}</div>
        </div>
        <div class="job-cost">
          <div><b>${money(material)}</b><span>material used</span></div>
          <div><b>${equipmentDays}</b><span>equipment days running</span></div>
          ${dopOwed.units ? `<div><b>${money(dopOwed.cost)}</b><span>${dopOwed.units} certificate${dopOwed.units === 1 ? '' : 's'}${dopOwed.rounds > 1 ? ', two rounds' : ''}</span></div>` : ''}
          ${w.bags ? `<div><b>${w.bags}</b><span>bags · ${Math.round(w.bags / bagsPerBin * 100)}% of a bin</span></div>` : ''}
        </div>
      </div>
      ${dopOwed.rounds > 1 ? `<p class="muted small">${esc(dopOwed.note)}</p>` : ''}
      ${rows.length ? `<h4 class="grp">Return list against the Mobilization List</h4>
      <table class="tbl"><thead><tr><th>Item</th><th class="n">Out</th><th class="n">Back</th><th class="n">Used up</th><th class="n">Still out</th><th class="n">Typed in</th></tr></thead><tbody>
        ${rows.map(l => {
          const nm = d.unitById.get(l.id) ? `${d.unitById.get(l.id).name} ${d.unitById.get(l.id).unitNo || ''}` : (d.stockById.get(l.id) || {}).name || l.id;
          const stillOut = l.out - l.back - l.consumed;
          return `<tr class="${stillOut > 0.001 ? 'low' : ''}"><td><strong>${esc(nm)}</strong><div class="line-id">${esc(l.id)}</div></td>
            <td class="n">${qty(l.out)}</td><td class="n">${qty(l.back)}</td><td class="n">${qty(l.consumed)}</td>
            <td class="n ${stillOut > 0.001 ? 'bad' : ''}">${qty(Math.max(0, stillOut))}</td>
            <td class="n">${l.unscanned ? qty(l.unscanned) : ''}</td></tr>`;
        }).join('')}
      </tbody></table>` : '<p class="muted small">Nothing has gone out on this job yet.</p>'}

      ${j.pullList && j.pullList.length ? `<h4 class="grp">What the estimate said this job needs</h4>
      <p class="muted small">Read off the JobTread estimate${j.pullFrom ? ' (' + esc(j.pullFrom) + ')' : ''}${j.pullAt ? ', ' + esc(fmtWhen(j.pullAt)) : ''}. Lines matched to the shelf are counted against what actually went out. Lines that matched nothing are still shown, because a crew can read them.</p>
      <table class="tbl"><thead><tr><th>On the estimate</th><th class="n">Priced</th><th>On the shelf as</th><th class="n">Actually went out</th></tr></thead><tbody>
        ${j.pullList.map(l => {
          const line = l.itemId ? (d.jobLoad.get(j.id) || new Map()).get(l.itemId) : null;
          const went = line ? line.out : 0;
          const short = l.itemId && went + 0.001 < (l.qty || 0);
          return `<tr class="${short ? 'low' : ''}">
            <td><strong>${esc(l.name)}</strong></td>
            <td class="n">${qty(l.qty || 0)}${l.uom ? ' ' + esc(l.uom) : ''}</td>
            <td class="small">${l.itemId ? esc((d.stockById.get(l.itemId) || {}).name || l.itemId) : '<span class="muted">nothing matched</span>'}</td>
            <td class="n ${short ? 'bad' : ''}">${l.itemId ? qty(went) : ''}</td></tr>`;
        }).join('')}
      </tbody></table>` : ''}

      <h4 class="grp">Final cost summary, the part inventory owns</h4>
      <table class="tbl"><tbody>
        <tr><td>Materials consumed</td><td class="n">${money(material)}</td></tr>
        <tr><td>Equipment, ${equipmentDays} unit day${equipmentDays === 1 ? '' : 's'} on site</td><td class="n">${equipmentDays ? 'days recorded' : '—'}</td></tr>
        <tr><td>Certificate testing, ${dopOwed.units} unit${dopOwed.units === 1 ? '' : 's'}${dopOwed.rounds > 1 ? ' × 2 rounds' : ''}</td><td class="n">${money(dopOwed.cost)}</td></tr>
        <tr><td>Disposal, asbestos: ${asb.bags} bag${asb.bags === 1 ? '' : 's'}${asb.trailers ? ' and ' + qty(asb.trailers) + ' trailer loads' : ''}</td><td class="n">${asb.bags ? Math.round(asb.bags / bagsPerBin * 100) + '% of a bin' : '—'}</td></tr>
        <tr><td>Disposal, clean demolition: ${cln.bags} bag${cln.bags === 1 ? '' : 's'}${cln.trailers ? ' and ' + qty(cln.trailers) + ' trailer loads' : ''}</td><td class="n">${cln.bags || cln.trailers ? 'charged at the clean rate' : '—'}</td></tr>
        <tr><td class="muted">Labour</td><td class="n muted">comes from elsewhere</td></tr>
      </tbody></table>
      <p class="muted small">The manual's close-out package wants waste disposal manifests and a final cost summary showing labour, materials, equipment and disposal. Three of those four are above.</p>

      <div class="row">
        <button class="btn-ghost jclose" data-id="${esc(j.id)}" ${still ? 'disabled title="Something is still on this job"' : ''}>${j.closed ? 'Reopen' : 'Close the job'}</button>
        ${still ? `<span class="muted small">${still} thing${still === 1 ? '' : 's'} still out. A job does not close with company gear standing on it.</span>` : ''}
        ${!j.jobtreadId ? `<button class="btn-ghost jlink" data-id="${esc(j.id)}">Match it to a JobTread job</button>` : ''}
        ${j.jobtreadId ? `<button class="btn-ghost jest" data-id="${esc(j.id)}">${j.pullList ? 'Read the estimate again' : 'Pull the estimate from JobTread'}</button>` : ''}
        <button class="btn-ghost jphase" data-id="${esc(j.id)}">Move the phase</button>
        <button class="btn-ghost jdetail" data-id="${esc(j.id)}">Job detail and the pre-mob list</button>
      </div>
    </div>`;
  }

  AM.after['#/jobs'] = function () {
    $$('.jclose').forEach(b => b.onclick = async () => {
      const j = S.catalog.jobs.find(x => x.id === b.dataset.id);
      if (!j) return;
      j.closed = !j.closed;
      await AM.saveCatalog();
      AM.render();
    });
    $$('.jlink').forEach(b => b.onclick = () => AM.go('#/link'));

    /* Reading the estimate. Every line the estimator priced is matched against
       the shelf by name, and anything the match is not sure about is left as
       words rather than pointed at the wrong material. A crew can read words. */
    $$('.jest').forEach(b => b.onclick = async () => {
      const j = S.catalog.jobs.find(x => x.id === b.dataset.id);
      if (!j || !j.jobtreadId) return;
      b.disabled = true; b.textContent = 'Asking JobTread…';
      try {
        const r = await fetch('/api/jobtread', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'documents', jobtreadJobId: j.jobtreadId })
        });
        const res = await r.json();
        if (res.error) throw new Error(res.error);
        const docs = (res.documents || []).filter(d => d.lines && d.lines.length);
        if (!docs.length) { AM.toast('That job has no priced document on it in JobTread.', 'warn'); b.disabled = false; b.textContent = 'Pull the estimate from JobTread'; return; }
        AM.modal(`
          <h3>Which document</h3>
          <p class="muted small">JobTread's own words for these vary, so pick the one the estimator built.</p>
          <div class="pl-list">${docs.map(d => `<button class="pl-row" data-id="${esc(d.id)}">
            <span>${esc(d.name || d.type || 'document')}</span>
            <span class="line-id">${esc(d.type || '')} · ${d.lines.length} lines</span></button>`).join('')}</div>
          <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
        `, el => {
          $$('.pl-row', el).forEach(x => x.onclick = async () => {
            const doc = docs.find(dd => dd.id === x.dataset.id);
            j.pullList = doc.lines.map(l => ({ name: l.name, qty: l.qty, uom: l.uom, itemId: matchShelf(l.name) }));
            j.pullFrom = doc.name || doc.type || '';
            j.pullAt = AM.nowISO();
            await AM.saveCatalog();
            AM.closeModal();
            const hit = j.pullList.filter(l => l.itemId).length;
            AM.toast(`${j.pullList.length} lines read, ${hit} matched to the shelf. The crew sees it when they mobilize.`);
            AM.render();
          });
        });
      } catch (e) {
        AM.toast('JobTread would not answer: ' + e.message, 'bad');
      }
      b.disabled = false;
    });

    /* Opening one closes the last, so the page never grows a second time. */
    $$('.job-head').forEach(b => b.onclick = () => {
      jobOpen = jobOpen === b.dataset.id ? null : b.dataset.id;
      AM.render();
      const el = document.querySelector('.job-fold.open');
      if (el) el.scrollIntoView({ block: 'nearest' });
    });
    const jq = $('#jq');
    if (jq) {
      jq.oninput = () => { jobQuery = jq.value; AM.render(); const f = $('#jq'); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } };
    }
    const jsc = $('#jShowClosed');
    if (jsc) jsc.onclick = () => { jobsShowClosed = !jobsShowClosed; AM.render(); };
    /* Everything the field is never asked for. Containment type, area, crew
       size, when the gear is due back, and the manual's own pre-mobilization
       checklist. Filled in here, by somebody at a desk who knows. */
    $$('.jdetail').forEach(b => b.onclick = () => {
      const j = S.catalog.jobs.find(x => x.id === b.dataset.id);
      if (!j) return;
      const rest = j.division === 'restoration';
      const type3 = !rest && String(j.containment) === '3';
      const items = window.SOP.preMob.filter(i => i.appliesTo === 'all' || (i.appliesTo === 'type3' && type3));

      AM.modal(`
        <h3>${esc(jobLabel(j.id))}</h3>
        <div class="grid2">
          ${rest ? `<label class="fld">Water category
            <select id="jdWater">${[1,2,3].map(n => `<option value="${n}" ${String(j.waterCategory)===String(n)?'selected':''}>Category ${n}</option>`).join('')}</select></label>`
          : `<label class="fld">Containment
            <select id="jdCont"><option value="">not set</option>
              ${Object.entries(window.SOP.containment).map(([k,v]) => `<option value="${k}" ${String(j.containment)===k?'selected':''}>${esc(v.name)}</option>`).join('')}
            </select></label>`}
          <label class="fld">Area, square feet<input id="jdArea" type="number" value="${j.areaSqFt || ''}"></label>
          <label class="fld">Crew size<input id="jdCrew" type="number" value="${j.crewSize || ''}"></label>
          <label class="fld">Mobilizing on<input id="jdMob" type="date" value="${esc(j.mobDate || '')}"></label>
          <label class="fld">Gear due back<input id="jdDue" type="date" value="${esc(j.expectedReturn || '')}"></label>
        </div>
        <h4 class="grp">Before it leaves the shop</h4>
        <p class="muted small">The manual's Phase 4 list, word for word. Ticked here, not by a crew standing in the shop at six in the morning.</p>
        <div class="chk-list">
          ${items.map(i => `<label class="chk"><input type="checkbox" class="jd-chk" data-id="${esc(i.id)}" ${j.preMob && j.preMob[i.id] ? 'checked' : ''}>
            <span><strong>${esc(i.text)}</strong>${i.note ? `<em class="muted small">${esc(i.note)}</em>` : ''}</span></label>`).join('')}
        </div>
        <div class="row"><button class="btn" id="jdGo">Save</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
      `, el => {
        $('#jdGo', el).onclick = async () => {
          if (rest) j.waterCategory = $('#jdWater', el).value;
          else j.containment = $('#jdCont', el).value || null;
          j.areaSqFt = parseFloat($('#jdArea', el).value) || null;
          j.crewSize = parseInt($('#jdCrew', el).value, 10) || null;
          j.expectedReturn = $('#jdDue', el).value || null;
          j.mobDate = $('#jdMob', el).value || null;
          j.preMob = j.preMob || {};
          $$('.jd-chk', el).forEach(c => {
            j.preMob[c.dataset.id] = c.checked ? { by: S.me, at: AM.nowISO() } : null;
          });
          await AM.saveCatalog();
          AM.closeModal(); AM.render();
        };
      });
    });

    $$('.jphase').forEach(b => b.onclick = () => {
      const j = S.catalog.jobs.find(x => x.id === b.dataset.id);
      if (!j) return;
      const phases = window.SOP.phasesFor(j.division);
      AM.modal(`<h3>Where is this job?</h3>
        <p class="muted small">Straight off A&amp;M's own manual. The phase decides who owes what next.</p>
        <div class="who-list">${phases.map(p => `<button class="who-pick ${p.id === j.phase ? 'on' : ''}" data-p="${esc(p.id)}">
          <strong>${esc(p.id)} ${esc(p.name)}</strong><div class="muted small">${esc(p.who)}</div></button>`).join('')}</div>`,
        el => $$('.who-pick', el).forEach(x => x.onclick = async () => {
          j.phase = x.dataset.p;
          await AM.saveCatalog();
          AM.closeModal(); AM.render();
        }));
    });
  };

  /* --------------------------------------------------------------- order --- */

  /* Stock arriving. It adds, and it carries what was paid, which is where the
     last paid price on the shelf comes from and what the order screen prices
     the next order at. */
  function receiveModal(id, after) {
    const s = S.catalog.stock.find(x => String(x.id) === String(id));
    if (!s) return;
    const d = AM.derive();
    const n = d.onHand.get(s.id);
    AM.modal(`
      <h3>${esc(s.name)}</h3>
      <p class="muted small">${esc(s.id)} · ${n == null ? 'never counted' : qty(n) + ' ' + esc(s.uom || '') + ' on the shelf now'}</p>
      <div class="grid2">
        <label class="fld">How many arrived<input id="rvQty" type="number" inputmode="decimal" step="0.25" placeholder="0"></label>
        <label class="fld">What each one cost<input id="rvCost" type="number" inputmode="decimal" step="0.01" value="${s.price != null ? s.price : ''}"></label>
      </div>
      <div class="row"><button class="btn big" id="rvGo">On the shelf</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
    `, el => {
      $('#rvGo', el).onclick = async () => {
        const q = parseFloat($('#rvQty', el).value);
        if (!isFinite(q) || q <= 0) { AM.toast('How many arrived?', 'warn'); return; }
        const c = parseFloat($('#rvCost', el).value);
        await AM.record({ type: 'RECEIVE', itemId: s.id, qty: q, unitCost: isFinite(c) ? c : undefined });
        if (isFinite(c)) { s.price = c; await AM.saveCatalog(); }
        AM.closeModal();
        AM.toast(`${qty(q)} ${s.uom || ''} on the shelf.`);
        if (after) after();
        AM.render();
      };
      setTimeout(() => $('#rvQty', el).focus(), 60);
    });
  }
  AM.receiveModal = receiveModal;

  AM.screens['#/order'] = function () {
    const low = belowMin();
    const byVendor = new Map();
    for (const s of low) {
      const v = vendorName(s);
      if (!byVendor.has(v)) byVendor.set(v, []);
      byVendor.get(v).push(s);
    }
    return `
    <div class="wrap wide">
      <div class="panel note">
        <h2>Nothing here sends itself</h2>
        <p>This screen drafts an order. It never places one. Somebody walks the shelf, confirms it with their own eyes, then sends it.</p>
      </div>
      ${low.length ? [...byVendor].map(([v, items]) => `
        <div class="panel">
          <div class="panel-head">
            <div><h2>${esc(v)}</h2><p class="muted">${items.length} line${items.length === 1 ? '' : 's'} below minimum</p></div>
            <button class="btn copy-po" data-v="${esc(v)}">Copy this order</button>
            <button class="btn-ghost arrived-po" data-v="${esc(v)}">It arrived</button>
          </div>
          <table class="tbl"><thead><tr><th>Item</th><th>Code</th><th class="n">On hand</th><th class="n">Order</th><th class="n">Last paid</th><th class="n">Roughly</th></tr></thead><tbody>
            ${items.map(s => {
              const want = Math.max(1, Math.ceil((s.max != null ? s.max : s.min * 2) - s.onHand));
              return `<tr><td><strong>${esc(s.name)}</strong></td><td class="line-id">${esc(s.id)}</td>
                <td class="n">${qty(s.onHand)}</td><td class="n"><strong>${want}</strong> ${esc(s.uom || '')}</td>
                <td class="n">${s.price != null ? money(s.price) : '—'}</td>
                <td class="n">${s.price != null ? money(want * s.price) : '—'}</td></tr>`;
            }).join('')}
          </tbody></table>
        </div>`).join('')
      : (() => {
          /* An empty screen has to say which empty it is, and carry the button
             that fixes it. "The minimums have not been set yet" with nowhere
             to go and set them is how a screen gets written off as broken. */
          const withMin = S.catalog.stock.filter(s => s.min != null).length;
          const total = S.catalog.stock.length;
          if (!withMin) return `<div class="panel">
            <h2>Nothing to order yet, because nothing has a minimum</h2>
            <p class="muted">None of the ${total} lines on the shelf has a reorder level against it, so the app has nothing to compare a count to. Setting them is an afternoon in Excel, once.</p>
            <div class="row"><a class="btn" href="#/sheet">Set the minimums in Excel</a>
            <a class="btn-ghost" href="#/shelf">Or do it on the shelf screen</a></div>
          </div>`;
          if (withMin < total) return `<div class="panel">
            <h2>Nothing is below minimum</h2>
            <p class="muted">Of ${total} lines on the shelf, ${withMin} have a reorder level against them. The other ${total - withMin} cannot go low, because nothing has told the app what low means for them.</p>
            <div class="row"><a class="btn-ghost" href="#/sheet">Set the rest in Excel</a></div>
          </div>`;
          return `<div class="panel"><p class="clear-note">Nothing is below minimum. The shelf is healthy.</p></div>`;
        })()}
    </div>`;
  };

  AM.after['#/order'] = function () {
    /* The whole delivery in one go, with what was actually sent rather than
       what was asked for, because those are not the same often enough to
       matter. */
    $$('.arrived-po').forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      const items = belowMin().filter(x => vendorName(x) === v);
      AM.modal(`
        <h3>What arrived from ${esc(v)}</h3>
        <p class="muted small">Set anything that came short or came over. Leave a line at zero and it is not counted as arrived.</p>
        <table class="tbl"><thead><tr><th>Item</th><th class="n">Ordered</th><th class="n">Arrived</th></tr></thead><tbody>
          ${items.map(x => {
            const want = Math.max(1, Math.ceil((x.max != null ? x.max : x.min * 2) - x.onHand));
            return `<tr><td>${esc(x.name)}</td><td class="n">${want}</td>
              <td class="n"><input class="cell arv" data-id="${esc(x.id)}" type="number" step="0.25" value="${want}"></td></tr>`;
          }).join('')}
        </tbody></table>
        <div class="row"><button class="btn big" id="arvGo">Put it on the shelf</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
      `, el => {
        $('#arvGo', el).onclick = async () => {
          let n = 0;
          for (const inp of $$('.arv', el)) {
            const q = parseFloat(inp.value);
            if (!isFinite(q) || q <= 0) continue;
            await AM.record({ type: 'RECEIVE', itemId: inp.dataset.id, qty: q });
            n++;
          }
          AM.closeModal();
          AM.toast(n ? `${n} line${n === 1 ? '' : 's'} on the shelf.` : 'Nothing was marked as arrived.', n ? 'ok' : 'warn');
          AM.render();
        };
      });
    });
    $$('.copy-po').forEach(b => b.onclick = () => {
      const v = b.dataset.v;
      const items = belowMin().filter(s => vendorName(s) === v);
      const lines = items.map(s => {
        const want = Math.max(1, Math.ceil((s.max != null ? s.max : s.min * 2) - s.onHand));
        return `${want} ${s.uom || 'EA'}\t${s.name}\t${s.id}`;
      });
      const text = `A&M Abatement Services\nOrder draft, ${AM.dayISO()}\nVendor: ${v}\nNot yet approved.\n\n` + lines.join('\n');
      navigator.clipboard.writeText(text).then(
        () => AM.toast('Copied. Paste it into the email, check it, then send.'),
        () => AM.toast('Could not copy on this device.', 'bad')
      );
    });
  };

  /* -------------------------------------------------------- certificates --- */

  AM.screens['#/dop'] = function () {
    const units = S.catalog.units.filter(u => u.dop);
    const rows = units.map(u => ({ u, st: AM.dopState(u.id) }));
    const order = { fail: 0, none: 1, overdue: 2, due: 3, ok: 4 };
    rows.sort((a, b) => order[a.st.state] - order[b.st.state]);

    return `
    <div class="wrap wide">
      <div class="panel">
        <div class="panel-head"><div>
          <h2>${rows.filter(r => r.st.state !== 'ok').length} machines need a certificate</h2>
          <p class="muted">Out of ${units.length} that are subject to the test. Worst first.</p></div>
          <input id="dopq" class="search" placeholder="Filter" autocomplete="off">
        </div>
        ${AM.why('Alberta wants a DOP or PAO test on a HEPA vacuum or a negative air unit at least every 30 days while it is running, at least once a year while it is sitting, whenever a filter is changed, and on site before a negative air system starts filtering. Nothing sold as inventory software keeps this register. A failed unit cannot be checked out of here without somebody deliberately overriding it.')}

        <!-- 85 rows down one page is unreadable, and this is the most urgent
             list in the app. Folded by machine type, worst type first, with
             what is outstanding on the heading so it reads shut. -->
        ${(() => {
          const types = [...new Set(rows.map(r => r.u.group))];
          const bad = g => rows.filter(r => r.u.group === g && r.st.state !== 'ok').length;
          types.sort((a, b) => bad(b) - bad(a));
          return types.map(g => {
            const inG = rows.filter(r => r.u.group === g);
            const n = bad(g);
            return `<details class="grp-fold" ${n ? 'open' : ''}>
              <summary><span class="grp">${esc(g)}</span>
                <span class="grp-tally">${inG.length} machine${inG.length === 1 ? '' : 's'}${n ? ' · <b class="bad-text">' + n + ' to sort</b>' : ' · all in date'}</span>
              </summary>
              <table class="tbl"><thead><tr><th>Unit</th><th>Serial</th><th>Where</th><th>Certificate</th><th></th></tr></thead><tbody>
              ${inG.map(({ u, st }) => {
                const d = AM.derive();
                const a = d.unitAt.get(u.id);
                const rec = d.dop.get(u.id);
                return `<tr data-name="${esc((u.name + ' ' + (u.unitNo || '') + ' ' + u.id + ' ' + (u.serial || '')).toLowerCase())}" class="${st.state === 'ok' ? '' : 'low'}">
                  <td><strong>${esc(u.name)} ${esc(u.unitNo || '')}</strong><div class="line-id">${esc(u.id)}</div></td>
                  <td class="small">${esc(u.serial || '—')}</td>
                  <td class="small">${!a || a.where === 'shop' ? 'Shop' : a.where === 'missing' ? 'MISSING' : esc(jobLabel(a.jobId))}</td>
                  <td><span class="cert ${st.state}">${esc(st.label)}</span>${rec && rec.cert ? `<div class="muted small">cert ${esc(rec.cert)}${rec.tech ? ' · ' + esc(rec.tech) : ''}</div>` : ''}</td>
                  <td><button class="btn-ghost dop-log" data-id="${esc(u.id)}">Record a test</button></td>
                </tr>`;
              }).join('')}
              </tbody></table>
            </details>`;
          }).join('');
        })()}
      </div>
    </div>`;
  };

  AM.after['#/dop'] = function () {
    const dq = $('#dopq');
    if (dq) dq.oninput = e => {
      const t = e.target.value.trim().toLowerCase();
      $$('tr[data-name]').forEach(tr => { tr.style.display = !t || tr.dataset.name.includes(t) ? '' : 'none'; });
      $$('.grp-fold').forEach(f => {
        if (!t) { f.style.display = ''; return; }
        const hits = [...f.querySelectorAll('tr[data-name]')].filter(tr => tr.style.display !== 'none').length;
        f.style.display = hits ? '' : 'none';
        if (hits) f.open = true;
      });
    };
    $$('.dop-log').forEach(b => b.onclick = () => {
      const id = b.dataset.id;
      const u = S.catalog.units.find(x => x.id === id);
      AM.modal(`
        <h3>${esc(u.name)} ${esc(u.unitNo || '')}</h3>
        <p class="muted small">${esc(u.id)}${u.serial ? ' · ' + esc(u.serial) : ''}</p>
        <label class="fld">What happened
          <select id="dType"><option value="DOP">DOP or PAO test</option><option value="FILTER">Filter change</option></select></label>
        <label class="fld">Result
          <select id="dRes"><option value="pass">Passed</option><option value="fail">Failed</option></select></label>
        <label class="fld">Certificate number<input id="dCert" placeholder="off the certificate" autocomplete="off"></label>
        <label class="fld">Efficiency<input id="dEff" placeholder="e.g. 99.97%" autocomplete="off"></label>
        <label class="fld">Who tested it<input id="dTech" placeholder="technician and company" autocomplete="off"></label>
        <label class="fld">Date<input id="dDate" type="date" value="${AM.dayISO()}"></label>
        <div class="row"><button class="btn" id="dGo">Record it</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
      `, el => {
        $('#dGo', el).onclick = async () => {
          await AM.record({
            type: $('#dType', el).value,
            itemId: id,
            result: $('#dRes', el).value,
            cert: $('#dCert', el).value.trim(),
            efficiency: $('#dEff', el).value.trim(),
            tech: $('#dTech', el).value.trim(),
            at: new Date($('#dDate', el).value + 'T12:00:00').toISOString()
          });
          AM.closeModal();
          AM.toast('On the record');
        };
      });
    });
  };

  /* -------------------------------------------------------------- labels --- */

  /* ------------------------------------------------------------- add gear ---
     Adding one machine is a form. Adding forty is a paste. Everybody in this
     shop already keeps lists in a spreadsheet, so the fastest way in is the
     one where they highlight the rows they already typed and drop them here.
     Nothing is written until the office has looked at the table underneath. */

  const PREFIXES = { 'Dehumidifiers': 'DEH', 'Negative Air': 'NEG', 'Air Movers': 'AFM', 'Vacuums': 'VAC',
    'Air Scrubbers': 'AFD', 'Ladders': 'LAD', 'Showers': 'SHW', 'Bins': 'BIN', 'Hand tools': 'TLS' };

  let addParsed = { units: [], stock: [], problems: [] };

  AM.screens['#/add'] = function () {
    const groupsU = [...new Set(S.catalog.units.map(u => u.group))].sort();
    const groupsS = [...new Set(S.catalog.stock.map(x => x.group))].sort();
    return `
    <div class="wrap wide">
      <div class="panel">
        <a class="back-link" href="#/setup">Back to settings</a>
        <h2>Add gear or materials</h2>
        <p class="muted">One thing is a form. A list is a paste out of Excel. Nothing is added until you have read the table it builds.</p>
      </div>

      <div class="panel">
        <h2>One at a time</h2>
        <div class="grid2">
          <label class="fld">What is it
            <select id="a1Kind"><option value="unit">A machine</option><option value="stock">A material off the shelf</option></select></label>
          <label class="fld">Group
            <select id="a1Group">${groupsU.map(g => `<option>${esc(g)}</option>`).join('')}</select></label>
          <label class="fld">Name<input id="a1Name" placeholder="Dehumidifier - Large" autocomplete="off"></label>
          <label class="fld">Unit number<input id="a1No" placeholder="#812" autocomplete="off"></label>
          <label class="fld">Serial<input id="a1Ser" placeholder="off the plate" autocomplete="off"></label>
          <label class="fld">Make and model<input id="a1Model" placeholder="Actuvate OLR190B" autocomplete="off"></label>
        </div>
        <div class="row"><button class="btn" id="a1Go">Add it</button>
          <span class="muted small">The tag is worked out from the group, carrying on from the last one, and the sticker is ready to print straight after.</span></div>
      </div>

      <div class="panel">
        <h2>A list, pasted</h2>
        <div class="lbl-controls">
          <label class="fld">These rows are
            <select id="apKind"><option value="unit">Machines</option><option value="stock">Materials off the shelf</option></select></label>
          <button class="btn-ghost" id="apRead">Read it</button>
        </div>
        <p class="muted small" id="apHint">Machines: group, name, unit number, serial, make and model. One row each, in that order, headers or not. A tag is worked out for anything without one.</p>
        <textarea id="apText" class="paste" rows="8" placeholder="Dehumidifiers&#9;Dehumidifier - Large&#9;#812&#9;230784094770013&#9;Actuvate OLR190B"></textarea>
        <div id="apOut"></div>
      </div>
    </div>`;
  };

  /* The next tag in a group, carried on from whatever is already there rather
     than restarted, so nobody ends up with two DEH-804 on two machines. */
  function nextTag(group, kind) {
    const list = kind === 'unit' ? S.catalog.units : S.catalog.stock;
    const inGroup = list.filter(x => x.group === group);
    const counts = {};
    inGroup.forEach(x => { const m = /^([A-Z]+)-(\d+)$/.exec(String(x.id)); if (m) counts[m[1]] = Math.max(counts[m[1]] || 0, parseInt(m[2], 10)); });
    let prefix = PREFIXES[group] || Object.keys(counts)[0];
    if (!prefix) prefix = group.replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase() || 'ITM';
    let n = (counts[prefix] || 0) + 1;
    const used = new Set(list.map(x => String(x.id)));
    let id = `${prefix}-${String(n).padStart(2, '0')}`;
    while (used.has(id)) { n++; id = `${prefix}-${String(n).padStart(2, '0')}`; }
    return id;
  }

  AM.after['#/add'] = function () {
    const kindSel = $('#a1Kind'), groupSel = $('#a1Group');
    const fillGroups = () => {
      const unit = kindSel.value === 'unit';
      const gs = [...new Set((unit ? S.catalog.units : S.catalog.stock).map(x => x.group))].sort();
      groupSel.innerHTML = gs.map(g => `<option>${esc(g)}</option>`).join('');
    };
    kindSel.onchange = fillGroups;

    $('#a1Go').onclick = async () => {
      const unit = kindSel.value === 'unit';
      const name = $('#a1Name').value.trim();
      if (!name) { AM.toast('It needs a name.', 'warn'); return; }
      const group = groupSel.value;
      const id = nextTag(group, unit ? 'unit' : 'stock');
      if (unit) {
        S.catalog.units.push({ id, kind: 'unit', group, name, unitNo: $('#a1No').value.trim(),
          serial: $('#a1Ser').value.trim(), model: $('#a1Model').value.trim(), status: 'Active',
          dop: /negative air|vacuum|scrubber/i.test(group + ' ' + name), home: 'SHOP', addedBy: S.me || '', addedAt: AM.nowISO() });
      } else {
        S.catalog.stock.push({ id, kind: 'stock', group, name, cls: 'consumed', uom: 'EA',
          increments: [], onHand: null, min: null, addedBy: S.me || '', addedAt: AM.nowISO() });
      }
      await AM.saveCatalog();
      AM.toast(`${name} is on the list as ${id}.`);
      AM.go('#/labels?ids=' + encodeURIComponent(id));
    };

    const hint = $('#apHint');
    $('#apKind').onchange = () => {
      hint.textContent = $('#apKind').value === 'unit'
        ? 'Machines: group, name, unit number, serial, make and model. One row each, in that order, headers or not. A tag is worked out for anything without one.'
        : 'Materials: group, name, unit of measure, minimum, price. One row each, in that order, headers or not.';
    };

    $('#apRead').onclick = () => {
      const unit = $('#apKind').value === 'unit';
      const text = $('#apText').value;
      const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
      const rowsIn = lines.map(l => l.split(/\t|,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(c => c.replace(/^"|"$/g, '').trim()));
      /* A header row is thrown away rather than added as a machine called
         "Serial", which is exactly the thing that happens otherwise. */
      if (rowsIn.length && /group|item|name|description/i.test(rowsIn[0][0] || '')) rowsIn.shift();

      const seenId = new Set([...S.catalog.units.map(u => String(u.id)), ...S.catalog.stock.map(x => String(x.id))]);
      const seenSerial = new Set(S.catalog.units.filter(u => u.serial).map(u => String(u.serial).toUpperCase()));
      const out = []; const problems = [];

      rowsIn.forEach((r, i) => {
        const group = (r[0] || '').trim();
        const name = (r[1] || '').trim();
        if (!name) { problems.push(`Row ${i + 1} has no name, so it was left out.`); return; }
        if (!group) { problems.push(`Row ${i + 1} (${name}) has no group, so it was left out.`); return; }
        if (unit) {
          const serial = (r[3] || '').trim();
          if (serial && seenSerial.has(serial.toUpperCase())) { problems.push(`${name}: serial ${serial} is already on a machine, so it was left out.`); return; }
          if (serial) seenSerial.add(serial.toUpperCase());
          const id = nextTagAvoiding(group, 'unit', seenId);
          out.push({ id, kind: 'unit', group, name, unitNo: (r[2] || '').trim(), serial,
            model: (r[4] || '').trim(), status: 'Active',
            dop: /negative air|vacuum|scrubber/i.test(group + ' ' + name), home: 'SHOP',
            addedBy: S.me || '', addedAt: AM.nowISO() });
        } else {
          const id = nextTagAvoiding(group, 'stock', seenId);
          const min = parseFloat(r[3]); const price = parseFloat(r[4]);
          out.push({ id, kind: 'stock', group, name, cls: 'consumed', uom: (r[2] || 'EA').trim().toUpperCase(),
            increments: [], onHand: null, min: isFinite(min) ? min : null,
            price: isFinite(price) ? price : null, addedBy: S.me || '', addedAt: AM.nowISO() });
        }
      });

      addParsed = unit ? { units: out, stock: [], problems } : { units: [], stock: out, problems };
      drawParsed();
    };

    function nextTagAvoiding(group, kind, seen) {
      let id = nextTag(group, kind);
      let n = 1;
      while (seen.has(id)) {
        const m = /^([A-Z]+)-(\d+)$/.exec(id);
        id = `${m[1]}-${String(parseInt(m[2], 10) + n).padStart(2, '0')}`;
        n++;
      }
      seen.add(id);
      return id;
    }

    function drawParsed() {
      const list = addParsed.units.length ? addParsed.units : addParsed.stock;
      const unit = !!addParsed.units.length;
      const out = $('#apOut');
      if (!list.length) {
        out.innerHTML = `<p class="muted">Nothing readable in there yet.</p>${addParsed.problems.map(p => `<p class="bad small">${esc(p)}</p>`).join('')}`;
        return;
      }
      out.innerHTML = `
        ${addParsed.problems.length ? `<div class="panel note bad"><h2>${addParsed.problems.length} row${addParsed.problems.length === 1 ? '' : 's'} left out</h2>
          ${addParsed.problems.map(p => `<p class="small">${esc(p)}</p>`).join('')}</div>` : ''}
        <table class="tbl"><thead><tr><th>Tag</th><th>Group</th><th>Name</th>
          ${unit ? '<th>Unit</th><th>Serial</th><th>Model</th>' : '<th>Unit of measure</th><th class="n">Minimum</th><th class="n">Price</th>'}</tr></thead><tbody>
          ${list.map(x => `<tr><td class="line-id">${esc(x.id)}</td><td>${esc(x.group)}</td><td><strong>${esc(x.name)}</strong></td>
            ${unit ? `<td>${esc(x.unitNo || '')}</td><td class="small">${esc(x.serial || '')}</td><td class="small">${esc(x.model || '')}</td>`
                   : `<td>${esc(x.uom)}</td><td class="n">${x.min == null ? '' : qty(x.min)}</td><td class="n">${x.price == null ? '' : money(x.price)}</td>`}</tr>`).join('')}
        </tbody></table>
        <div class="row"><button class="btn big" id="apGo">Add these ${list.length}</button>
        <button class="btn-ghost" id="apCancel">Start again</button></div>`;

      $('#apGo').onclick = async () => {
        S.catalog.units.push(...addParsed.units);
        S.catalog.stock.push(...addParsed.stock);
        const ids = list.map(x => x.id);
        await AM.saveCatalog();
        AM.toast(`${ids.length} added. Print the stickers while you have them in front of you.`);
        addParsed = { units: [], stock: [], problems: [] };
        AM.go('#/labels?ids=' + encodeURIComponent(ids.join(',')));
      };
      $('#apCancel').onclick = () => { $('#apText').value = ''; addParsed = { units: [], stock: [], problems: [] }; drawParsed(); };
    }
  };

  /* ---------------------------------------------------------------- labels ---
     Printing onto real sticker sheets, not onto paper to be cut out with
     scissors. Every measurement below is the label maker's own, in inches, so
     what comes out of the printer lands on the die cut. The offset matters more
     than it sounds: a shop that has to bin two thirds of a sheet to print six
     stickers stops printing stickers. */

  /* An array, not an object: keys that look like numbers get reordered by the
     language itself, which quietly put Jen's sheet fourth in her own list. */
  const SHEETS = [
    /* The full sheet Jen buys: one big label, no die cut, so the grid is ours
       to choose and they cut them apart. Eight to a page, cut lines printed. */
    ['5165-8', { name: 'Avery 5165 full sheet · 8 to a page, cut them · 3.9 × 2.5 in', cols: 2, rows: 4, w: 3.9, h: 2.5, top: 0.3, left: 0.3, gapX: 0.2, gapY: 0.15, size: 'lg', cut: true }],
    ['5160', { name: 'Avery 5160 · 30 per sheet · 2⅝ × 1 in', cols: 3, rows: 10, w: 2.625, h: 1, top: 0.5, left: 0.1875, gapX: 0.125, gapY: 0, size: 'sm' }],
    ['5163', { name: 'Avery 5163 · 10 per sheet · 4 × 2 in', cols: 2, rows: 5, w: 4, h: 2, top: 0.5, left: 0.15625, gapX: 0.1875, gapY: 0, size: 'lg' }],
    ['5164', { name: 'Avery 5164 · 6 per sheet · 4 × 3⅓ in', cols: 2, rows: 3, w: 4, h: 3.333, top: 0.5, left: 0.15625, gapX: 0.1875, gapY: 0, size: 'lg' }],
    ['5167', { name: 'Avery 5167 · 80 per sheet · 1¾ × ½ in', cols: 4, rows: 20, w: 1.75, h: 0.5, top: 0.5, left: 0.28125, gapX: 0.3, gapY: 0, size: 'xs' }],
    ['plain', { name: 'Plain paper, cut them out', cols: 3, rows: 8, w: 2.5, h: 1.25, top: 0.5, left: 0.4, gapX: 0.2, gapY: 0.2, size: 'sm', cut: true }]
  ];
  const sheetById = k => (SHEETS.find(x => x[0] === k) || SHEETS[0])[1];

  let lbSelection = null;   // set when the office has just added gear and wants those labels

  /* --------------------------------------------------------------- sheet ---
     The shelf, as a spreadsheet, out and back in again.

     Two things made this necessary. Counting 208 lines standing at a shelf with
     a phone is slower than counting them on paper, and the shop already lives
     in Excel. And the shelf grows: somebody buys something nobody has ever
     bought before and it has to get onto the list without waiting for anybody.

     THE CODE IS THE KEY, THE NAME IS NOT. Every row carries the item's code,
     and the code is what the app matches on. Which means a name can be tidied
     up, corrected, spelled the way the shop actually says it, and it is a
     rename rather than a new line appearing beside the old one. That is the
     whole answer to "the naming conventions will get messed up": nothing is
     ever matched on a name, so a name cannot break anything.

     A blank cell means leave it alone. It never means clear it. Somebody who
     only wants to fill in the counts should not have to retype the minimums to
     avoid wiping them, and half a sheet filled in is the normal state of a
     sheet being filled in.

     Nothing on this screen ever deletes a line. A row taken off the sheet is a
     row somebody deleted in Excel, and that is not the same as a decision to
     stop stocking something. */

  const SHEET_COLS = [
    ['code',   'Code',        ['code', 'item code', 'tag', 'id', 'sku']],
    ['name',   'Item',        ['item', 'name', 'description', 'material', 'product']],
    ['group',  'Group',       ['group', 'category', 'section', 'type']],
    ['uom',    'Unit',        ['unit', 'uom', 'unit of measure', 'each']],
    ['onHand', 'In stock',    ['in stock', 'on hand', 'count', 'counted', 'quantity', 'qty', 'stock']],
    ['min',    'Minimum',     ['minimum', 'min', 'reorder at', 'reorder point']],
    ['max',    'Maximum',     ['maximum', 'max', 'order up to']],
    ['shelf',  'Shelf spot',  ['shelf spot', 'shelf', 'location', 'where', 'bin']],
    ['vendor', 'Bought from', ['bought from', 'supplier', 'vendor', 'buy from']],
    ['price',  'Last paid',   ['last paid', 'price', 'cost', 'unit price', 'each cost']],
    ['notes',  'Notes',       ['notes', 'note', 'comment', 'comments']]
  ];

  /* The same idea for machines. Jen's actual job is 125 machines with no serial
     on file, and doing that one at a time on a phone is a day nobody has. On a
     sheet it is an afternoon with the fleet in front of you.

     Status is here because "is this still in circulation or is it dead" cannot
     be answered from a serial number. It is written back as a real movement,
     the same one the app records when somebody pulls a machine at tear down,
     so the history stays true. Nothing is ever deleted from a sheet. */
  const GEAR_COLS = [
    ['code',   'Code',            ['code', 'item code', 'tag', 'id', 'sku']],
    ['name',   'Machine',         ['machine', 'item', 'name', 'description', 'equipment']],
    ['group',  'Group',           ['group', 'category', 'section', 'type']],
    ['unitNo', 'Unit number',     ['unit number', 'unit no', 'unit', 'number', 'asset number']],
    ['serial', 'Serial',          ['serial', 'serial number', 'serial no', 'sn']],
    ['model',  'Make and model',  ['make and model', 'model', 'make', 'make model']],
    ['status', 'Status',          ['status', 'state', 'in circulation', 'condition']],
    ['notes',  'Notes',           ['notes', 'note', 'comment', 'comments']]
  ];

  const STATUSES = ['In service', 'Out of service', 'Lost', 'Written off'];

  const normHead = s => String(s || '').toLowerCase().replace(/[^a-z ]/g, ' ').replace(/\s+/g, ' ').trim();

  function csvCell(v) {
    const s = v == null ? '' : String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  /* Excel writes commas, a copy straight out of Excel writes tabs, and the shop
     will do both. Whichever the first line has more of wins. */
  function parseDelim(text) {
    const first = String(text).split(/\r?\n/)[0] || '';
    const D = (first.split('\t').length > first.split(',').length) ? '\t' : ',';
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
        else cell += c;
      } else if (c === '"') q = true;
      else if (c === D) { row.push(cell); cell = ''; }
      else if (c === '\n') { row.push(cell); rows.push(row); row = []; cell = ''; }
      else if (c === '\r') { /* skip */ }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(x => String(x).trim() !== ''));
  }

  function sheetCSV() {
    const d = AM.derive();
    const head = SHEET_COLS.map(c => c[1]).concat(['Last counted']);
    const lines = [head.map(csvCell).join(',')];
    const stock = S.catalog.stock.slice().sort((a, b) =>
      (a.group || '').localeCompare(b.group || '') || (a.name || '').localeCompare(b.name || ''));
    for (const s of stock) {
      const n = d.onHand.get(s.id);
      lines.push([
        s.id, s.name, s.group, s.uom || 'EA',
        n == null ? '' : n,
        s.min == null ? '' : s.min,
        s.max == null ? '' : s.max,
        s.shelf || '', vendorName(s) === 'Not set' ? '' : vendorName(s),
        s.price == null ? '' : s.price,
        s.notes || '',
        n == null ? 'never counted' : 'counted'
      ].map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  function whereNow(id) {
    const a = AM.derive().unitAt.get(id);
    if (!a || a.where === 'shop') return 'In service';
    if (a.where === 'repair') return 'Out of service';
    if (a.where === 'missing') return 'Lost';
    if (a.where === 'writeoff') return 'Written off';
    return 'In service';                     // out on a job is still in service
  }

  function gearCSV() {
    const d = AM.derive();
    const head = GEAR_COLS.map(c => c[1]).concat(['Where it is now']);
    const lines = [head.map(csvCell).join(',')];
    const units = S.catalog.units.slice().sort((a, b) =>
      (a.group || '').localeCompare(b.group || '') ||
      String(a.unitNo || '').localeCompare(String(b.unitNo || ''), undefined, { numeric: true }));
    for (const u of units) {
      const a = d.unitAt.get(u.id);
      const at = !a || a.where === 'shop' ? 'Shop'
        : a.where === 'job' ? ('On ' + jobLabel(a.jobId))
        : a.where === 'repair' ? 'Out of service'
        : a.where === 'missing' ? 'Lost' : 'Written off';
      lines.push([u.id, u.name, u.group, u.unitNo || '', u.serial || '', u.model || '',
        whereNow(u.id), u.notes || '', at].map(csvCell).join(','));
    }
    return lines.join('\r\n');
  }

  function num(v) {
    const t = String(v == null ? '' : v).replace(/[$,\s]/g, '').trim();
    if (t === '') return undefined;              // blank means leave it alone
    const n = parseFloat(t);
    return isFinite(n) ? n : undefined;
  }

  /* Reads the sheet and works out what it would do, without doing any of it.
     Nothing is applied until somebody has read this back. */
  function readSheet(text) {
    const rows = parseDelim(text);
    if (!rows.length) return { rows: [], problem: 'There is nothing in there to read.' };

    // Where each column sits. If the top row is not headers, fall back to the
    // order the app exports in, which is the order the sheet arrived in.
    let map = {}, start = 0;
    const first = rows[0].map(normHead);
    let hits = 0;
    SHEET_COLS.forEach(([key, , aliases]) => {
      const i = first.findIndex(h => h && aliases.includes(h));
      if (i >= 0) { map[key] = i; hits++; }
    });
    if (hits >= 2) start = 1;
    else { map = {}; SHEET_COLS.forEach(([key], i) => { map[key] = i; }); start = 0; }

    const byId = new Map(S.catalog.stock.map(s => [String(s.id).toUpperCase(), s]));
    const d = AM.derive();
    const seen = new Set();
    const out = [];
    let lastGroup = '';

    for (let r = start; r < rows.length; r++) {
      const cells = rows[r];
      const get = k => (map[k] == null ? '' : String(cells[map[k]] == null ? '' : cells[map[k]]).trim());
      const code = get('code').toUpperCase();
      const name = get('name');
      if (!code && !name) continue;

      const rec = { line: r + 1, code, name, acts: [], warn: '' };
      const existing = code ? byId.get(code) : null;
      if (get('group')) lastGroup = get('group');

      if (code && !existing) {
        // A code the app has never seen. Somebody typed it deliberately, so it
        // is honoured rather than replaced.
        if (!name) { rec.warn = 'A code with no name. Skipped.'; out.push(rec); continue; }
        if (seen.has(code)) { rec.warn = 'That code is on this sheet twice. Skipped.'; out.push(rec); continue; }
        rec.mode = 'new'; rec.id = code;
      } else if (!code) {
        if (!name) { rec.warn = 'No code and no name. Skipped.'; out.push(rec); continue; }
        rec.mode = 'new'; rec.id = null;      // a tag gets worked out on apply
      } else {
        if (seen.has(code)) { rec.warn = 'That code is on this sheet twice. Only the first was read.'; out.push(rec); continue; }
        rec.mode = 'edit'; rec.id = existing.id; rec.item = existing;
      }
      if (code) seen.add(code);

      rec.group = get('group') || lastGroup || 'Shop added';
      rec.uom = get('uom');
      rec.shelf = get('shelf');
      rec.notes = get('notes');
      rec.vendorText = get('vendor');
      rec.onHand = num(get('onHand'));
      rec.min = num(get('min'));
      rec.max = num(get('max'));
      rec.price = num(get('price'));

      if (rec.mode === 'new') {
        rec.acts.push('new line on the shelf');
        if (rec.onHand != null) rec.acts.push('counted at ' + qty(rec.onHand));
      } else {
        const s = rec.item;
        if (name && name !== s.name) rec.acts.push('renamed from "' + s.name + '"');
        const cur = d.onHand.get(s.id);
        if (rec.onHand != null && rec.onHand !== cur) {
          rec.acts.push(cur == null ? 'counted at ' + qty(rec.onHand) : 'count ' + qty(cur) + ' → ' + qty(rec.onHand));
        }
        if (rec.min != null && rec.min !== s.min) rec.acts.push('minimum ' + (s.min == null ? 'set to ' : (s.min + ' → ')) + rec.min);
        if (rec.max != null && rec.max !== s.max) rec.acts.push('maximum ' + (s.max == null ? 'set to ' : (s.max + ' → ')) + rec.max);
        if (rec.shelf && rec.shelf !== (s.shelf || '')) rec.acts.push('shelf spot ' + rec.shelf);
        if (rec.uom && rec.uom !== (s.uom || '')) rec.acts.push('unit ' + rec.uom);
        if (rec.notes && rec.notes !== (s.notes || '')) rec.acts.push('note changed');
        if (rec.price != null && rec.price !== s.price) rec.acts.push('last paid ' + money(rec.price));
        if (rec.vendorText && rec.vendorText !== vendorName(s)) rec.acts.push('bought from ' + rec.vendorText);
      }
      out.push(rec);
    }
    return { rows: out };
  }

  /* Is this sheet machines or materials? Decided on the headers, not on the
     person remembering to say, because they will not. A serial or a unit
     number column means machines; nothing else has one. */
  function sheetKind(text) {
    const first = (parseDelim(text)[0] || []).map(normHead);
    const gear = first.some(h => ['serial', 'serial number', 'unit number', 'make and model', 'machine'].includes(h));
    const shelf = first.some(h => ['in stock', 'on hand', 'minimum', 'bought from'].includes(h));
    return gear && !shelf ? 'gear' : 'shelf';
  }

  function readGear(text) {
    const rows = parseDelim(text);
    if (!rows.length) return { rows: [], problem: 'There is nothing in there to read.' };

    let map = {}, start = 0, hits = 0;
    const first = rows[0].map(normHead);
    GEAR_COLS.forEach(([key, , aliases]) => {
      const i = first.findIndex(h => h && aliases.includes(h));
      if (i >= 0) { map[key] = i; hits++; }
    });
    if (hits >= 2) start = 1;
    else { map = {}; GEAR_COLS.forEach(([key], i) => { map[key] = i; }); start = 0; }

    const byId = new Map(S.catalog.units.map(u => [String(u.id).toUpperCase(), u]));
    const serials = new Map();
    S.catalog.units.forEach(u => { if (u.serial) serials.set(String(u.serial).trim().toUpperCase(), u); });
    const seen = new Set();
    const out = [];
    let lastGroup = '';

    for (let r = start; r < rows.length; r++) {
      const cells = rows[r];
      const get = k => (map[k] == null ? '' : String(cells[map[k]] == null ? '' : cells[map[k]]).trim());
      const code = get('code').toUpperCase();
      const name = get('name');
      if (!code && !name) continue;

      const rec = { line: r + 1, code, name, acts: [], warn: '' };
      const existing = code ? byId.get(code) : null;
      if (get('group')) lastGroup = get('group');

      if (code && seen.has(code)) { rec.warn = 'That code is on this sheet twice. Only the first was read.'; out.push(rec); continue; }
      if (code && !existing) {
        if (!name) { rec.warn = 'A code with no name. Skipped.'; out.push(rec); continue; }
        rec.mode = 'new'; rec.id = code;
      } else if (!code) {
        if (!name) { rec.warn = 'No code and no name. Skipped.'; out.push(rec); continue; }
        rec.mode = 'new'; rec.id = null;
      } else { rec.mode = 'edit'; rec.id = existing.id; rec.item = existing; }
      if (code) seen.add(code);

      rec.group = get('group') || lastGroup || 'Shop added';
      rec.unitNo = get('unitNo');
      rec.serial = get('serial');
      rec.model = get('model');
      rec.notes = get('notes');

      const st = normHead(get('status'));
      rec.status = st ? (STATUSES.find(s => normHead(s) === st) ||
        (/(dead|scrap|retire|written|write)/.test(st) ? 'Written off' :
         /(lost|missing|gone)/.test(st) ? 'Lost' :
         /(broke|repair|out of)/.test(st) ? 'Out of service' :
         /(good|ok|active|in service|circulation|working)/.test(st) ? 'In service' : null)) : null;
      if (get('status') && !rec.status) rec.warn = `"${get('status')}" is not a status the app knows. Use one of: ${STATUSES.join(', ')}.`;

      // A serial already carried by a different machine is nearly always a typo
      // or a row pasted onto the wrong line, and it is the one mistake that is
      // genuinely hard to unpick afterwards.
      if (rec.serial) {
        const owner = serials.get(rec.serial.toUpperCase());
        if (owner && owner.id !== rec.id) {
          rec.warn = `Serial ${rec.serial} is already on ${owner.name} ${owner.unitNo || ''} (${owner.id}). Skipped.`;
          out.push(rec); continue;
        }
      }

      if (rec.mode === 'new') {
        rec.acts.push('new machine on the fleet');
        if (rec.serial) rec.acts.push('serial ' + rec.serial);
      } else {
        const u = rec.item;
        if (name && name !== u.name) rec.acts.push('renamed from "' + u.name + '"');
        if (rec.serial && rec.serial !== (u.serial || '')) rec.acts.push(u.serial ? 'serial ' + u.serial + ' → ' + rec.serial : 'serial set to ' + rec.serial);
        if (rec.unitNo && rec.unitNo !== (u.unitNo || '')) rec.acts.push('unit number ' + rec.unitNo);
        if (rec.model && rec.model !== (u.model || '')) rec.acts.push('model ' + rec.model);
        if (rec.notes && rec.notes !== (u.notes || '')) rec.acts.push('note changed');
        const now = whereNow(u.id);
        if (rec.status && rec.status !== now) rec.acts.push(now.toLowerCase() + ' → ' + rec.status.toLowerCase());
      }
      out.push(rec);
    }
    return { rows: out };
  }

  async function applyGear(recs) {
    let created = 0, changed = 0, moved = 0;
    for (const rec of recs) {
      if (rec.warn || !rec.acts.length) continue;
      let u = rec.item;
      if (rec.mode === 'new') {
        const id = rec.id || nextTag(rec.group, 'unit');
        u = {
          id, kind: 'unit', group: rec.group, name: rec.name,
          unitNo: rec.unitNo || '', serial: rec.serial || '', model: rec.model || '',
          status: 'Active', dop: /negative air|vacuum|scrubber/i.test(rec.group + ' ' + rec.name),
          home: 'SHOP', notes: rec.notes || '', source: 'sheet',
          addedBy: S.me || '', addedAt: AM.nowISO()
        };
        S.catalog.units.push(u);
        rec.id = id;
        created++;
      } else {
        if (rec.name && rec.name !== u.name) u.name = rec.name;
        if (rec.serial) u.serial = rec.serial;
        if (rec.unitNo) u.unitNo = rec.unitNo;
        if (rec.model) u.model = rec.model;
        if (rec.notes) u.notes = rec.notes;
        changed++;
      }
    }
    await AM.saveCatalog();

    /* A status change is a movement, not a field. Written off and lost are
       facts about a machine with a date and a name on them, and the rest of the
       app already reads them from the log. */
    for (const rec of recs) {
      if (rec.warn || !rec.status || !rec.id) continue;
      const now = whereNow(rec.id);
      if (now === rec.status) continue;
      const note = 'Set from the equipment sheet' + (rec.notes ? ': ' + rec.notes : '');
      if (rec.status === 'Written off') await AM.record({ type: 'WRITEOFF', itemId: rec.id, note });
      else if (rec.status === 'Lost') await AM.record({ type: 'MISSING', itemId: rec.id, note });
      else if (rec.status === 'Out of service') await AM.record({ type: 'REPAIR', itemId: rec.id, note });
      // Back in service means different things depending on where it was: a
      // broken one is fixed, a lost one has turned up.
      else if (rec.status === 'In service') {
        await AM.record({ type: now === 'Out of service' ? 'FIXED' : 'FOUND', itemId: rec.id, note });
      }
      moved++;
    }
    return { created, changed, moved };
  }

  async function applySheet(recs) {
    let created = 0, changed = 0, counted = 0;
    for (const rec of recs) {
      if (rec.warn || !rec.acts.length) continue;
      let s = rec.item;
      if (rec.mode === 'new') {
        const id = rec.id || nextTag(rec.group, 'stock');
        s = {
          id, kind: 'stock', group: rec.group, name: rec.name,
          cls: 'consumed', uom: rec.uom || 'EA', increments: [],
          onHand: null, min: null, max: null, shelf: rec.shelf || '',
          price: rec.price == null ? null : rec.price, notes: rec.notes || '',
          source: 'sheet', addedBy: S.me || '', addedAt: AM.nowISO()
        };
        S.catalog.stock.push(s);
        rec.id = id;
        created++;
      } else {
        if (rec.name && rec.name !== s.name) s.name = rec.name;
        if (rec.uom) s.uom = rec.uom;
        if (rec.shelf) s.shelf = rec.shelf;
        if (rec.notes) s.notes = rec.notes;
        if (rec.price != null) s.price = rec.price;
        changed++;
      }
      if (rec.min != null) s.min = rec.min;
      if (rec.max != null) s.max = rec.max;
      if (rec.vendorText) {
        const v = vendorList().find(x => normHead(x.name) === normHead(rec.vendorText));
        if (v) s.vendorId = v.id; else s.vendor = rec.vendorText;
      }
    }
    await AM.saveCatalog();

    // Counts are movements, not edits, so they go on the record with a name and
    // a time against them like every other count does.
    for (const rec of recs) {
      if (rec.warn || rec.onHand == null) continue;
      const id = rec.id;
      if (!id) continue;
      const cur = AM.derive().onHand.get(id);
      if (cur === rec.onHand) continue;
      await AM.record({ type: 'COUNT', itemId: id, qty: rec.onHand, via: 'sheet' });
      counted++;
    }
    return { created, changed, counted };
  }

  // Exposed so the sheet round trip can be tested without a browser.
  AM.sheetCSV = sheetCSV; AM.readSheet = readSheet; AM.applySheet = applySheet;
  AM.gearCSV = gearCSV; AM.readGear = readGear; AM.applyGear = applyGear; AM.sheetKind = sheetKind;

  let sheetPlan = null;

  AM.screens['#/sheet'] = function () {
    const d = AM.derive();
    const total = S.catalog.stock.length;
    const done = S.catalog.stock.filter(s => d.onHand.get(s.id) != null).length;
    const mins = S.catalog.stock.filter(s => s.min != null).length;
    const noSerial = S.catalog.units.filter(u => !u.serial).length;
    return `
    <div class="wrap wide">
      <div class="panel">
        <a class="back-link" href="#/setup">Back to settings</a>
        <h2>The shop, as a spreadsheet</h2>
        <p class="muted">Take a list out to Excel, work down it, bring the same sheet back in.</p>
        ${AM.why('It goes both ways, for the shelf and for the equipment. Nothing here ever deletes a line: a row taken off the sheet is a row somebody deleted in Excel, which is not the same as a decision to stop stocking something. A blank cell means leave that one alone rather than clear it, because half a sheet filled in is the normal state of a sheet being filled in.', 'What it will and will not do to your list')}
        <div class="stat-row">
          <div class="stat"><b>${total}</b><span>on the shelf</span></div>
          <div class="stat ${done < total ? 'warn' : ''}"><b>${done}</b><span>counted</span></div>
          <div class="stat ${mins < total ? 'warn' : ''}"><b>${mins}</b><span>have a minimum</span></div>
          <div class="stat"><b>${S.catalog.units.length}</b><span>machines</span></div>
          <div class="stat ${noSerial ? 'warn' : ''}"><b>${noSerial}</b><span>with no serial</span></div>
        </div>
      </div>

      <div class="panel">
        <h2>Out to Excel</h2>
        <p class="muted">Two lists, because they are two different jobs. The shelf is counting. The equipment is serial numbers and whether a machine is still in circulation.</p>
        <div class="two-up">
          <div>
            <h3 class="grp">The shelf</h3>
            <p class="muted small">${S.catalog.stock.length} materials, with the counts and minimums already in.</p>
            <div class="row"><button class="btn" id="shGet">Download the shelf</button>
            <button class="btn-ghost" id="shCopy">Copy it</button></div>
          </div>
          <div>
            <h3 class="grp">The equipment</h3>
            <p class="muted small">${S.catalog.units.length} machines. ${noSerial} ${noSerial === 1 ? 'has' : 'have'} no serial on file, which is the column to work down.</p>
            <div class="row"><button class="btn" id="gearGet">Download the equipment</button>
            <button class="btn-ghost" id="gearCopy">Copy it</button></div>
          </div>
        </div>
        <p class="muted small"><b>Leave the Code column alone.</b> Everything else can be changed freely, names included.</p>
      </div>

      <div class="panel">
        <h2>Back in from Excel</h2>
        <p class="muted">Drop the file in, or paste the rows straight out of Excel. Nothing changes until you have read the list it builds.</p>
        <div class="row">
          <label class="btn-ghost file-btn">Choose the file<input type="file" id="shFile" accept=".csv,.txt,.tsv" hidden></label>
          <span class="muted small" id="shFileName"></span>
        </div>
        <textarea id="shText" class="paste" rows="8" placeholder="Code&#9;Item&#9;Group&#9;Unit&#9;In stock&#9;Minimum&#9;…"></textarea>
        <div class="row"><button class="btn-ghost" id="shRead">Read it</button></div>
        <div id="shOut"></div>
      </div>

      <div class="panel note">
        <h2>Adding lines</h2>
        <p>A row with a name and no code is something new, on either sheet. It gets a code of its own when it comes in, worked out from its group and carried on from the last one, and the sticker for it is ready to print straight after. Put it under the group heading it belongs to and the group can be left blank.</p>
        <p>On the equipment sheet, Status answers whether a machine is still in circulation: ${STATUSES.join(', ')}. Changing it is recorded as a real movement with your name and the date on it, the same as pulling a machine at tear down, so nothing quietly disappears off the fleet.</p>
      </div>
    </div>`;
  };

  AM.after['#/sheet'] = function () {
    const out = $('#shOut');

    const save = (csv, what) => {
      const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'A&M ' + what + ' ' + AM.dayISO() + '.csv';
      document.body.appendChild(a); a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      AM.toast('Downloaded. Open it in Excel.');
    };
    const copy = csv => navigator.clipboard.writeText(csv).then(
      () => AM.toast('Copied. Paste it into a blank sheet in Excel.'),
      () => AM.toast('Could not copy. Use the download instead.', 'warn'));

    $('#shGet').onclick = () => save(sheetCSV(), 'shelf');
    $('#shCopy').onclick = () => copy(sheetCSV());
    $('#gearGet').onclick = () => save(gearCSV(), 'equipment');
    $('#gearCopy').onclick = () => copy(gearCSV());

    const file = $('#shFile');
    file.onchange = () => {
      const f = file.files && file.files[0];
      if (!f) return;
      $('#shFileName').textContent = f.name;
      const fr = new FileReader();
      fr.onload = () => { $('#shText').value = String(fr.result || ''); draw(); };
      fr.readAsText(f);
    };

    function draw() {
      const text = $('#shText').value;
      if (!text.trim()) { out.innerHTML = ''; sheetPlan = null; return; }
      const kind = sheetKind(text);
      const res = kind === 'gear' ? readGear(text) : readSheet(text);
      if (res.problem) { out.innerHTML = `<p class="muted pad-y">${esc(res.problem)}</p>`; sheetPlan = null; return; }
      sheetPlan = { kind, rows: res.rows };

      const doing = res.rows.filter(r => !r.warn && r.acts.length);
      const quiet = res.rows.filter(r => !r.warn && !r.acts.length).length;
      const bad = res.rows.filter(r => r.warn);
      const newOnes = doing.filter(r => r.mode === 'new').length;

      out.innerHTML = `
        <p class="clear-note">Read as ${kind === 'gear' ? 'the equipment list' : 'the shelf'}.</p>
        <div class="stat-row">
          <div class="stat"><b>${doing.length}</b><span>lines change</span></div>
          <div class="stat"><b>${newOnes}</b><span>new to the ${kind === 'gear' ? 'fleet' : 'shelf'}</span></div>
          <div class="stat"><b>${quiet}</b><span>read, nothing to do</span></div>
          ${bad.length ? `<div class="stat warn"><b>${bad.length}</b><span>could not be read</span></div>` : ''}
        </div>
        ${bad.length ? `<div class="panel note bad"><h2>Skipped</h2>${bad.map(r =>
          `<div class="muted small">Row ${r.line}: ${esc(r.name || r.code || '')} · ${esc(r.warn)}</div>`).join('')}</div>` : ''}
        ${doing.length ? `<table class="tbl"><thead><tr><th>Row</th><th>Item</th><th>Code</th><th>What happens</th></tr></thead><tbody>
          ${doing.slice(0, 400).map(r => `<tr>
            <td class="n">${r.line}</td>
            <td><strong>${esc(r.name || (r.item ? r.item.name : ''))}</strong></td>
            <td class="line-id">${esc(r.id || 'new code')}</td>
            <td class="small">${r.acts.map(esc).join(' · ')}</td>
          </tr>`).join('')}
        </tbody></table>
        ${doing.length > 400 ? `<p class="muted small">Showing the first 400 of ${doing.length}.</p>` : ''}
        <div class="row"><button class="btn big" id="shGo">Bring these ${doing.length} in</button></div>`
        : `<p class="muted pad-y">Read it, and nothing on this sheet is different to what the app already has.</p>`}`;

      const go = $('#shGo');
      if (go) go.onclick = async () => {
        go.disabled = true; go.textContent = 'Working through it…';
        const gear = sheetPlan.kind === 'gear';
        const r = gear ? await applyGear(sheetPlan.rows) : await applySheet(sheetPlan.rows);
        const bits = [];
        if (r.created) bits.push(`${r.created} new ${gear ? 'machine' : 'line'}${r.created === 1 ? '' : 's'}`);
        if (r.changed) bits.push(`${r.changed} updated`);
        if (r.counted) bits.push(`${r.counted} counted`);
        if (r.moved) bits.push(`${r.moved} status change${r.moved === 1 ? '' : 's'}`);
        AM.toast((bits.join(', ') || 'Nothing to do') + '.', 'ok');
        $('#shText').value = '';
        AM.go(gear ? '#/gear' : '#/shelf');
      };
    }

    $('#shRead').onclick = draw;
  };

  AM.screens['#/labels'] = function () {
    const pre = /[?&]ids=([^&]+)/.exec(location.hash);
    lbSelection = pre ? decodeURIComponent(pre[1]).split(',').filter(Boolean) : null;
    // Arriving from the shelf or from Find, already knowing what is being
    // printed, so it should not have to be picked again.
    const kindPre = (/[?&]kind=([a-z]+)/.exec(location.hash) || [])[1] || '';
    const cameFrom = /[?&]from=shelf/.test(location.hash) ? '#/shelf'
      : /[?&]from=gear/.test(location.hash) ? '#/gear' : '#/setup';
    return `
    <div class="wrap wide">
      <div class="panel no-print">
        <a class="back-link" href="${cameFrom}">${cameFrom === '#/shelf' ? 'Back to the shelf' : cameFrom === '#/gear' ? 'Back to the equipment' : 'Back to settings'}</a>
        <h2>Labels</h2>
        <p class="muted">Pick what you are printing, pick the sheet you buy, build it, print it.</p>
        ${AM.why('The code carries the tag and nothing else. A short code means a coarse pattern, and a coarse pattern is what still reads after spray glue, grit and a scratched face. The serial is printed underneath on purpose, so that when a tag is unreadable somebody can still read the number out over the radio.', 'Why the stickers look like that')}
        ${lbSelection ? `<p class="clear-note">Set to the ${lbSelection.length} you have just added. Clear the filter box to print everything.</p>` : ''}
        <div class="lbl-controls">
          <label class="fld">What are you printing
            <select id="lbKind">
              <option value="unit" ${kindPre === 'unit' ? 'selected' : ''}>Machine stickers</option>
              <option value="shelf" ${kindPre === 'shelf' ? 'selected' : ''}>Shelf edge cards</option>
              <option value="book" ${kindPre === 'book' ? 'selected' : ''}>A printed book of codes, for anything too small to sticker</option>
            </select></label>
          <label class="fld">Sticker sheet
            <select id="lbSheet">
              ${SHEETS.map(([k, v]) => `<option value="${k}">${esc(v.name)}</option>`).join('')}
            </select></label>
          <label class="fld">Start at sticker<input id="lbStart" type="number" min="1" value="1"></label>
          <label class="fld">Filter to<input id="lbFilter" placeholder="e.g. Negative Air, or DEH" autocomplete="off"></label>
          <button class="btn" id="lbGo">Build the sheet</button>
          <button class="btn-ghost" id="lbPrint">Print</button>
        </div>
        <p class="muted small" id="lbCount"></p>
        <p class="muted small"><b>Print at 100%, page scaling off</b>, or nothing lines up.</p>
        ${AM.why('First sheet on plain paper held over the label stock against a window tells you in five seconds whether the printer is honest. Polyester face with a polycarbonate overlaminate, permanent 3M adhesive on the powder-coated housings, applied on a degreased flat face away from the handle, with clear tape over the top. Anything you had to scan twice gets replaced, not left.', 'How to stick them on so they last')}
      </div>
      <div id="lbOut"></div>
    </div>`;
  };

  AM.after['#/labels'] = function () {
    const draw = () => {
      const kind = $('#lbKind').value;
      const sheet = sheetById($('#lbSheet').value);
      const skip = Math.max(0, (parseInt($('#lbStart').value, 10) || 1) - 1);
      const f = $('#lbFilter').value.trim().toLowerCase();
      const out = $('#lbOut');

      /* The book is a different animal: it is a page somebody flips through at
         the shelf, not a die cut sheet, so it keeps the flowing layout. */
      if (kind === 'book') {
        const list = S.catalog.stock.filter(s => !f || (s.id + ' ' + s.name + ' ' + s.group).toLowerCase().includes(f));
        out.className = 'lbl-sheet book';
        out.innerHTML = list.map(s => `
          <div class="bk">
            <div class="bk-qr">${AM.makeQR(s.id, 6)}</div>
            <div class="bk-nm">${esc(s.name)}</div>
            <div class="bk-tag">${esc(s.id)}</div>
          </div>`).join('');
        $('#lbCount').textContent = `${list.length} in the book.`;
        return;
      }

      const pick = (rows, idField) => rows.filter(x => {
        if (lbSelection && !f) return lbSelection.includes(String(x.id));
        return !f || (x.id + ' ' + x.name + ' ' + (x.group || '')).toLowerCase().includes(f);
      });

      const list = kind === 'unit'
        ? pick(S.catalog.units)
        : pick(S.catalog.stock);

      const cell = sheet.size === 'xs' ? 2 : sheet.size === 'lg' ? 5 : 3;
      const face = x => {
        const qr = `<div class="lb-qr">${AM.makeQR(x.id, cell)}</div>`;
        if (sheet.size === 'xs') {
          return qr + `<div class="lb-t"><div class="lb-tag">${esc(x.id)}</div></div>`;
        }
        if (kind === 'unit') {
          return qr + `<div class="lb-t">
            <div class="lb-tag">${esc(x.id)}</div>
            <div class="lb-nm">${esc(x.name)}${x.unitNo ? ' ' + esc(x.unitNo) : ''}</div>
            ${x.serial ? `<div class="lb-ser">${esc(x.serial)}</div>` : ''}
            <div class="lb-own">A&amp;M Abatement Services</div>
          </div>`;
        }
        return qr + `<div class="lb-t">
          <div class="lb-nm big">${esc(x.name)}</div>
          <div class="lb-tag">${esc(x.id)}</div>
          <div class="lb-ser">${esc(x.uom || 'EA')}${x.min != null ? ' · minimum ' + qty(x.min) : ''}</div>
        </div>`;
      };

      const per = sheet.cols * sheet.rows;
      const cells = new Array(skip).fill(null).concat(list);
      const pages = Math.max(1, Math.ceil(cells.length / per));
      let html = '';
      for (let p = 0; p < pages; p++) {
        html += `<div class="sheet">`;
        for (let i = 0; i < per; i++) {
          const x = cells[p * per + i];
          if (!x) continue;
          const c = i % sheet.cols, r = Math.floor(i / sheet.cols);
          const left = sheet.left + c * (sheet.w + sheet.gapX);
          const top = sheet.top + r * (sheet.h + sheet.gapY);
          html += `<div class="lb ${sheet.size} ${sheet.cut ? 'cut' : ''}" style="left:${left}in;top:${top}in;width:${sheet.w}in;height:${sheet.h}in">${face(x)}</div>`;
        }
        html += `</div>`;
      }
      out.className = 'sheets';
      out.innerHTML = html;
      $('#lbCount').textContent = `${list.length} sticker${list.length === 1 ? '' : 's'} across ${pages} sheet${pages === 1 ? '' : 's'}` +
        (skip ? `, starting at number ${skip + 1} so the rest of a part-used sheet is not wasted.` : '.');
    };

    ['lbKind', 'lbSheet', 'lbStart', 'lbFilter'].forEach(id => {
      const el = $('#' + id);
      if (el) el.oninput = draw;
    });
    $('#lbGo').onclick = draw;
    $('#lbPrint').onclick = () => window.print();
    if (lbSelection) $('#lbFilter').value = '';
    draw();
  };

  /* ------------------------------------------------------------ jobtread --- */

  AM.screens['#/link'] = function () {
    const unlinked = (S.catalog.jobs || []).filter(j => !j.jobtreadId && !j.closed);
    return `
    <div class="wrap wide">
      <div class="panel note">
        <a class="back-link" href="#/setup">Back to settings</a>
        <h2>One way, on purpose</h2>
        <p>Cost goes to JobTread. Nothing about where a machine is ever leaves here.</p>
        ${AM.why('JobTread has no equipment, no assets, no serials and no inventory anywhere in it, so where a machine is can only ever live here. Cost goes across as an internal bill that lands in draft for approval, flagged so it never reaches QuickBooks and corrupts what A&M owes.')}
      </div>

      <div class="panel">
        <h2>Setting it up</h2>
        <p class="muted" id="jtState">Checking…</p>

        <div class="setup">
          <div class="step" id="stepKey">
            <div class="step-n">1</div>
            <div class="step-b">
              <strong>Paste a grant key</strong>
              <div class="muted small">In JobTread: Settings, Integrations, API, Grants. It is shown once, so copy it before you close the box. It is kept on the server and never sent to a phone.</div>
              <div class="who-add">
                <input id="jtKey" type="password" placeholder="paste it here" autocomplete="off">
                <button class="btn" id="jtSave">Save</button>
              </div>
            </div>
          </div>

          <div class="step" id="stepOrg">
            <div class="step-n">2</div>
            <div class="step-b">
              <strong>Check it works</strong>
              <div class="muted small">Fills the organisation in by itself. Nothing to look up.</div>
              <button class="btn-ghost" id="jtProbe">Check the connection</button>
              <div id="jtProbeOut"></div>
            </div>
          </div>

          <div class="step" id="stepField">
            <div class="step-n">3</div>
            <div class="step-b">
              <strong>Make the link field</strong>
              <div class="muted small">A text field on Job called Inventory Job ID. It is the only way JobTread can tell whether a job has already been matched, so without it the same emergency job can be linked twice.</div>
              <button class="btn-ghost" id="jtField">Find or create it</button>
              <div id="jtFieldMsg"></div>
            </div>
          </div>

          <div class="step" id="stepStatus">
            <div class="step-n">4</div>
            <div class="step-b">
              <strong>Say which field means won</strong>
              <div class="muted small">JobTread has no real job status. Yours is a text option somebody typed. Match it wrong and it returns nothing at all, which looks exactly like a quiet week.</div>
              <button class="btn-ghost" id="jtFields">Show me the fields</button>
              <div id="jtFieldOut"></div>
            </div>
          </div>

          <div class="step" id="stepVendor">
            <div class="step-n">5</div>
            <div class="step-b">
              <strong>Pick the internal A&amp;M vendor</strong>
              <div class="muted small">Shop consumption goes across as a bill from A&amp;M to A&amp;M, flagged so it never reaches QuickBooks. Pick the account it comes from.</div>
              <div class="who-add">
                <select id="jtVend"><option value="">not set</option></select>
                <button class="btn-ghost" id="jtVendLoad">Load vendors</button>
              </div>
            </div>
          </div>
        </div>
        <p class="muted small">Keys die after three months of no use, not three months of age. A connection that only runs quarterly will stop working on its own.</p>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Waiting to be matched</h2>
          <p class="muted">Emergency work started here at 2am. The office creates the real job in JobTread anyway, because restoration cannot be billed without one. Match them here and everything logged over the weekend goes across.</p></div>
          <button class="btn" id="jtPull">Pull jobs from JobTread</button></div>
        ${unlinked.length ? unlinked.map(j => `
          <div class="find-row">
            <div><strong>${esc(jobLabel(j.id))}</strong><div class="muted small">${esc(j.address || '')} · started ${esc(fmtWhen(j.createdAt))} by ${esc(j.createdBy || '')}</div></div>
            <div><select class="jt-pick" data-id="${esc(j.id)}"><option value="">not matched yet</option></select></div>
          </div>`).join('')
        : '<p class="clear-note">Nothing is waiting. Every job here has a JobTread job against it.</p>'}
      </div>

      <div class="panel">
        <h2>Recent pushes</h2>
        <div id="jtLog" class="muted">Nothing yet.</div>
      </div>
    </div>`;
  };

  AM.after['#/link'] = async function () {
    const state = $('#jtState');
    let jtJobs = [];

    const post = (body) => fetch('/api/jobtread', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body)
    }).then(r => r.json());

    const mark = (id, done) => { const el = $('#' + id); if (el) el.classList.toggle('done', !!done); };

    const load = async () => {
      try {
        const s = await fetch('/api/jobtread').then(r => r.json());
        state.textContent = s.connected
          ? `Connected${s.organizationId ? ', organisation ' + s.organizationId : ''}.`
          : 'Not connected yet. Start at step one.';
        mark('stepKey', s.connected);
        mark('stepOrg', !!s.organizationId);
        mark('stepField', !!s.inventoryIdFieldId);
        mark('stepStatus', !!(s.statusFieldId && s.wonOption));
        mark('stepVendor', !!s.internalVendorId);
        if (s.internalVendorId && $('#jtVend').options.length <= 1) {
          $('#jtVend').innerHTML = `<option value="${esc(s.internalVendorId)}" selected>${esc(s.internalVendorId)}</option>`;
        }
        $('#jtLog').innerHTML = (s.recent || []).length
          ? s.recent.map(e => `<div class="ev-row"><span class="ev-t">${esc(fmtWhen(e.at))}</span><span class="ev-d">${esc(e.action || '')} ${esc(e.error || e.result || e.documentId || '')}</span></div>`).join('')
          : 'Nothing yet.';
      } catch (e) { state.textContent = 'Could not reach the server.'; }
    };
    load();

    $('#jtSave').onclick = async () => {
      const key = $('#jtKey').value.trim();
      if (!key) { AM.toast('Paste the key first', 'warn'); return; }
      const res = await post({ action: 'saveKey', grantKey: key });
      $('#jtKey').value = '';
      AM.toast(res.ok ? 'Saved. Now check it works.' : (res.error || 'Did not save'), res.ok ? 'ok' : 'bad');
      load();
    };

    $('#jtProbe').onclick = async () => {
      const out = $('#jtProbeOut');
      out.innerHTML = '<p class="muted small">Asking JobTread…</p>';
      const res = await post({ action: 'probe' });
      if (res.error) { out.innerHTML = `<p class="bad small">${esc(res.error)}</p>`; return; }
      out.innerHTML = res.organizationId
        ? `<p class="good-line">Connected to ${esc(res.organizationName || res.organizationId)}.</p>`
        : `<p class="bad small">JobTread answered, but the key was refused. A dead key and a wrong key look the same from here, so if it was working before, make a new one.</p>`;
      load();
    };

    $('#jtField').onclick = async () => {
      const out = $('#jtFieldMsg');
      out.innerHTML = '<p class="muted small">Looking…</p>';
      const res = await post({ action: 'ensureField' });
      if (res.id) {
        out.innerHTML = `<p class="good-line">${res.created ? 'Created it.' : 'Already there.'}</p>`;
      } else if (res.manual) {
        out.innerHTML = `<p class="bad small">${esc(res.manual)}</p>`;
      } else {
        out.innerHTML = `<p class="bad small">${esc(res.error || 'Could not do that one.')}</p>`;
      }
      load();
    };

    $('#jtVendLoad').onclick = async () => {
      const res = await post({ action: 'vendors' });
      if (res.error) { AM.toast(res.error, 'bad'); return; }
      const sel = $('#jtVend');
      sel.innerHTML = '<option value="">not set</option>' +
        (res.vendors || []).map(v => `<option value="${esc(v.id)}">${esc(v.name)}</option>`).join('');
      AM.toast(`${(res.vendors || []).length} vendors`);
      sel.onchange = async () => {
        await post({ action: 'saveKey', internalVendorId: sel.value });
        AM.toast('Set');
        load();
      };
    };

    /* This answers the one question in the spec that nothing can be built
       around. JobTread has no native job status. What A&M calls won is a text
       string somebody typed into an option list. Guess the string wrong and the
       query returns nothing at all, which looks exactly like a quiet week. */
    $('#jtFields').onclick = async () => {
      $('#jtFieldOut').innerHTML = '<p class="muted">Asking JobTread…</p>';
      const res = await post({ action: 'fields' });
      if (res.error) { $('#jtFieldOut').innerHTML = `<p class="bad">${esc(res.error)}</p>`; return; }
      $('#jtFieldOut').innerHTML = `<table class="tbl"><thead><tr><th>Field</th><th>Options</th><th></th></tr></thead><tbody>
        ${(res.fields || []).map(f => `<tr><td><strong>${esc(f.name)}</strong><div class="muted small">${esc(f.type || '')}</div></td>
          <td class="small">${(f.options || []).map(o => esc(o.name)).join(', ') || '<span class="muted">could not read them</span>'}</td>
          <td><button class="btn-ghost pick-status" data-f="${esc(f.id)}">Use this as status</button></td></tr>`).join('')}
      </tbody></table>`;

      $$('.pick-status').forEach(b => b.onclick = async () => {
        const f = (res.fields || []).find(x => x.id === b.dataset.f);
        const opts = f.options || [];
        // If their options came back readable, pick from them. If not, type it,
        // because a wrong string returns nothing at all rather than an error.
        AM.modal(`<h3>Which option means won?</h3>
          ${opts.length
            ? `<div class="who-list">${opts.map(o => `<button class="who-pick" data-o="${esc(o.name)}">${esc(o.name)}</button>`).join('')}</div>`
            : `<p class="muted small">The options for this field could not be read, so type it exactly as it appears in JobTread. Capital letters and spaces matter.</p>
               <div class="who-add"><input id="wonTyped" placeholder="e.g. Won" autocomplete="off"><button class="btn" id="wonGo">Set</button></div>`}`,
          el => {
            $$('.who-pick', el).forEach(x => x.onclick = async () => {
              await post({ action: 'saveKey', statusFieldId: f.id, wonOption: x.dataset.o });
              AM.closeModal(); AM.toast('Set. Won jobs will pull through now.');
              load();
            });
            const g = $('#wonGo', el);
            if (g) g.onclick = async () => {
              const v = $('#wonTyped', el).value.trim();
              if (!v) return;
              await post({ action: 'saveKey', statusFieldId: f.id, wonOption: v });
              AM.closeModal(); AM.toast('Set. Pull jobs to check it returns something.');
              load();
            };
          });
      });
    };

    $('#jtPull').onclick = async () => {
      const r = await fetch('/api/jobtread', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ action: 'jobs' }) });
      const res = await r.json();
      if (res.error) { AM.toast(res.error, 'bad'); return; }
      jtJobs = res.jobs || [];
      $$('.jt-pick').forEach(sel => {
        sel.innerHTML = '<option value="">not matched yet</option>' +
          jtJobs.filter(j => !j.closed).map(j => `<option value="${esc(j.id)}">${esc((j.number || '') + ' ' + j.name)} ${esc(j.address || '')}</option>`).join('');
        sel.onchange = async () => {
          if (!sel.value) return;
          const local = S.catalog.jobs.find(x => x.id === sel.dataset.id);
          const r2 = await fetch('/api/jobtread', {
            method: 'POST', headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ action: 'linkJob', jobtreadJobId: sel.value, inventoryJobId: local.id })
          });
          const res2 = await r2.json();
          if (res2.error) { AM.toast(res2.error, 'bad'); return; }
          local.jobtreadId = sel.value;
          await AM.saveCatalog();
          AM.toast('Matched. Cost from this job can go across now.');
          AM.render();
        };
      });
      AM.toast(`${jtJobs.length} jobs pulled`);
    };
  };

  /* ------------------------------------------------------------- settings --- */

  AM.screens['#/setup'] = function () {
    const st = S.catalog.settings || {};
    return `
    <div class="wrap wide">
      <div class="panel">
        <h2>Set up once, then left alone</h2>
        <p class="muted">The tabs along the top are the work. Everything that gets set up once lives here.</p>
        <div class="setup-links">
          <a class="setup-link" href="#/sheet"><strong>The shelf, as a spreadsheet</strong><span>out to Excel and back in again</span></a>
          <a class="setup-link" href="#/labels"><strong>Printable labels</strong><span>QR stickers for machines and shelf edges</span></a>
          <a class="setup-link ${S.conn.jobtread ? 'done' : ''}" href="#/link"><strong>JobTread</strong>
            <span>${S.conn.jobtread ? 'connected, and job matching' : 'not connected yet'}</span></a>
        </div>
      </div>

      <div class="panel">
        <h2>Everything the shop holds</h2>
        <p class="muted">Every machine and every material the app knows about.</p>
        ${AM.why('A&M’s own master spreadsheet and the material price list were built into the app, and the shop’s live list was filled from them. The two can drift apart when a new version of the app ships carrying something new, which is the only thing the last button below is for. It only ever adds what is missing, and it never touches a count, a minimum or anything anybody has written.', 'Where this list came from')}
        <div class="stat-row">
          <div class="stat"><b>${S.catalog.units.length}</b><span>machines</span></div>
          <div class="stat"><b>${S.catalog.stock.length}</b><span>shelf items</span></div>
          <div class="stat" id="seedStat"><b>—</b><span>in this version of the app</span></div>
        </div>
        <div class="row">
          <a class="btn" href="#/add">Add gear or materials</a>
          <a class="btn-ghost" href="#/sheet">Count the shelf in Excel</a>
          <button class="btn-ghost" id="seedPull">Bring in anything new from the master list</button>
        </div>
      </div>

      ${(() => {
        /* Two lists built by different people meet here: the shelf we grew off
           Hazmasters invoices, and the material price list the estimators keep.
           Where a line might be the same thing under two names, somebody who
           knows the shelf says so. It is never decided in code. */
        const dup = S.catalog.stock.filter(x => x.maybeSameAs);
        if (!dup.length) return '';
        return `<div class="panel">
          <h2>${dup.length} might be the same thing twice</h2>
          <p class="muted">Same thing means one line, one count. Different means two. Nobody but the shop can tell.</p>
          ${AM.groupFolds(dup, x => x.group || 'Materials', x => {
            const o = S.catalog.stock.find(y => y.id === x.maybeSameAs) || {};
            return `<div class="find-row">
              <div><strong>${esc(x.name)}</strong><span class="line-id">${esc(x.id)}</span>
                <div class="muted small">already on the shelf: ${esc(o.name || x.maybeSameAs)} <span class="line-id">${esc(x.maybeSameAs)}</span></div></div>
              <div class="row tight">
                <button class="btn-ghost dupSame" data-id="${esc(x.id)}">Same thing</button>
                <button class="btn-ghost dupDiff" data-id="${esc(x.id)}">Different</button>
              </div></div>`;
          })}
        </div>`;
      })()}

      <div class="panel">
        <h2>Who can use it</h2>
        <p class="muted">Add a person, issue them a PIN, and every movement carries their name.</p>
        ${AM.why('There are no permission levels inside the app. If somebody has it, they have all of it. The control is at the point of handing it over, and every movement carries a name so a mistake can be traced back and put right rather than argued about. This list is also temporary: people belong to HR, and once HR is connected this reads from there instead, so a name is added once and every system knows. Nothing here is the master record.')}
        ${AM.anyPins() ? '' : `<div class="panel note">
          <h2>Sign-in is not switched on yet</h2>
          <p>Until somebody here has a PIN, the app still works the old way: a name picked off a list, which anybody can pick. Issue the first PIN below and from then on nobody gets in without their own four digits.</p>
        </div>`}
        ${(() => {
          /* Names that were only ever typed in to try the thing out can come
             straight off the list. A name that has actually done something
             cannot, because the log says "Zach took NEG-44 to the Park job" and
             deleting Zach would leave that sentence pointing at nobody. Those
             go quiet instead, and fold away out of the daily list. */
          const did = new Set(S.events.map(e => e.by).filter(Boolean));
          const all = S.catalog.users || [];
          const here = all.filter(u => u.active !== false);
          const gone = all.filter(u => u.active === false);
          const row = u => {
            const used = did.has(u.name);
            return `<div class="user-row">
              <div><strong>${esc(u.name)}</strong>
                <div class="muted small">${u.pin && u.pin.hash
                  ? 'PIN issued' + (u.pinSetAt ? ' ' + esc(fmtWhen(u.pinSetAt)) : '') + (u.pinSetBy ? ' by ' + esc(u.pinSetBy) : '')
                  : 'no PIN yet, cannot sign in'}${used ? ' · has movements against this name' : ' · has never done anything in the app'}</div></div>
              <div class="row tight">
                <button class="btn-ghost upin" data-n="${esc(u.name)}">${u.pin && u.pin.hash ? 'Reset the PIN' : 'Issue a PIN'}</button>
                <button class="btn-ghost utog" data-n="${esc(u.name)}">${u.active === false ? 'Turn back on' : 'Take access away'}</button>
                ${used ? '' : `<button class="btn-ghost udel" data-n="${esc(u.name)}">Remove</button>`}
              </div>
            </div>`;
          };
          return `<div class="user-list">${here.map(row).join('') || '<p class="muted">Nobody on the list yet.</p>'}</div>
            ${gone.length ? `<details class="grp-fold">
              <summary><span class="grp">No longer here</span><span class="grp-tally">${gone.length}</span></summary>
              <div class="user-list">${gone.map(row).join('')}</div>
            </details>` : ''}`;
        })()}
        <div class="who-add"><input id="uNew" placeholder="Add somebody"><button class="btn" id="uAdd">Add</button></div>
        ${AM.why('A PIN is shown once, here, when it is issued. Nobody can read it back afterwards, including this screen, so if somebody forgets theirs it gets reset rather than looked up. On their own phone they can put a fingerprint behind it the first time they sign in.', 'What happens when somebody forgets their PIN')}
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>Who you buy from</h2>
        <p class="muted">Add a supplier in JobTread, then refresh here.</p></div>
        <button class="btn" id="vPull">Refresh from JobTread</button></div>

        <div class="muted small">
          ${vendorList().length
            ? `${vendorList().length} suppliers${S.catalog.vendorsAt ? ', last read ' + esc(fmtWhen(S.catalog.vendorsAt)) : ''}${S.catalog.vendorsFrom ? ' from ' + esc(S.catalog.vendorsFrom) : ''}.`
            : 'Nothing yet. Press refresh.'}
        </div>

        ${vendorList().length ? `<details class="grp-fold">
          <summary><span class="grp">The suppliers themselves</span>
          <span class="grp-tally">${vendorList().length}</span></summary>
          <div class="vend-list">
          ${vendorList().slice(0, 400).map(v => {
            const used = S.catalog.stock.filter(s => s.vendorId === v.id).length;
            return `<div class="vend-row"><span>${esc(v.name)}</span>
              <span class="muted small">${used ? used + ' item' + (used === 1 ? '' : 's') : ''}</span></div>`;
          }).join('')}
          </div>
        </details>` : ''}

        ${AM.why('This is a copy of JobTread’s supplier list, kept here only so the shop still works with no signal. JobTread owns it, so do not keep a list here by hand: two lists means one of them is wrong and nobody can tell which. The only thing this app owns is which supplier each shelf item is bought from, because JobTread has no idea your shelf exists.', 'Why this list is a copy and not the real one')}
      </div>

      <div class="panel">
        <h2>Numbers the app works off</h2>
        <div class="grid2">
          <label class="fld">Bags in a full asbestos bin<input id="sBags" type="number" value="${st.bagsPerBin || 600}"></label>
          <label class="fld">Cost of one certificate test<input id="sDop" type="number" value="${st.dopCostPerUnit || 50}"></label>
          <label class="fld">Days between tests while running<input id="sIn" type="number" value="${st.dopDaysInService || 30}"></label>
          <label class="fld">Days between tests while sitting<input id="sIdle" type="number" value="${st.dopDaysIdle || 365}"></label>
          <label class="fld">Minutes idle before a phone locks<input id="sLock" type="number" value="${st.lockMinutes || 60}"></label>
        </div>
        <button class="btn" id="sSave">Save</button>
      </div>

      <div class="panel">
        <div class="panel-head"><div><h2>QuickBooks</h2>
        <p class="muted" id="qState">Checking…</p></div></div>
        <p class="muted small">Read only. It reads what an item last cost and who it came from, and it cannot change anything.</p>
        ${AM.why('JobTread already sends vendor bills and expenses into the same QuickBooks file. If this app posted the same purchases too, every one would be counted twice, margin would read worse than it is, and one payment would sit against two payables.', 'Why it never writes')}

        <div class="setup" id="qbSetup">
          <div class="step">
            <div class="step-n">1</div>
            <div class="step-b">
              <strong>Reuse the Intuit app you already have</strong>
              <div class="muted small">The one behind the financial console. In Netlify, on this site, set two environment variables: <code>QBO_CLIENT_ID</code> and <code>QBO_CLIENT_SECRET</code>, copied from that app. Do not send them to anybody, including me.</div>
            </div>
          </div>
          <div class="step">
            <div class="step-n">2</div>
            <div class="step-b">
              <strong>Add this address to that Intuit app</strong>
              <div class="muted small">Its list of allowed redirect addresses. Copy it exactly.</div>
              <div class="who-add">
                <input id="qbRedirect" readonly value="">
                <button class="btn-ghost" id="qbCopy">Copy</button>
              </div>
              <div class="muted small">Then set that same address as <code>QBO_REDIRECT_URI</code> in Netlify.</div>
            </div>
          </div>
          <div class="step">
            <div class="step-n">3</div>
            <div class="step-b">
              <strong>Sign in once</strong>
              <div class="row"><a class="btn" href="/api/qbo?action=connect">Connect QuickBooks</a>
              <button class="btn-ghost" id="qPrices">Pull what things last cost</button>
              <button class="btn-ghost" id="qOff">Disconnect</button></div>
            </div>
          </div>
        </div>
      </div>

      <div class="panel">
        <h2>This phone</h2>
        <div class="muted small">
          Running ${esc(S.version || 'an unknown build')}.
          Signed in as ${esc(S.me || 'nobody')}.
          ${S.outbox.length} movement${S.outbox.length === 1 ? '' : 's'} waiting to reach the office.
          ${S.events.length} known.
          Storage ${S.storagePersisted ? 'is protected' : 'is not protected, so add the app to the home screen'}.
          ${S.installed ? 'Installed to the home screen.' : 'Running in a browser tab. Anything waiting can be thrown away after a week like this.'}
        </div>
        <div class="row">
          <button class="btn-ghost" id="pSync">Sync now</button>
          <button class="btn-ghost" id="pTour">Run the walkthrough again</button>
        </div>
        <p class="muted small">The walkthrough puts anything you do during it on a job called Walkthrough practice, so nothing lands on real work.</p>
      </div>
    </div>`;
  };

  AM.after['#/setup'] = function () {
    $$('.utog').forEach(b => b.onclick = async () => {
      const u = S.catalog.users.find(x => x.name === b.dataset.n);
      u.active = u.active === false;
      await AM.saveCatalog(); AM.render();
    });
    /* Taking a name off for good. Only offered where nothing in the log carries
       that name, and it still asks, because the one thing worse than a test
       name on the list is a real person quietly disappearing off it. */
    $$('.udel').forEach(b => b.onclick = async () => {
      const name = b.dataset.n;
      if (S.events.some(e => e.by === name)) {
        AM.toast('That name has movements against it now, so it stays. Take its access away instead.', 'warn');
        return;
      }
      if (name === S.me) { AM.toast('That is the name this phone is signed in as.', 'warn'); return; }
      AM.modal(`
        <h3>Remove ${esc(name)}?</h3>
        <p class="muted small">Nothing in the app was ever done under this name, so there is nothing to lose. It comes straight off the list.</p>
        <div class="row"><button class="btn big" id="udYes">Remove ${esc(name)}</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Keep it</button></div>
      `, el => {
        $('#udYes', el).onclick = async () => {
          S.catalog.users = S.catalog.users.filter(x => x.name !== name);
          await AM.saveCatalog();
          AM.closeModal();
          AM.toast(name + ' is off the list.');
          AM.render();
        };
      });
    });

    $('#uAdd').onclick = async () => {
      const n = $('#uNew').value.trim(); if (!n) return;
      if ((S.catalog.users || []).some(x => x.name.toLowerCase() === n.toLowerCase())) {
        AM.toast('That name is already on the list.', 'warn'); return;
      }
      S.catalog.users.push({ id: AM.uid(), name: n, active: true });
      $('#uNew').value = '';
      await AM.saveCatalog(); AM.render();
    };

    /* Issuing a PIN. Four digits, shown once, and what is kept is a scramble of
       it rather than the number itself, so nobody who opens this file later can
       read anybody's PIN back out of it. */
    /* What ships inside this version of the app, against what the shop is
       running. Read from the file rather than assumed, so the number is the
       truth even when somebody has been editing. */
    (async () => {
      const st = $('#seedStat');
      if (!st) return;
      try {
        const seed = window.AM_SEED || await (await fetch('seed.json', { cache: 'no-store' })).json();
        const newUnits = seed.units.filter(u => !S.catalog.units.some(x => x.id === u.id)).length;
        const newStock = seed.stock.filter(u => !S.catalog.stock.some(x => String(x.id) === String(u.id))).length;
        st.innerHTML = `<b>${newUnits + newStock}</b><span>${newUnits + newStock ? 'not in your list yet' : 'nothing missing'}</span>`;
        if (newUnits + newStock) st.classList.add('warn');

        /* A button whose only job is to tell you it has nothing to do is a
           button that should not be on the screen. When there is nothing to
           bring across, say so in words instead, and say what the sentence
           actually means, because "the master list" means nothing to anybody
           who was not there when it was built. */
        const sp2 = $('#seedPull');
        if (sp2) {
          const n = newUnits + newStock;
          if (!n) {
            sp2.outerHTML = `<span class="muted small">Everything the app was built with is already on the shop's list. This is not about counting: it only means nothing new arrived in the last update.</span>`;
          } else {
            sp2.textContent = `Bring in the ${n} the app knows about and your list does not`;
          }
        }
      } catch (e) { st.innerHTML = '<b>—</b><span>could not read it</span>'; }
    })();

    const sp = $('#seedPull');
    if (sp) sp.onclick = async () => {
      sp.disabled = true; sp.textContent = 'Reading…';
      try {
        const seed = window.AM_SEED || await (await fetch('seed.json', { cache: 'no-store' })).json();
        const addU = seed.units.filter(u => !S.catalog.units.some(x => x.id === u.id));
        const addS = seed.stock.filter(u => !S.catalog.stock.some(x => String(x.id) === String(u.id)));
        if (!addU.length && !addS.length) { AM.toast('Nothing missing. Your list already has all of it.'); sp.disabled = false; sp.textContent = 'Bring in anything new from the master list'; return; }
        S.catalog.units.push(...addU);
        S.catalog.stock.push(...addS);
        await AM.saveCatalog();
        AM.toast(`Added ${addU.length} machine${addU.length === 1 ? '' : 's'} and ${addS.length} shelf item${addS.length === 1 ? '' : 's'}. Nothing was overwritten.`);
        AM.render();
      } catch (e) {
        AM.toast('Could not read the list that ships with the app.', 'bad');
        sp.disabled = false; sp.textContent = 'Bring in anything new from the master list';
      }
    };

    /* Same thing: the invoice line keeps the shelf, and the price list's
       suppliers move onto it, because the prices are the half the old line
       never had. */
    $$('.dupSame').forEach(b => b.onclick = async () => {
      const x = S.catalog.stock.find(y => y.id === b.dataset.id);
      const keep = S.catalog.stock.find(y => y.id === (x || {}).maybeSameAs);
      if (!x || !keep) return;
      keep.prices = (keep.prices && keep.prices.length ? keep.prices : []).concat(x.prices || []);
      if (keep.price == null && x.price != null) { keep.price = x.price; keep.vendor = keep.vendor || x.vendor; }
      S.catalog.stock = S.catalog.stock.filter(y => y.id !== x.id);
      await AM.saveCatalog();
      AM.toast(`One line now: ${keep.name}, with the supplier prices on it.`);
      AM.render();
    });

    $$('.dupDiff').forEach(b => b.onclick = async () => {
      const x = S.catalog.stock.find(y => y.id === b.dataset.id);
      if (!x) return;
      delete x.maybeSameAs; delete x.maybeScore;
      await AM.saveCatalog();
      AM.render();
    });

    $$('.upin').forEach(b => b.onclick = () => {
      const u = S.catalog.users.find(x => x.name === b.dataset.n);
      if (!u) return;
      const suggested = String(Math.floor(1000 + Math.random() * 9000));
      AM.modal(`
        <h3>${u.pin && u.pin.hash ? 'Reset' : 'Issue'} a PIN for ${esc(u.name)}</h3>
        <p class="muted small">Four digits. Tell ${esc(u.name.split(' ')[0])} in person, and this is the only time it is shown. ${u.pin && u.pin.hash ? 'Resetting it also drops the fingerprint on whatever phone they were using, so they sign in again from scratch.' : ''}</p>
        <label class="fld">PIN<input id="pnVal" inputmode="numeric" maxlength="4" value="${suggested}"></label>
        <div class="row"><button class="btn big" id="pnGo">Set it</button>
        <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
      `, el => {
        $('#pnGo', el).onclick = async () => {
          const v = String($('#pnVal', el).value || '').trim();
          if (!/^\d{4}$/.test(v)) { AM.toast('Four digits.', 'warn'); return; }
          if (/^(\d)\1{3}$/.test(v) || v === '1234' || v === '0000') {
            AM.toast('Pick something that is not the first thing anybody would try.', 'warn'); return;
          }
          const salt = AM.newSalt();
          u.id = u.id || AM.uid();
          u.pin = { salt, hash: await AM.pinHash(v, salt) };
          u.pinSetAt = AM.nowISO();
          u.pinSetBy = S.me || '';
          await AM.saveCatalog();
          AM.closeModal();
          AM.modal(`
            <h3>${esc(u.name)}: ${esc(v)}</h3>
            <p class="muted small">Write it nowhere. Tell them, watch them sign in once, and it is done. This is the last time it is readable.</p>
            <button class="btn big" onclick="AM.closeModal()">Done</button>
          `);
          AM.render();
        };
      });
    });
    /* Reads JobTread's list and replaces ours with it. Anything a shelf item is
       already pointed at is matched across by name, so re-reading does not
       quietly unhook sixty four items. */
    const vPull = $('#vPull');
    if (vPull) vPull.onclick = async () => {
      vPull.disabled = true;
      vPull.textContent = 'Reading…';
      try {
        const res = await fetch('/api/jobtread', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'vendors' })
        }).then(r => r.json());

        if (res.error) { AM.toast(res.error, 'bad'); return; }
        const fresh = res.vendors || [];
        if (!fresh.length) { AM.toast('JobTread returned no suppliers.', 'warn'); return; }

        const oldById = new Map((S.catalog.vendors || []).map(v => [v.id, v.name]));
        const byName = new Map(fresh.map(v => [String(v.name).trim().toLowerCase(), v.id]));
        let rehooked = 0, lost = 0;
        for (const s of S.catalog.stock) {
          if (!s.vendorId) continue;
          if (fresh.some(v => v.id === s.vendorId)) continue;   // already a JobTread id
          const oldName = oldById.get(s.vendorId);
          const match = oldName ? byName.get(String(oldName).trim().toLowerCase()) : null;
          if (match) { s.vendorId = match; rehooked++; }
          else { s.vendorId = null; lost++; }
        }

        S.catalog.vendors = fresh;
        S.catalog.vendorsAt = AM.nowISO();
        S.catalog.vendorsFrom = 'JobTread';
        await AM.saveCatalog();
        AM.toast(`${fresh.length} suppliers from JobTread` +
          (rehooked ? `, ${rehooked} items rematched` : '') +
          (lost ? `, ${lost} need a supplier again` : ''));
        AM.render();
      } catch (e) {
        AM.toast('Could not reach JobTread.', 'bad');
      } finally {
        if (vPull) { vPull.disabled = false; vPull.textContent = 'Refresh from JobTread'; }
      }
    };

    $('#sSave').onclick = async () => {
      S.catalog.settings = S.catalog.settings || {};
      S.catalog.settings.bagsPerBin = parseFloat($('#sBags').value) || 600;
      S.catalog.settings.dopCostPerUnit = parseFloat($('#sDop').value) || 50;
      S.catalog.settings.dopDaysInService = parseFloat($('#sIn').value) || 30;
      S.catalog.settings.dopDaysIdle = parseFloat($('#sIdle').value) || 365;
      S.catalog.settings.lockMinutes = parseFloat($('#sLock').value) || 60;
      await AM.saveCatalog();
    };
    $('#pSync').onclick = () => AM.sync();
    const pt = $('#pTour');
    if (pt) pt.onclick = () => { if (window.TOUR) TOUR.replay(); };

    const redirect = location.origin + '/api/qbo?action=callback';
    const rEl = $('#qbRedirect');
    if (rEl) rEl.value = redirect;
    const cp = $('#qbCopy');
    if (cp) cp.onclick = () => navigator.clipboard.writeText(redirect).then(
      () => AM.toast('Copied'), () => AM.toast('Could not copy on this device', 'bad'));

    $('#qOff').onclick = async () => { await fetch('/api/qbo?action=disconnect'); AM.toast('Disconnected'); };
    $('#qPrices').onclick = async () => {
      const r = await fetch('/api/qbo?action=prices');
      const res = await r.json();
      if (res.error) { AM.toast(res.error, 'bad'); return; }
      AM.toast(`${(res.prices || []).length} purchase lines read`);
    };
    fetch('/api/qbo?action=status').then(r => r.json()).then(s => {
      const el = $('#qState'); if (!el) return;
      el.textContent = s.connected
        ? `Connected to company ${s.realmId}. Read only.`
        : (s.missingEnv && s.missingEnv.length ? `Not set up yet. Missing: ${s.missingEnv.join(', ')}` : 'Not connected yet.');
    }).catch(() => {});
  };

})();
