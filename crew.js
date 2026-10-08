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

  /* A job by its name, never by its code.
     "NEG-44 is out on INV-20260902-W58" is a true sentence that helps nobody:
     it names the job in a form no one in the shop has ever seen, because the
     code is generated and the crew only ever knew the address. The job list is
     what turns it back into "7825 71 st NW", so when a code does leak through
     to a screen it means the job itself is missing, and saying so plainly is
     more use than printing the code as though it were an answer. */
  function jobLabel(id) {
    if (!id) return 'no job';
    const j = jobById(id);
    if (!j) return 'a job this phone has not got yet';
    const nm = String(j.name || '').trim();
    return ((j.number ? j.number + ' ' : '') + nm).trim() || (j.address || 'unnamed job');
  }
  AM.jobLabel = jobLabel;

  // Same thing, with the code kept for the office, where identifying the exact
  // record matters more than reading nicely.
  function jobLabelFull(id) {
    const j = jobById(id);
    return j ? jobLabel(id) : `${jobLabel(id)} (${id})`;
  }
  AM.jobLabelFull = jobLabelFull;

  function openJobs() {
    return (S.catalog.jobs || []).filter(j => !j.closed)
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
  }

  /* Every job the shop still has to do something about: the open ones, plus any
     job with company gear standing on it, even a closed one and even one whose
     record has gone astray.

     A job used to drop off the shop screen the moment it was closed, and off it
     entirely if its record went missing, while the machines signed out to it
     stayed signed out. The office could see them and the shop could not, and
     there was no screen left anywhere that could bring them back in. Gear out
     is the thing that decides, because gear out is the thing somebody has to go
     and fetch. */
  function jobsToWorkOn() {
    const d = AM.derive();
    const out = [];
    const seen = new Set();
    for (const j of openJobs()) { out.push(j); seen.add(j.id); }
    for (const jobId of d.outstanding.keys()) {
      if (seen.has(jobId)) continue;
      seen.add(jobId);
      const j = jobById(jobId);
      if (j) out.push(j);
      // If it is still missing here, recoverOrphanJobs has not run yet. It will
      // on the next derive, and the job appears then rather than being invented
      // fresh on every redraw.
    }
    return out;
  }
  AM.jobsToWorkOn = jobsToWorkOn;

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

  /* The same row twice over: a line in the running feed inside the camera,
     where it is just confirmation and nothing is tappable, and a line on the
     load list, where it can still be corrected. Only the second one carries
     the buttons. */
  function sessionRow(r, n, scanned, editable) {
    return `<div class="line ${scanned ? '' : 'unscanned'}${editable ? ' editable' : ''}">
      <div class="line-main">
        <strong>${esc(nameOf(r))}</strong>
        <span class="line-id">${esc(r.item.id)}</span>
      </div>
      <div class="line-qty">${r.kind === 'stock' ? esc(AM.qtyLabel(r.item, n)) : esc(qty(n))}</div>
      ${scanned ? '' : '<div class="line-flag">typed in</div>'}
      ${editable ? `<div class="line-fix">
        ${r.kind === 'stock' ? `<button class="ln-fix" data-id="${esc(r.item.id)}">Fix the count</button>` : ''}
        <button class="ln-rm" data-id="${esc(r.item.id)}">Take it off</button>
      </div>` : ''}
    </div>`;
  }

  /* Adds a line, or bumps the one already there.

     A SERIALISED MACHINE IS ONE MACHINE
     Scanning a shelf card twice means two boxes, because there are two boxes,
     and that is exactly what happens when somebody is loading a van. Scanning
     a machine twice does not mean two machines: there is only ever one NEG-44,
     and a camera resting on a tag re-reads it whether anybody meant it to or
     not. So bulk stock adds up and a machine is refused, with a sound of its
     own so nobody thinks the scan missed and tries again. */
  function addLine(r, n, scanned) {
    const existing = session.lines.find(l => l.id === r.item.id);
    if (existing && r.kind === 'unit') {
      AM.beepDup();
      AM.toast(`${nameOf(r)} is already on this load.`, 'warn');
      return;
    }
    if (existing) { existing.qty += n; if (!scanned) existing.scanned = false; }
    else session.lines.push({ id: r.item.id, kind: r.kind, qty: n, scanned: !!scanned });
    AM.beep(true);
    AM.scanFeed(sessionRow(r, n, scanned));
    /* The load list is redrawn HERE, when the line actually changes, rather
       than by whoever called this. Adding off the list asks for a quantity
       first, and the caller was redrawing before that question was answered,
       so the screen kept the old number. Somebody who adds three and still
       reads two adds three again and the job wears six. */
    AM.render();
  }

  /* It is on another job. Not an error and not a refusal: the machine is in
     somebody's hand at a van door, so the app offers the one action that keeps
     the book straight, which is a move. Cost picks up on this job from now and
     the old job's line settles. */
  function alreadyOutModal(r, at) {
    AM.modal(`
      <h3>${esc(nameOf(r))} is signed out to ${esc(jobLabel(at.jobId))}</h3>
      <p class="muted small">It has not come back through the shop. If it is here in front of you, move it across rather than checking it out twice, and ${esc(jobLabel(at.jobId))} stops waiting for it.</p>
      <div class="row"><button class="btn big" id="aoMove">Move it to ${esc(jobLabel(session.jobId))}</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Leave it alone</button></div>
    `, el => {
      $('#aoMove', el).onclick = async () => {
        await AM.record({ type: 'TRANSFER', itemId: r.item.id, fromJobId: at.jobId,
          toJobId: session.jobId, qty: 1, scanned: true });
        AM.closeModal();
        AM.beep(true);
        AM.toast(`Moved off ${jobLabel(at.jobId)}. It is on this job now, so it is not on the list below.`);
      };
    });
  }

  /* THE MANUAL FIX
     The camera is not always right and neither is the man holding it. If three
     beeps went and two boxes went in the van, he has to be able to say two
     without starting the load again. Nothing on this list has reached the book
     yet, so this is an edit and not a movement. Once it is sent, a correction
     is a movement, and that lives on the tear down screen. */
  function fixLineModal(id) {
    const l = session.lines.find(x => x.id === id);
    const r = findItem(id);
    if (!l || !r) return;
    const step = partialOK(r.item) ? 0.25 : 1;
    AM.modal(`
      <h3>${esc(nameOf(r))}</h3>
      <p class="muted small">On the list: ${esc(qty(l.qty))}${r.item.uom ? ' ' + esc(r.item.uom) : ''}. Set it to what actually went in the van.</p>
      <label class="fld">How many<input id="lnN" type="number" inputmode="decimal" step="${step}" min="0" value="${l.qty}"></label>
      <div class="row"><button class="btn big" id="lnGo">Set it</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
    `, el => {
      const go = () => {
        let v = parseFloat($('#lnN', el).value);
        if (!isFinite(v) || v < 0) { AM.toast('Put a number in.', 'warn'); return; }
        v = Math.round(v * 100) / 100;
        AM.closeModal();
        if (v === 0) { removeLine(id); return; }
        l.qty = v;
        AM.toast('Set to ' + qty(v));
        AM.render();
      };
      $('#lnGo', el).onclick = go;
      const i = $('#lnN', el);
      if (i) { i.onkeydown = e => { if (e.key === 'Enter') go(); };
        setTimeout(() => { i.focus(); i.select && i.select(); }, 60); }
    });
  }

  function removeLine(id) {
    const r = findItem(id);
    session.lines = session.lines.filter(x => x.id !== id);
    AM.toast((r ? nameOf(r) : id) + ' off the list.');
    AM.render();
  }

  /* Bulk stock needs a number. Serialised machines never do: one code, one
     machine, and asking for a quantity would only slow the scan down. */
  function askQty(r, then) {
    const inc = r.item.increments && r.item.increments.length ? r.item.increments : null;
    const pk = AM.packOf(r.item);
    AM.modal(`
      <h3>${esc(nameOf(r))}</h3>
      <p class="muted">How many ${esc(AM.uomWord(r.item.uom, 2))}?${r.item.shelf ? ' · ' + esc(r.item.shelf) : ''}</p>
      ${pk ? `<p class="muted small">One ${esc(AM.uomWord(r.item.uom, 1))} is ${pk.size} ${esc(pk.piece)}.</p>` : ''}
      <div class="pad">
        ${[1, 2, 3, 4, 5, 6, 8, 10, 12, 20, 25, 50].map(n => `<button class="pad-n" data-q="${n}">${n}</button>`).join('')}
      </div>
      <div class="pad-row">
        <input id="qFree" type="number" inputmode="decimal" step="${AM.stepFor ? AM.stepFor(r.item) : 0.25}" min="0" placeholder="${partialOK(r.item) ? 'Other, part of one is fine' : 'Other'}">
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

  /* `after` runs once this code has actually been dealt with, which for
     anything on the shelf means after the quantity has been answered. The
     camera used to be reopened by the caller the instant this returned, so it
     came up underneath the quantity pad and the man was typing into a box with
     a live camera behind it. */
  function handleCode(code, scanned, after) {
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
      /* Already out. One machine cannot be on two jobs at once, and sending it
         out a second time puts it out twice in the book while leaving a line
         standing open on the job it never came back from. Same job is a plain
         double scan and is simply refused. A different job is a real machine
         standing on a real site, so it is offered as a move, which settles the
         old job's line the way a return would. */
      if (at && at.where === 'job') {
        AM.beepDup();
        if (!session || at.jobId === session.jobId) {
          AM.toast(`${nameOf(r)} is already signed out to ${jobLabel(at.jobId)}.`, 'warn');
          return;
        }
        alreadyOutModal(r, at);
        return;
      }
    }
    if (r.kind === 'stock') askQty(r, n => { addLine(r, n, scanned); if (after) after(); });
    else { addLine(r, 1, scanned); if (after) after(); }
  }

  /* The pick list. It exists because one man on the phone while another pulls
     off the shelf is genuinely faster, and taking it away would just move the
     work back to paper. It is one tap behind the camera, and everything added
     through it is marked so the shop can see how much of the day never got
     scanned. That is the whole guard rail. */
  /* What this shop actually reaches for. Scored off its own history rather
     than a guess: everything that has been checked out or asked for, weighted
     so the last month counts for more than last year, but nothing that has
     ever been used drops to nothing. */
  function useScore() {
    const now = Date.now();
    const m = new Map();
    for (const e of S.events) {
      if (e.type !== 'ISSUE' && e.type !== 'REQUEST') continue;
      if (!e.itemId) continue;
      const days = Math.max(0, (now - new Date(e.at).getTime()) / 86400000);
      const w = days <= 30 ? 3 : days <= 90 ? 1.5 : 1;
      m.set(e.itemId, (m.get(e.itemId) || 0) + w);
    }
    return m;
  }
  AM.useScore = useScore;

  const TOP_USED = 12;
  const PL_MAX = 40;          // rows on screen at once; nobody scrolls past this

  /* WHY THIS LIST IS BUILT ONCE AND NOT ON EVERY KEYSTROKE
     There are 756 things on the master list. This used to rebuild all 756
     wrapper objects, walk the whole event log to score them, lower-case every
     name, sort the lot and then hang a click handler on each of sixty rows,
     and it did all of that again on every letter typed. On a shop phone that
     is a list which appears to hang, so the man taps it again, or backs out and
     comes in again, and lands back at the start. Exactly as reported.

     Now the searchable index is built once and kept until the master list
     itself changes, typing is debounced so a fast typist causes one redraw
     rather than nine, and the rows share a single handler on their container
     instead of one each. */
  let plIndex = null;
  let plStamp = '';

  function pickIndex() {
    const stamp = `${S.catalog.stock.length}:${S.catalog.units.length}:${S.events.length}`;
    if (plIndex && plStamp === stamp) return plIndex;
    const score = useScore();
    const build = (item, kind) => ({
      id: item.id, kind, item,
      name: kind === 'unit' ? `${item.name} ${item.unitNo || ''}`.trim() : item.name,
      hay: `${item.name} ${item.id} ${item.group || ''} ${item.model || ''}`.toLowerCase(),
      score: score.get(item.id) || 0
    });
    plIndex = [
      ...S.catalog.stock.map(s => build(s, 'stock')),
      ...S.catalog.units.map(u => build(u, 'unit'))
    ].sort((a, b) => b.score - a.score);   // sorted once, so no sort per keystroke
    plStamp = stamp;
    return plIndex;
  }

  function pickList(onPick) {
    const rows = pickIndex();
    AM.modal(`
      <h3>Pick it off the list</h3>
      <p class="muted small">Anything added this way is marked, so the shop can see what never got scanned.</p>
      <input id="plq" class="search" placeholder="Type a few letters" autocomplete="off">
      <div class="pl-list" id="plList"></div>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
    `, el => {
      const list = $('#plList', el);

      // What a one of it actually is, right on the row, so nobody has to guess
      // whether a 1 means one glove or one box of a hundred.
      const rowHtml = r => {
        const unit = r.kind === 'stock' ? AM.uomLabel(r.item, 1) : '';
        return `<button class="pl-row" data-id="${esc(r.id)}">
          <span>${esc(r.name)}${unit ? ` <em class="pl-uom">per ${esc(unit)}</em>` : ''}</span>
          <span class="line-id">${esc(r.id)}</span>
        </button>`;
      };

      const draw = q => {
        const t = q.trim().toLowerCase();
        if (t) {
          // Already in the shop's own order, so the thing they pull every day is
          // the first line rather than the twelfth. No sorting needed here.
          const hits = [];
          for (const r of rows) {
            if (r.hay.includes(t)) { hits.push(r); if (hits.length >= PL_MAX) break; }
          }
          list.innerHTML = hits.map(rowHtml).join('') || '<div class="muted pad-y">Nothing matches that.</div>';
        } else {
          const used = rows.filter(r => r.score > 0).slice(0, TOP_USED);
          const usedIds = new Set(used.map(r => r.id));
          const rest = rows.filter(r => !usedIds.has(r.id)).slice(0, PL_MAX);
          list.innerHTML =
            (used.length ? `<div class="pl-head">What this shop pulls most</div>` + used.map(rowHtml).join('') : '') +
            (rest.length ? `<div class="pl-head">Everything else</div>` + rest.map(rowHtml).join('') : '');
        }
      };

      // One handler for the whole list, so a redraw costs nothing to re-wire.
      list.onclick = ev => {
        const b = ev.target.closest('.pl-row');
        if (!b) return;
        AM.closeModal();
        onPick(b.dataset.id);
      };

      draw('');
      let t = null;
      $('#plq', el).oninput = e => {
        const v = e.target.value;
        clearTimeout(t);
        t = setTimeout(() => draw(v), 120);
      };
      setTimeout(() => { const el_ = $('#plq', el); el_ && el_.focus(); }, 60);
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
    // Not just the open ones: anything with company gear standing on it, so a
    // closed job that never gave its machines back is still reachable from here.
    const jobs = jobsToWorkOn();
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
        ${(() => {
          /* WHAT IS COMING, ABOVE WHAT IS HAPPENING
             This lived in the office as "Mobilizing tomorrow", which is the
             wrong place and the wrong horizon. The person who needs it is the
             one standing in the shop deciding what to pull, and by tomorrow it
             is not planning any more, it is a scramble. So it sits above
             Mobilize and Tear down, it looks forward as far as there are dates,
             and the nearest job is at the top because that is the one being
             loaded next.

             It is empty until jobs carry a mobilization date, which is what the
             JobTread link will bring across. Empty is still worth a tile: it
             says what it is for, so it is not a surprise the day it fills. */
          /* THE DATE, ON THE TILE
             This said "next out tomorrow" and left the date itself on the
             screen behind. A date is the thing that gets written on the
             whiteboard and read back down a phone, so it belongs where it can
             be read without opening anything. And the count that matters is how
             many vans leave on that day, not how many jobs have a date on them
             somewhere in the next month. */
          const byDay = mobsByDay();
          const first = byDay[0];
          const total = byDay.reduce((n, g) => n + g.jobs.length, 0);
          return `<a class="tile plan wide ${byDay.length ? '' : 'empty'}" href="#/upcoming">
            <span class="tile-k">${first
              ? `Coming up · ${esc(whenWord(first.days))}, ${esc(AM.dayShort(first.date))}`
              : 'Coming up'}</span>
            <span class="tile-s">${first
              ? `${first.jobs.length} mobilization${first.jobs.length === 1 ? '' : 's'} that day: ${esc(first.jobs.map(x => jobLabel(x.j.id)).slice(0, 3).join(', '))}${first.jobs.length > 3 ? ' and ' + (first.jobs.length - 3) + ' more' : ''}. ${total > first.jobs.length ? (total - first.jobs.length) + ' more further out.' : 'Plan the stock before it is needed.'}`
              : 'jobs with a mobilization date turn up here, broken down by the day they go out on, soonest first, so stock can be pulled before the morning it is wanted'}</span></a>`;
        })()}
        <a class="tile go" href="#/out" data-tour="mobilize"><span class="tile-k">Mobilize</span><span class="tile-s">gear leaving the shop</span></a>
        <a class="tile back" href="#/back" data-tour="teardown"><span class="tile-k">Tear down</span><span class="tile-s">bringing it back</span></a>
        <a class="tile move" href="#/move" data-tour="transfer"><span class="tile-k">Transfer</span><span class="tile-s">site to site</span></a>
        <a class="tile find" href="#/find" data-tour="find"><span class="tile-k">Find</span><span class="tile-s">where is it</span></a>
        <a class="tile in wide" href="#/in" data-tour="arrived"><span class="tile-k">Stock arrived</span><span class="tile-s">put a delivery on the shelves</span></a>
        ${(() => {
          /* What the crews have asked the shop for. It used to shout only on
             the office Today screen, and the office is not the man who pulls
             it. */
          const open = AM.derive().requests.filter(r => !r.filled);
          if (!open.length) return '';
          return `<a class="tile asks wide" href="#/asks">
            <span class="tile-k">${open.length} asked for</span>
            <span class="tile-s">${esc(shopLead())} pulls these and takes them to site</span></a>`;
        })()}
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
            /* A closed job with gear still on it is the one worth shouting
               about: nobody is going back to that site on purpose, so the
               machines sit there until somebody notices. */
            const note = j.recovered ? 'record was rebuilt from the movements, needs an address'
              : j.closed ? 'closed, but gear is still out on it'
              : (j.address || (ph ? ph.name : ''));
            return `<a class="job-row" href="#/back?job=${encodeURIComponent(j.id)}">
              <div><strong>${esc(jobLabel(j.id))}</strong>
                <div class="muted small${j.closed || j.recovered ? ' warn-text' : ''}">${esc(note)}</div></div>
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
          const done = d.requests.filter(r => r.filled && ((r.filled.at || r.at) ? AM.dayISO(r.filled.at || r.at) : '') === today).slice(-3);
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
        const score = useScore();
        const hits = S.catalog.stock
          .filter(s => (s.name + ' ' + s.group).toLowerCase().includes(t))
          .sort((a, b) => (score.get(b.id) || 0) - (score.get(a.id) || 0))
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
          afterTwo: late,
          forWhom: shopLead()          // who in the shop is pulling it
        });
        AM.closeModal();
        AM.toast(late ? 'Sent. It is after two though, so ring the shop as well.' : 'Sent. The shop has it for the morning.', late ? 'warn' : 'ok');
      };
      setTimeout(() => { const el_ = $('#rqWhat', el); el_ && el_.focus(); }, 60);
    });
  }

  /* ---------------------------------------------------------- check out ---- */


  /* THE PRE-MOBILIZATION LIST MOVED TO THE END, ON PURPOSE
     It used to stand in front of the camera: pick a job, and instead of the
     scanner you got a red screen headed "Not confirmed" listing paperwork you
     had not done. At six in the morning, with the van running, that is a wall
     in front of the only thing the man opened the app to do, and the list it is
     quoting is an office job done the day before. Nobody at the van can action
     any of it, so the only real choice it ever offered was the way round it.

     So the camera opens first now. The list is still there, it is still counted
     on the screen while the van is being loaded, and it is put in front of
     somebody at the point where it is genuinely worth a last look, which is
     when the load is finished and about to leave. It never blocks. */
  AM.screens['#/out'] = function () {
    if (!session || session.mode !== 'out') {
      return jobPicker('Mobilize', 'Which job is this going to?', () => {});
    }
    return sessionScreen('Mobilizing to', 'Everything here goes on the job the moment you send it.');
  };

  function openOutScanner() {
    AM.openScanner(code => handleCode(code, true), {
      title: 'Check out to ' + jobLabel(session.jobId),
      hint: 'Scan the machine, or the card on the shelf edge',
      altLabel: 'Cannot scan it',
      onAlt: () => pickList(id => handleCode(id, false, () => openOutScanner())),
      onClose: () => AM.render()
    });
  }

  /* ------------------------------------------------------------- return ---- */

  AM.screens['#/back'] = function () {
    const d = AM.derive();
    const m = /job=([^&]+)/.exec(location.hash);
    const jobId = m ? decodeURIComponent(m[1]) : (session && session.mode === 'back' ? session.jobId : null);

    if (!jobId) {
      return jobPicker('Tear down', 'Which job are you tearing down?',
        id => { location.hash = '#/back?job=' + encodeURIComponent(id); }, jobsToWorkOn);
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
        ${(() => {
          /* Every load already logged on this job, newest first. A running
             total on its own gives a man no way to tell whether the one he
             just entered went on, so he enters it again or decides it did
             not work. The list is the receipt. */
          const loads = S.events.filter(e => e.type === 'WASTE' && e.jobId === jobId).slice(-8).reverse();
          if (!loads.length) return '';
          return `<div class="waste-log">
            <div class="waste-log-head">Loads logged on this job</div>
            ${loads.map(e => `<div class="waste-log-row">
              <span>${e.bags ? esc(qty(e.bags)) + ' bags' : ''}${e.bags && e.trailers ? ' · ' : ''}${e.trailers ? esc(qty(e.trailers)) + ' trailer loads' : ''}</span>
              <span class="muted small">${e.stream === 'clean' ? 'clean demo' : 'asbestos'} · ${esc(fmtWhen(e.at))}${e.by ? ' · ' + esc(e.by) : ''}</span>
            </div>`).join('')}
          </div>`;
        })()}
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
  /* WHY HALF A BOX USED TO COME BACK AS A WHOLE ONE
     This said a part quantity is only possible on a roll or a pail. Everything
     else stepped in whole numbers, and the counter rounded to that step before
     it recorded anything. So a man who opened a pack of ten blades, used two,
     and typed 0.5 had it rounded straight up to 1, and the shop was told the
     whole unopened pack was back on the shelf. The two blades were never
     charged to the job and the count on the shelf was wrong from that moment.

     A pack that has been opened is the normal case, not the exception. So
     anything sold in a pack can come back in part, and it is counted in the
     pieces inside it rather than in decimals of a box, because nobody at a
     bench thinks "nought point eight of a pack". They think "eight blades". */
  /* Anything that gets opened can come back part used. That is every container
     on the shelf, whether or not the master list happens to record how many are
     inside it, plus rolls. An each and a pair move whole, because half a pair
     of gloves is not a thing anybody puts on a shelf. */
  function partialOK(item) {
    return AM.isContainer(item) || !!AM.packOf(item);
  }

  /* Two different numbers, and the difference matters.

     `stepFor` is what the plus and minus buttons move by: it has to be something
     a thumb can get to a sensible answer with. `grainFor` is the smallest amount
     the app will accept at all, and it is only ever used to tidy up what
     somebody has typed.

     They used to be the same number, and that is why a typed half was refused.
     A box of fifty steps by a fiftieth on the buttons, so typing 0.5 got rounded
     to the nearest fiftieth, which is still 0.5, fine. But a box with no stated
     count stepped by one, so a typed 0.5 was rounded straight back up to a whole
     box. The buttons and the keyboard now answer to different rules: the buttons
     stay coarse, and a number typed by a person is respected to the piece, or to
     a hundredth of a container when nobody has said what is inside. */
  function stepFor(item) {
    const p = AM.packOf(item);
    if (p) {
      const one = 1 / p.size;
      // A box of a thousand does not want a thousandth on a button.
      return one < 0.05 ? 0.25 : Math.round(one * 10000) / 10000;
    }
    return partialOK(item) ? 0.25 : 1;
  }
  AM.stepFor = stepFor;

  function grainFor(item) {
    const p = AM.packOf(item);
    /* Exactly one piece, deliberately not rounded. A pack of thirty rounded to
       five places is 0.03333, and thirty of those is 0.9999 of a box, so
       returning every last suit would leave a hair of a line standing open on
       the job forever. The rounding belongs on the answer, once, not on the
       size of the step. */
    if (p) return 1 / p.size;
    return partialOK(item) ? 0.01 : 1;                          // a hundredth of a container
  }
  AM.grainFor = grainFor;

  /* "0.8 packs" said out loud, in the words on the box. */
  function piecesNote(item, n) {
    const p = AM.packOf(item);
    if (!p) return '';
    const pieces = Math.round(n * p.size * 100) / 100;
    return `${AM.qty(pieces)} ${p.piece}`;
  }
  /* Part of one coming back, where there is nothing to count.

     A roll of poly and a jug of Benefect are both perfectly ordinary things to
     bring back half of, and neither contains a number of anything. The old
     version of this told a man "nobody has recorded how many are in one roll",
     which is not information, it is the app admitting it asked itself the wrong
     question. It asks the only question that can be answered by looking at the
     thing: how much of it is left. */
  const PART_ASK = {
    length: 'How much of the roll is coming back? Judge it by eye, a quarter is close enough.',
    liquid: 'How much of it is coming back? Judge it by eye.',
    countable: 'How much of the box is coming back?'
  };

  function partModal(item, maxQty, onSet) {
    const kind = AM.kindOf(item);
    const word = AM.uomWord(item.uom, 1);
    const opts = [[0.25, 'a quarter'], [0.5, 'a half'], [0.75, 'three quarters'], [1, 'all of it']]
      .filter(o => o[0] <= maxQty + 0.0001);
    AM.modal(`
      <h3>${esc(item.name)}</h3>
      <p class="muted small">${esc(PART_ASK[kind] || PART_ASK.countable)} ${AM.qty(maxQty)} ${esc(AM.uomWord(item.uom, maxQty))} went out on this job.</p>
      <div class="pad">
        ${opts.map(o => `<button class="pad-n" data-q="${o[0]}">${esc(o[1])}</button>`).join('')}
      </div>
      <div class="pad-row">
        <input id="ptFree" type="number" inputmode="decimal" step="0.01" min="0" max="${maxQty}" placeholder="Or a number">
        <button class="btn" id="ptGo">Set it</button>
      </div>
      ${kind === 'countable' ? `<p class="muted small">If you know how many are in one ${esc(word)}, tell the office. It counts in real ${esc(AM.packOf(item) ? AM.packOf(item).piece : 'pieces')} after that, for everybody.</p>` : ''}
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
    `, el => {
      const done = v => {
        let k = Math.min(Math.max(0, v), maxQty);
        k = Math.round(k * 100) / 100;
        AM.closeModal();
        onSet(k);
      };
      $$('.pad-n', el).forEach(b => b.onclick = () => done(parseFloat(b.dataset.q) * (maxQty >= 1 ? 1 : maxQty)));
      $('#ptGo', el).onclick = () => {
        const v = parseFloat($('#ptFree', el).value);
        if (!isFinite(v) || v <= 0) { AM.toast('Put a number in.', 'warn'); return; }
        done(v);
      };
      setTimeout(() => { const i = $('#ptFree', el); i && i.focus(); }, 60);
    });
    return true;
  }

  /* Counting back in pieces. The arithmetic that turns eight blades into
     four fifths of a pack happens here rather than in somebody's head. */
  function piecesModal(item, maxPacks, title, onSet) {
    const p = AM.packOf(item);
    if (!p) return false;
    const maxPieces = Math.round(maxPacks * p.size * 100) / 100;
    AM.modal(`
      <h3>${esc(item.name)}</h3>
      <p class="muted small">${esc(title)} There ${p.size === 1 ? 'is' : 'are'} ${p.size} ${esc(p.piece)} in a ${esc(AM.uomWord(item.uom, 1))}, and ${AM.qty(maxPieces)} ${esc(p.piece)} went out on this job.</p>
      <label class="fld">How many ${esc(p.piece)}<input id="pcN" type="number" inputmode="numeric" step="1" min="0" max="${maxPieces}" value="${maxPieces}"></label>
      <p class="muted small" id="pcEcho"></p>
      <div class="row"><button class="btn big" id="pcGo">Set it</button>
      <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
    `, el => {
      const inp = $('#pcN', el), echo = $('#pcEcho', el);
      const packs = () => {
        let v = parseFloat(inp.value);
        if (!isFinite(v) || v < 0) v = 0;
        if (v > maxPieces) v = maxPieces;
        return Math.round((v / p.size) * 10000) / 10000;
      };
      const show = () => {
        const k = packs();
        echo.textContent = `That is ${AM.qty(k)} of a ${AM.uomWord(item.uom, 1)}. The rest is charged to the job.`;
      };
      inp.oninput = show; show();
      $('#pcGo', el).onclick = () => { const k = packs(); AM.closeModal(); onSet(k); };
      setTimeout(() => { inp.focus(); inp.select && inp.select(); }, 60);
    });
    return true;
  }

  function renderReturnRow(r, jobId) {
    const d = AM.derive();
    const isUnit = d.unitById.has(r.id);
    const item = isUnit ? d.unitById.get(r.id) : d.stockById.get(r.id);
    if (!item) return '';
    const rr = { kind: isUnit ? 'unit' : 'stock', item };

    const pk = isUnit ? null : AM.packOf(item);
    const still = pk ? `${AM.qtyLabel(item, r.still)}` : (isUnit ? qty(r.still) : `${AM.qtyLabel(item, r.still)}`);
    const head = `
      <div class="ret-main">
        <strong>${esc(nameOf(rr))}</strong>
        <span class="line-id">${esc(r.id)}</span>
        <div class="muted small">${esc(still)} still out${r.back ? ' · ' + esc(qty(r.back)) + ' already checked in' : ''}${r.unscanned ? ' · ' + esc(qty(r.unscanned)) + ' was typed in, not scanned' : ''}</div>
        ${pk && Math.abs(r.still - Math.round(r.still)) < 0.0001 ? `<div class="muted small">${esc(piecesNote(item, r.still))} out on the job</div>` : ''}
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
       Nobody has to find a box that was never lost.

       THE NUMBER IN THE BOX NEEDED A SECOND BUTTON
       There was one box and one commit button, "Check in", so the number could
       only ever mean one thing: how much is coming back. Which is fine until
       somebody types the amount they used, because that is the other half of
       the same question and it is just as natural a thing to type. It happened:
       0.75 typed meaning three quarters of a box used, then "Used it all"
       tapped, and the typed number went in the bin while the whole box was
       written off.

       So the box now says what it is counting, and the number has a button for
       each meaning. Type three quarters and tap "Used on the job" and the job
       wears three quarters. Type it and tap "Back on the shelf" and a quarter
       is what the job wears. Neither one guesses, and neither one throws away
       what somebody just typed. */
    const step = stepFor(item);
    return `<div class="ret-row" data-id="${esc(r.id)}">
      ${head}
      <div class="ret-count">
        <button class="stp" data-id="${esc(r.id)}" data-d="-1">&minus;</button>
        <input class="cnt" id="cnt-${esc(r.id)}" type="number" inputmode="decimal"
               step="${step}" min="0" max="${r.still}" value="${r.still}"
               data-step="${step}" data-grain="${grainFor(item)}" data-max="${r.still}"
               aria-label="How many ${esc(AM.uomWord(item.uom, 2))}">
        <button class="stp" data-id="${esc(r.id)}" data-d="1">+</button>
      </div>
      <div class="ret-commit">
        <span class="rc-ask">That many ${esc(AM.uomWord(item.uom, 2))} were&hellip;</span>
        <button class="btn chkin" data-id="${esc(r.id)}" data-job="${esc(jobId)}">Back on the shelf</button>
        <button class="btn alt usedn" data-id="${esc(r.id)}" data-job="${esc(jobId)}">Used on the job</button>
      </div>
      <div class="ret-actions">
        ${pk ? `<button class="inc part" data-id="${esc(r.id)}" data-job="${esc(jobId)}">Count the ${esc(pk.piece)} back</button>`
             : (AM.isContainer(item) ? `<button class="inc part" data-id="${esc(r.id)}" data-job="${esc(jobId)}">Part of a ${esc(AM.uomWord(item.uom, 1))} back</button>` : '')}
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
    /* Read through the one rule that decides what a line means, rather than off
       the raw sums. A box cannot come back and be used up at the same time, and
       this row was the screen saying it had: a quarter of a box back on the
       shelf and the whole box on the job. */
    const st = AM.settled(l);
    const bits = [];
    if (st.back > 0.001) bits.push((isUnit ? qty(st.back) : AM.qtyLabel(item, st.back)) + ' back on the shelf');
    if (st.used > 0.001) bits.push((isUnit ? qty(st.used) : AM.qtyLabel(item, st.used)) + ' used on the job');
    if (st.still > 0.001) bits.push((isUnit ? qty(st.still) : AM.qtyLabel(item, st.still)) + ' still to account for');
    const pk = isUnit ? null : AM.packOf(item);

    return `<div class="ret-row done" data-id="${esc(l.id)}">
      <div class="ret-main">
        <strong>${esc(nameOf(rr))}</strong>
        <span class="line-id">${esc(l.id)}</span>
        <div class="muted small">${esc(bits.join(' · '))}</div>
        ${pk && st.used > 0.001 ? `<div class="muted small">${esc(piecesNote(item, st.used))} charged to the job</div>` : ''}
        ${st.over > 0.001 ? `<div class="muted small warn-text">This line was written off twice. Fix the count and it corrects itself.</div>` : ''}
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
      wireJobPicker(id => { location.hash = '#/back?job=' + encodeURIComponent(id); }, jobsToWorkOn);
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
      // Tidied to the smallest real amount, NOT to whatever the buttons step by.
      const step = parseFloat(inp.dataset.grain) || parseFloat(inp.dataset.step) || 1;
      const max = parseFloat(inp.dataset.max) || 0;
      let v = parseFloat(inp.value);
      if (!isFinite(v) || v < 0) v = 0;
      v = Math.round(v / step) * step;
      if (v > max) v = max;
      /* Four places, not two. A pack of three steps by a third, and rounding a
         third to two places turns three pieces back into 0.99 of a pack, which
         leaves a line open on the job forever over a rounding error. */
      inp.value = Math.round(v * 10000) / 10000;
      return parseFloat(inp.value);
    };

    /* ONE HANDLER FOR THE WHOLE LIST
       Every button down here used to get its own onclick, hung on freshly after
       each redraw, and the screen redraws on every sync and after every check
       in. Two of those selectors overlapped, so whichever ran second quietly
       replaced the first, and "Fix the count" was the one that lost. A button
       that is drawn, looks live and does nothing when tapped is worse than one
       that is not there.

       The list is now read by one listener on the panel itself, matched by what
       the button says it is. Redraws cannot unwire it, two handlers cannot
       fight over the same button, and a button added later is picked up without
       anybody remembering to wire it. */
    /* Hung on the screen's own container, which is thrown away and rebuilt on
       every redraw, so the handler goes with it. Hanging it on #view instead
       would leave a tear down listener running on every other screen in the
       app, because #view has its contents replaced but is never itself
       replaced. The route check is the belt to that pair of braces. */
    const panel = $('#view .wrap') || $('#view');

    const inpFor = id => document.getElementById('cnt-' + id);
    const itemFor = id => AM.derive().stockById.get(id);
    const lineFor = (job, id) => (AM.derive().jobLoad.get(job) || new Map()).get(id);

    panel.onclick = async ev => {
      if (AM.routeOf(location.hash) !== '#/back') return;
      const b = ev.target.closest('button');
      if (!b || !panel.contains(b)) return;
      const id = b.dataset.id, job = b.dataset.job;

      // ---- the counter
      if (b.classList.contains('stp')) {
        const inp = inpFor(id);
        if (!inp) return;
        const step = parseFloat(inp.dataset.step) || 1;
        inp.value = Math.round(((parseFloat(inp.value) || 0) + step * parseFloat(b.dataset.d)) * 10000) / 10000;
        clamp(inp);
        return;
      }

      // ---- counting the pieces inside an opened pack back in
      if (b.classList.contains('part')) {
        const item = itemFor(id);
        const row = (AM.derive().outstanding.get(job) || []).find(x => x.id === id);
        if (!item || !row) return;
        const put = async k => {
          if (k <= 0) { AM.toast('Nothing back, so the job wears it. Use "Used it all".', 'warn'); return; }
          await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: k, scanned: false, toLocation: 'SHOP' });
          AM.beep(true);
          AM.toast(`${AM.qtyLabel(item, k)} back on the shelf. The rest is on the job.`);
        };
        // Counted in pieces where the pack size is known, and in fractions of a
        // container where nobody has recorded it yet.
        if (!piecesModal(item, row.still, 'How much of it is coming back?', put)) {
          partModal(item, row.still, put);
        }
        return;
      }

      // ---- check in what is in the box
      if (b.classList.contains('chkin')) {
        const inp = inpFor(id);
        if (!inp) return;
        const n = clamp(inp);
        if (!n) { AM.toast('Set a count first, or say it was all used.', 'warn'); return; }
        delete inp.dataset.typed;   // consumed, so the redraw is free to reset it
        await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: n, scanned: false, toLocation: 'SHOP' });
        AM.beep(true); AM.buzz();
        const item = itemFor(id);
        AM.toast((item ? AM.qtyLabel(item, n) : qty(n)) + ' back on the shelf. Anything else on the next load carries on from here.');
        return;
      }

      /* ---- the same number, meaning the other thing. Three quarters of a box
         used is an ordinary amount to know and an awkward one to arrive at by
         subtraction, so it is typed and said directly. The job wears exactly
         what was typed, and whatever is left stays open on the line, because
         a quarter of a box unaccounted for is a real quarter of a box. */
      if (b.classList.contains('usedn')) {
        const inp = inpFor(id);
        if (!inp) return;
        const n = clamp(inp);
        const item = itemFor(id);
        if (!n) { AM.toast('Put in how much was used first.', 'warn'); return; }
        delete inp.dataset.typed;
        await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: n, reason: 'used on the job, counted at the van' });
        AM.beep(true); AM.buzz();
        const row = (AM.derive().outstanding.get(job) || []).find(x => x.id === id);
        const left = row ? row.still : 0;
        AM.toast((item ? AM.qtyLabel(item, n) : qty(n)) + ' charged to the job.' +
          (left > 0.001 ? ' ' + (item ? AM.qtyLabel(item, left) : qty(left)) + ' still to account for.' : ' That line is done.'), 'ok');
        return;
      }

      /* ---- correcting a count is another movement, not an edit. A quarter box
         found on the final sweep adds; an over-count subtracts. Either way the
         history still says what happened.

         AND IT CORRECTS WHAT THE JOB WAS CHARGED, WHICH IS THE OTHER HALF
         This wrote the return and stopped, and that is the bug the numbers on
         the screen were showing. One box of gloves went out, the whole box was
         marked used, then the count was corrected to a quarter of a box back on
         the bench. The quarter went back on the shelf correctly and the job was
         still carrying all fifty gloves: a box and a quarter accounted for out
         of a box that went out, the job over-charged by a quarter, and the shop
         count a quarter adrift.

         A box cannot hold more than a box. So the correction now settles the
         whole line: what the person is telling the app is how much is on the
         bench, and whatever is left of what went out is what the job wears. If
         raising the returned amount leaves no room for everything already
         written off, the difference is handed back with a matching correction,
         which is a real movement in the history like every other one, not a
         quiet edit of a number that was already reported. */
      if (b.classList.contains('fix')) {
        const l = lineFor(job, id);
        const item = itemFor(id);
        if (!l || !item) return;
        const pk = AM.packOf(item);
        const st = AM.settled(l);

        const apply = async v => {
          v = Math.min(Math.max(0, v), l.out);
          v = Math.round(v * 10000) / 10000;
          const diff = Math.round((v - l.back) * 10000) / 10000;
          /* What is already written off against the job, and how much room the
             corrected count leaves for it. Anything that does not fit was never
             used, because it is sitting on the bench. */
          const room = Math.round(Math.max(0, l.out - v) * 10000) / 10000;
          const give = Math.round(Math.max(0, (l.consumed || 0) - room) * 10000) / 10000;
          if (!diff && !give) { AM.closeModal(); return; }
          if (diff) {
            await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: diff, scanned: false, correction: true, toLocation: 'SHOP' });
          }
          if (give) {
            await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: -give, correction: true,
              reason: 'counted back on the bench, so the job does not wear it' });
          }
          AM.closeModal();
          const nowUsed = Math.round(Math.max(0, (l.consumed || 0) - give) * 10000) / 10000;
          const stillOpen = Math.round(Math.max(0, l.out - v - nowUsed) * 10000) / 10000;
          AM.toast(AM.qtyLabel(item, v) + ' on the bench, ' +
            (nowUsed > 0.0001 ? AM.qtyLabel(item, nowUsed) + ' charged to the job' : 'nothing charged to the job') +
            (stillOpen > 0.0001 ? ', ' + AM.qtyLabel(item, stillOpen) + ' still to account for' : ''));
        };

        const step = stepFor(item);
        AM.modal(`
          <h3>${esc(item.name)}</h3>
          <p class="muted small">${esc(AM.qtyLabel(item, l.out))} went out on this job.
            ${esc(AM.qtyLabel(item, st.back))} is checked in and
            ${esc(AM.qtyLabel(item, st.used))} is charged to the job.
            Set it to what is actually on the bench and the charge follows.</p>
          ${st.over > 0.0001 ? `<p class="hint warn-hint">This line does not add up: more has been checked in and written off than ever went out. Setting the count straightens it.</p>` : ''}
          <label class="fld">On the bench<input id="fxN" type="number" inputmode="decimal" step="${step}" min="0" max="${l.out}" value="${st.back}"></label>
          <p class="muted small" id="fxEcho"></p>
          ${pk ? `<button class="btn-ghost" id="fxPieces">Count the ${esc(pk.piece)} instead</button>` : ''}
          <div class="row"><button class="btn" id="fxGo">Set it</button>
          <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button></div>
        `, el => {
          /* Says the consequence out loud before the button is pressed, because
             the number being typed decides what a job gets charged. */
          const inp = $('#fxN', el), echo = $('#fxEcho', el);
          const show = () => {
            let v = parseFloat(inp.value);
            if (!isFinite(v) || v < 0) { echo.textContent = ''; return; }
            v = Math.min(v, l.out);
            /* Exactly what the button will do, in the same arithmetic it uses.
               A correction can only ever hand back what was written off; it
               never writes anything new off, because the app does not know
               whether what is missing was used or is still standing on the
               site, and guessing that is how a job gets charged for gear that
               comes home on the next load. */
            const rest = Math.round(Math.max(0, l.out - v) * 10000) / 10000;
            const nowUsed = Math.min((l.consumed || 0), rest);
            const open = Math.round((rest - nowUsed) * 10000) / 10000;
            echo.textContent = 'That leaves ' + AM.qtyLabel(item, nowUsed) + ' charged to the job' +
              (open > 0.0001 ? ', and ' + AM.qtyLabel(item, open) + ' still to account for.' : '.');
          };
          inp.oninput = show; show();
          $('#fxGo', el).onclick = () => {
            const v = parseFloat(inp.value);
            if (!isFinite(v) || v < 0) return;
            apply(v);
          };
          const fp = $('#fxPieces', el);
          if (fp) fp.onclick = () => {
            AM.closeModal();
            piecesModal(item, l.out, 'How much of it is on the bench?', k => apply(k));
          };
        });
        return;
      }

      // ---- broken, lost, used up, scrapped, or simply back
      if (b.classList.contains('inc')) {
        const d = AM.derive();
        const isUnit = d.unitById.has(id);
        const row = (d.outstanding.get(job) || []).find(x => x.id === id);
        if (!row) return;
        const f = b.dataset.f;

        /* It came off the site, so the job's line settles. It just does not go
           back on the shelf, because it is broken. */
        if (f === 'repair') { repairModal(id, job); return; }
        if (f === 'missing') { lostModal(id, job); return; }
        /* Used is not lost. A box of coveralls that went out and did not come
           back was worn, and the job should wear the cost rather than the shop
           going looking for it.

           IT NEVER THROWS AWAY A TYPED NUMBER
           "Used it all" means all of what is still out, which is right when the
           box is empty and wrong when somebody has just typed a number into the
           counter above it. That number is not noise, it is the answer to the
           same question said the other way round, and quietly writing off the
           whole box over the top of it is how a job got charged for fifty
           gloves that were sitting back on the shelf. So when a number has been
           typed and it is not the whole amount, the button asks which of the
           two it is rather than picking one. */
        if (f === 'used') {
          const inp = inpFor(id);
          const item = itemFor(id);
          const typed = inp && inp.dataset.typed === '1' ? clamp(inp) : null;
          const allOfIt = async () => {
            await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: row.still, reason: 'used on the job' });
            AM.toast('The job wears all of it. That line is done.');
          };
          if (typed == null || Math.abs(typed - row.still) < 0.0001 || typed <= 0) { await allOfIt(); return; }
          const lbl = n => item ? AM.qtyLabel(item, n) : qty(n);
          AM.modal(`
            <h3>${esc(item ? item.name : id)}</h3>
            <p class="muted small">There is <strong>${esc(lbl(typed))}</strong> in the box above, and
              ${esc(lbl(row.still))} still out on this job. Which is it?</p>
            <div class="who-list">
              <button class="who-pick" id="uaUsed"><strong>${esc(lbl(typed))} was used on the job</strong>
                <span class="muted small">the job wears that much, ${esc(lbl(Math.round((row.still - typed) * 10000) / 10000))} stays open</span></button>
              <button class="who-pick" id="uaBack"><strong>${esc(lbl(typed))} came back on the shelf</strong>
                <span class="muted small">the job wears the other ${esc(lbl(Math.round((row.still - typed) * 10000) / 10000))}, and the line closes</span></button>
              <button class="who-pick" id="uaAll"><strong>All ${esc(lbl(row.still))} of it was used</strong>
                <span class="muted small">ignore the number above, nothing is coming back</span></button>
            </div>
            <button class="btn-ghost" onclick="AM.closeModal()">Cancel</button>
          `, el => {
            const done = () => { if (inp) delete inp.dataset.typed; AM.closeModal(); AM.beep(true); AM.buzz(); };
            $('#uaUsed', el).onclick = async () => {
              done();
              await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: typed, reason: 'used on the job, counted at the van' });
              AM.toast(lbl(typed) + ' charged to the job.');
            };
            $('#uaBack', el).onclick = async () => {
              const rest = Math.round((row.still - typed) * 10000) / 10000;
              done();
              await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: typed, scanned: false, toLocation: 'SHOP' });
              if (rest > 0.0001) {
                await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: rest, reason: 'the rest was used on the job' });
              }
              AM.toast(lbl(typed) + ' back on the shelf, ' + lbl(rest) + ' charged to the job.');
            };
            $('#uaAll', el).onclick = async () => { done(); await allOfIt(); };
          });
          return;
        }
        if (f === 'scrap') {
          // Below half does not go back on the shelf. It goes in the scrap box,
          // which sits outside the count on purpose, and the job wears it.
          await AM.record({ type: 'CONSUME', itemId: id, jobId: job, qty: row.still, reason: 'under half, scrap box' });
          AM.toast('Put it in the scrap box. The job wears it.');
          return;
        }
        if (f === '1') {
          const back = isUnit ? Math.min(1, row.still) : row.still;
          await AM.record({ type: 'RETURN', itemId: id, jobId: job, qty: back, scanned: false, toLocation: 'SHOP' });
          AM.beep(true); AM.buzz();
        }
        return;
      }
    };

    $$('.cnt').forEach(inp => inp.onchange = () => clamp(inp));

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
      const bagEl = $('#wBags'), trlEl = $('#wTrl');
      const bags = parseFloat(bagEl.value) || 0;
      const trailers = parseFloat(trlEl.value) || 0;
      if (!bags && !trailers) { AM.toast('Put a number in first.', 'warn'); return; }
      // Emptied before the record, so the redraw that follows does not put the
      // last load back into the boxes and invite it being logged twice.
      AM.clearTyped(bagEl); AM.clearTyped(trlEl);
      await AM.record({ type: 'WASTE', jobId, bags, trailers, stream });
      AM.toast((stream === 'clean' ? 'Clean demo' : 'Asbestos') + ' logged: ' +
        [bags ? bags + ' bags' : '', trailers ? qty(trailers) + ' trailer loads' : ''].filter(Boolean).join(', '));
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
      setTimeout(() => { const el_ = $('#inQty', el); el_ && el_.focus(); }, 60);
    });
  }

  AM.screens['#/in'] = function () {
    const today = AM.dayISO();
    const mine = S.events.filter(e => e.type === 'RECEIVE' && (e.at ? AM.dayISO(e.at) : '') === today).slice(-12).reverse();
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
          <div class="find-where ${lowFlag ? 'bad' : ''}">${n == null ? '<span class="muted">not counted</span>' : esc(AM.qtyLabel(s, n))}
          ${n == null && d.movedSince.get(s.id) ? `<div class="muted small">${esc(AM.qtyLabel(s, d.movedSince.get(s.id)))} gone out since</div>` : ''}
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
              : a.where === 'repair' ? 'OUT OF SERVICE'
              /* The job by its name, and said as a sentence. "INV-20260902-W58"
                 is not an answer to "where is it", and it was what this column
                 printed whenever the job record had gone missing. */
              : 'Signed out to ' + jobLabel(a.jobId);
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
          AM.toast('Signed out to ' + jobLabel(at.jobId) + '. Pull it in on tear down.', 'warn');
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

  function jobPicker(title, question, onPick, source) {
    const jobs = (source || openJobs)();
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

  function wireJobPicker(onPick, source) {
    const list = $('#jpList');
    const more = $('#jpMore');
    let open = false;

    const draw = () => {
      if (!list) return;
      const t = (($('#jpq') || {}).value || '').trim().toLowerCase();
      const d = AM.derive();
      let jobs = (source || openJobs)();
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
      setTimeout(() => { const el_ = $('#njName', el); el_ && el_.focus(); }, 60);
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

    return `
    <div class="wrap">
      <div class="panel">
        <div class="panel-head">
          <div><h2>${esc(title)} ${esc(jobLabel(session.jobId))}</h2><p class="muted">${esc(note)}</p></div>
          <button class="btn" id="ssScan">Scan more</button>
        </div>
        ${hint ? `<button class="hint" id="ssWhy">A job this shape usually takes ${esc(hint)}. <span class="hint-more">why</span></button>` : ''}
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
          return r ? sessionRow(r, l.qty, l.scanned, true) : '';
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
        openOutScanner();     // straight to the camera, every time
      });
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
    $('#ssList').onclick = () => pickList(id => handleCode(id, false, () => AM.render()));
    $('#ssCancel').onclick = () => { session = null; AM.render(); };
    $$('.ln-fix').forEach(b => b.onclick = () => fixLineModal(b.dataset.id));
    $$('.ln-rm').forEach(b => b.onclick = () => removeLine(b.dataset.id));
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

      /* THE PRE-MOBILIZATION LIST IS OUT OF THIS FLOW ENTIRELY
         It has been moved twice and asked to be gone twice, so it is gone. It
         stood in front of the camera first, then in front of the send button,
         and neither is the right place: the list it quotes is a desk job done
         the day before by somebody in the office, nobody at the van can action
         a line of it, and the list itself is not finished being written. A gate
         built on a draft, standing in front of the only thing the man opened
         the app to do, teaches exactly one habit and it is tapping past it.

         So there is no gate now. Loading the van sends the load to the job and
         that is the whole of it. The office still walks its own list on its own
         screen, which is where that paperwork lives. */

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

  /* ------------------------------------------------------- what is coming --
     Every open job carrying a mobilization date, nearest first. Nothing is
     filtered out for being far away: a job three weeks out is exactly the one
     worth knowing about while there is still time to order for it, and that is
     the whole point of the screen. Anything already gone is dropped, because a
     date in the past is not a plan.

     It fills from whatever puts dates on jobs. Today that is the office, by
     hand; once JobTread is linked it will be the schedule coming across. The
     screen does not care which. */
  function upcomingMobs() {
    const today = AM.dayISO();
    return (S.catalog.jobs || [])
      .filter(j => !j.closed && j.mobDate && j.mobDate >= today)
      .map(j => ({ j, days: AM.daysBetween(today, j.mobDate) }))
      .sort((a, b) => a.days - b.days || String(a.j.name).localeCompare(String(b.j.name)));
  }
  AM.upcomingMobs = upcomingMobs;

  /* ONE HEADING PER DAY, NOT ONE LONG LIST
     Nearest first was already right and still was not enough to plan a morning
     from. Three jobs going out tomorrow read as three separate panels each
     saying "tomorrow", and how many vans leave on Tuesday is the actual
     question anybody is asking this screen. So the days are the structure: one
     heading per date, in order, carrying its own count, and the jobs sit under
     the day they go out on. A day with three mobilizations says so once, at the
     top, where it can be read at a glance. */
  function mobsByDay() {
    const out = [];
    for (const row of upcomingMobs()) {
      const last = out[out.length - 1];
      if (last && last.date === row.j.mobDate) last.jobs.push(row);
      else out.push({ date: row.j.mobDate, days: row.days, jobs: [row] });
    }
    return out;
  }
  AM.mobsByDay = mobsByDay;

  function whenWord(days) {
    if (days <= 0) return 'today';
    if (days === 1) return 'tomorrow';
    if (days < 7) return `in ${days} days`;
    if (days < 14) return 'next week';
    return `in ${Math.round(days / 7)} weeks`;
  }

  /* "Tomorrow, Tue Sep 8" — the relative word for how soon, and the date
     itself, because a date is what gets written on a whiteboard and read back
     down a phone. Both, always, so neither has to be worked out. */
  function dayHeading(date, days) {
    const w = whenWord(days);
    const stamp = AM.dayShort(date);
    return w.charAt(0).toUpperCase() + w.slice(1) + ' · ' + stamp;
  }

  AM.screens['#/upcoming'] = function () {
    const byDay = mobsByDay();
    if (!byDay.length) {
      return `<div class="wrap"><div class="panel">
        <h2>Nothing is booked to go out</h2>
        <p class="muted">No open job has a mobilization date on it, so there is nothing to plan against yet. Put a date on a job in the office and it turns up here straight away, under the day it goes out on, with the nearest day at the top.</p>
        ${AM.why('This screen is for the person deciding what to pull off the shelf this week, not for the person loading the van this morning. It looks as far ahead as there are dates, so a job that needs forty rolls of poly is known about while there is still time to order them, rather than at six on the morning it goes out.')}
        <a class="btn-ghost" href="#/">Back to the shop</a>
      </div></div>`;
    }

    const d = AM.derive();
    const total = byDay.reduce((n, g) => n + g.jobs.length, 0);
    const first = byDay[0];

    return `
    <div class="wrap">
      <div class="panel">
        <h2>Coming up</h2>
        <p class="muted">Next out <strong>${esc(whenWord(first.days))}, ${esc(AM.dayWords(first.date))}</strong>${first.jobs.length > 1 ? ` — ${first.jobs.length} mobilizations that day` : ''}.</p>
        <p class="muted small">${total} job${total === 1 ? '' : 's'} with a date on ${total === 1 ? 'it' : 'them'}, across ${byDay.length} day${byDay.length === 1 ? '' : 's'}, soonest first. What each one usually takes is worked out from its shape, so the shelf can be checked before the morning it is wanted.</p>
      </div>
      ${byDay.map(g => `
      <div class="up-day ${g.days <= 1 ? 'soon' : ''}">
        <div class="up-day-head">
          <h3>${esc(dayHeading(g.date, g.days))}</h3>
          <span class="up-day-n">${g.jobs.length} mobilization${g.jobs.length === 1 ? '' : 's'}</span>
        </div>
        ${g.jobs.map(({ j }) => {
          const suggest = window.SOP.suggest(j, S.catalog) || [];
          const pull = j.pullList || [];
          const ph = window.SOP.phase(j.division, j.phase);
          return `<div class="panel up-job">
            <div class="panel-head">
              <div>
                <h2>${esc(jobLabel(j.id))}</h2>
                <p class="muted small">${esc(j.address || (ph ? ph.name : ''))}</p>
              </div>
            </div>

            ${suggest.length ? `<h4 class="grp">What a job this shape usually takes</h4>
            <div class="up-need">
              ${suggest.map(s => `<div class="up-need-row ${s.assumed ? 'guess' : ''}">
                <span><strong>${esc(String(s.count))}</strong> &times; ${esc(s.group.toLowerCase())}</span>
                <span class="muted small">${esc(s.why)}</span>
              </div>`).join('')}
            </div>
            <p class="muted small">A starting point off the job's own containment type and area, not an order. The crew pulls what the job actually needs.</p>`
            : `<p class="muted small">No containment type or area on this job yet, so there is nothing to work a quantity out from. The office fills those in on the job detail screen and this fills itself in.</p>`}

            ${pull.length ? `<h4 class="grp">On the estimate</h4>
            <div class="up-need">
              ${pull.slice(0, 12).map(l => {
                const s = l.itemId ? d.stockById.get(l.itemId) : null;
                const have = s ? d.onHand.get(s.id) : null;
                const short = s && have != null && have < (l.qty || 0);
                return `<div class="up-need-row ${short ? 'short' : ''}">
                  <span><strong>${esc(qty(l.qty || 0))}</strong> ${esc(l.uom || '')} ${esc(l.name)}</span>
                  <span class="muted small">${s
                    ? (have == null ? 'not counted on the shelf' : `${esc(AM.qtyLabel(s, have))} on the shelf${short ? ' · short' : ''}`)
                    : 'nothing on the shelf matched this line'}</span>
                </div>`;
              }).join('')}
            </div>` : ''}

            <div class="row">
              <a class="btn" href="#/out">Load this one</a>
            </div>
          </div>`;
        }).join('')}
      </div>`).join('')}
    </div>`;
  };

  /* --------------------------------------------------- pre-mobilization ---- */

  /* The crew-side pre-mobilization screen has been taken out with the gate that
     fed it. There is one list, it is a desk job, and it lives on the office
     screens where the paperwork is actually done. Nothing in the shop links
     here any more, so the screen went rather than being left orphaned. */

  /* -------------------------------------------------------------- asks ---- */

  /* Who in the shop pulls what the crews ask for. Set once in Settings. */
  function shopLead() {
    const st = S.catalog.settings || {};
    if (st.shopLead) return st.shopLead;
    const users = (S.catalog.users || []).filter(u => u.active !== false);
    const max = users.find(u => String(u.name).toLowerCase() === 'max');
    return max ? max.name : (users[0] ? users[0].name : 'the shop');
  }
  AM.shopLead = shopLead;

  AM.screens['#/asks'] = function () {
    const d = AM.derive();
    const open = d.requests.filter(r => !r.filled);
    const today = AM.dayISO();
    const done = d.requests.filter(r => r.filled && ((r.filled.at || r.at) ? AM.dayISO(r.filled.at || r.at) : '') === today);

    const byJob = new Map();
    for (const r of open) {
      if (!byJob.has(r.jobId)) byJob.set(r.jobId, []);
      byJob.get(r.jobId).push(r);
    }

    return `
    <div class="wrap">
      <div class="panel">
        <div class="panel-head">
          <div><h2>${open.length ? open.length + ' thing' + (open.length === 1 ? '' : 's') + ' to pull' : 'Nothing outstanding'}</h2>
          <p class="muted">${esc(shopLead())} pulls these and takes them to site. In by two o'clock and it goes out with the morning.</p></div>
          ${open.length ? '<button class="btn" id="askCopy">Copy the list</button>' : ''}
        </div>
        ${AM.why('The manual asks for material requisitions by two o\'clock the day before. This is that list, on the shop screen rather than the office one, because the office is not the person walking the racks.')}
        ${open.length ? [...byJob].map(([jid, rs]) => `<div class="ask-grp">
          <div class="ask-job">${esc(jobLabel(jid))}</div>
          ${rs.map(r => `<div class="find-row">
            <div><strong>${esc(qty(r.qty || 1))} &times; ${esc(r.text)}</strong>
              <div class="muted small">asked by ${esc(r.by || '')} · ${esc(fmtWhen(r.at))}${r.afterTwo ? ' · after two' : ''}${r.itemId ? '' : ' · typed in words, not on the shelf list'}</div></div>
            <div class="find-where">
              ${r.afterTwo ? '<span class="cert due">after two</span>' : ''}
              <button class="btn ask-fill" data-id="${esc(r.id)}">Pulled</button></div>
          </div>`).join('')}
        </div>`).join('') : '<p class="clear-note">Every ask has been pulled. Nothing is waiting on the shop.</p>'}
      </div>

      ${done.length ? `<div class="panel">
        <h2>Pulled today</h2>
        <div class="ret-list settled">${done.map(r => `<div class="ret-row done">
          <div class="ret-main"><strong>${esc(qty(r.qty || 1))} &times; ${esc(r.text)}</strong>
            <div class="muted small">${esc(jobLabel(r.jobId))} · pulled by ${esc((r.filled && r.filled.by) || '')}</div></div>
        </div>`).join('')}</div>
      </div>` : ''}

      <div class="panel">
        <div class="panel-head"><div><h2>Ask for something</h2>
        <p class="muted small">For a job going out tomorrow.</p></div>
        <button class="btn" id="askNew">Ask the shop</button></div>
      </div>
    </div>`;
  };

  AM.after['#/asks'] = function () {
    const nb = $('#askNew');
    if (nb) nb.onclick = () => requestModal();

    /* Pulled is a movement, not a tick, exactly as it is on the office screen:
       it leaves the shelf and lands on the job, or the numbers say the poly is
       still in the rack while it is going out the door on a truck. */
    $$('.ask-fill').forEach(b => b.onclick = async () => {
      const d = AM.derive();
      const r = d.requests.find(x => x.id === b.dataset.id);
      await AM.record({ type: 'REQUEST_FILLED', requestId: b.dataset.id });
      if (r && r.itemId) {
        await AM.record({ type: 'ISSUE', itemId: r.itemId, jobId: r.jobId, qty: r.qty || 1, scanned: false, fromRequest: r.id });
        AM.toast('Pulled and put on ' + jobLabel(r.jobId) + '. The shelf and the job both moved.');
      } else {
        AM.toast('Marked as pulled. This one was typed in words, so mobilize it onto the job by hand.', 'warn');
      }
      AM.beep(true);
    });

    const cp = $('#askCopy');
    if (cp) cp.onclick = () => {
      const open = AM.derive().requests.filter(r => !r.filled);
      const text = `A&M Abatement Services\nWhat the crews have asked for, ${AM.dayISO()}\nPulling: ${shopLead()}\n\n` +
        open.map(r => `${qty(r.qty || 1)} x ${r.text}\t${jobLabel(r.jobId)}\t${r.by || ''}`).join('\n');
      navigator.clipboard.writeText(text).then(
        () => AM.toast('Copied. Paste it wherever you keep the run sheet.'),
        () => AM.toast('Could not copy on this device.', 'bad')
      );
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
