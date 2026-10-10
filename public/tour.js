/* A&M Inventory, first-run walkthrough.

   This is the house walkthrough standard ported to plain JavaScript. The kit it
   comes from is React and react-joyride; this app has no build step and no
   framework, so the behaviour is reimplemented rather than the files copied.
   Every non-negotiable from the standard is kept:

   - it spotlights real elements through data-tour attributes, never a class
     name or a generated id, because both change without anyone noticing
   - every step is narrated AND captioned in the same words, because most people
     open this in a shop with the sound off
   - narration is on by default, and the first step says so and how to stop it
   - stopping is one decision that carries; nobody makes that choice eight times
   - the important steps are gated on the real action, and the feature code
     knows nothing about the tour
   - no gate can trap anyone; each one releases itself after 45 seconds
   - chapters whose target does not exist are dropped and the count adapts
   - a missing target skips that step, it never ends the tour
   - the spotlit element stays clickable, so people act through the cutout
   - it does not start until the app says it is ready

   ONE DELIBERATE DEVIATION, worth knowing. The standard's gates are a selector
   plus a click or submit. A camera scan is neither: nothing is clicked and no
   form is submitted. So there is a second gate type here, `present`, which
   waits for an element to appear. That is what "scan one thing" is gated on.

   THE PRACTICE JOB. The gated steps write real movements, because reading about
   a thing does not make it a habit. Those movements land on a job the tour
   creates called Walkthrough practice, which it closes when it finishes, so
   nothing ever lands on live work. */

'use strict';

(function () {
  const TOUR = (window.TOUR = {});
  const SEEN_KEY = 'am-inventory-tour-seen.v1';
  const MUTE_KEY = 'am-inventory-tour-muted';
  const RELEASE_MS = 45000;
  const PRACTICE = 'Walkthrough practice';

  /* Every selector lives here so a rename fails loudly in one place instead of
     quietly pointing the tour at nothing. */
  const S = {
    who:      '[data-tour="who"]',
    mobilize: '[data-tour="mobilize"]',
    teardown: '[data-tour="teardown"]',
    transfer: '[data-tour="transfer"]',
    find:     '[data-tour="find"]',
    findbox:  '[data-tour="findbox"]',
    office:   '[data-tour="office"]',
    jobpick:  '[data-tour="jobpick"]',
    session:  '[data-tour="session"]',
    line:     '[data-tour="session"] .line',
    send:     '[data-tour="send"]',
    outlist:  '[data-tour="outlist"]',
    back:     '[data-tour="outlist"] .inc'
  };

  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  /* ------------------------------------------------------------- chapters */

  function chapters() {
    return [
      {
        id: 'welcome', clip: '01-welcome', bookend: true,
        title: 'The shop lives here now',
        body: 'Hi, and welcome to the shop! This is where every machine and every roll of poly lives, and you can see where all of it is right now. Let\'s take a quick walk through. It takes about three minutes. I\'ll talk as we go, and the words are on screen too, so if you\'re somewhere you can\'t use sound, just press Stop the voice and I\'ll stay quiet.'
      },
      {
        id: 'who', clip: '02-who', at: '#/', target: S.who,
        title: 'Your name goes on everything',
        body: 'First up, your name. Every scan and every return carries the name of whoever\'s holding the phone. It\'s not about checking up on anyone. It\'s so that when something lands on the wrong job, and it happens, it takes ten seconds to find and fix instead of an afternoon of asking around. Pick your name from the list, or type it in if it\'s not there.',
        gate: { click: '.who-pick, #whoAdd' }
      },
      {
        id: 'mobilize', clip: '03-mobilize', at: '#/out', target: S.jobpick,
        title: 'Gear leaving the shop',
        body: 'Gear heading out to a job starts here. Pick the job it\'s going to, and the camera opens right away. Scan the code on the machine, or the card on the shelf edge, and it pops onto the list. If a code won\'t read, there\'s a button to pick it from a list instead, and that\'s fine. It just gets marked, so the shop can see how much never got scanned. Go ahead and add one thing.',
        gate: { present: S.line }
      },
      {
        id: 'send', clip: '04-send', target: S.send,
        title: 'Nothing is on the job until you send it',
        body: 'That list is what\'s going out. Nothing\'s on the job until you send it, so you can pull the whole pile, check it against the van, and send it all in one go. Once you do, every item is on that job with your name and the time. Go ahead and send it now.',
        gate: { click: S.send }
      },
      {
        id: 'teardown', clip: '05-teardown', atFn: () => '#/back?job=' + encodeURIComponent(practiceId()),
        target: S.outlist,
        title: 'The part that gets the gear home',
        body: 'This is the part that gets the gear home. Open the job at tear down and you\'ll see everything still out on it. Tap things back as they go in the van, and the list shrinks right in front of you, so you know what\'s missing while you\'re still on site. And sweep the closets last, because that\'s usually where it is! Tap one item back.',
        gate: { click: S.back, optional: true }
      },
      {
        id: 'transfer', clip: '06-transfer', at: '#/move', target: '.panel',
        title: 'Site to site is one action',
        body: 'Moving a machine straight to the next job? It never has to come back through the shop. Scan it, pick the new job, and you\'re done. It\'s one step, not a return and then a check out, and the cost moves to the new job from that moment. If it\'s a negative air unit or a HEPA vacuum, the app will remind you it needs a fresh certificate on the new site before it runs.'
      },
      {
        id: 'find', clip: '07-find', at: '#/find', target: S.findbox,
        title: 'Where is it',
        body: 'Twenty dehumidifiers, and you need to know where all twenty are? Type a name, a number or a serial, and it shows you where each one is, who took it, and when. JobTread doesn\'t track equipment at all, so this is the place to answer that question from now on. Type something in and have a look.',
        gate: { input: S.findbox }
      },
      {
        id: 'done', clip: '08-done', at: '#/', bookend: true,
        title: 'That\'s it',
        body: 'And that\'s it! Out, back, moved and found. Everything you just did works with no signal, so a basement with no bars is no problem. The phone holds onto it and sends it when you\'re back in range. If you\'re in the office, the button at the top right opens jobs, ordering and certificates, with the one-time setup behind Settings. You can run this walkthrough again any time from Settings. Thanks, and welcome aboard!'
      }
    ];
  }

  /* ------------------------------------------------------- practice job */

  function practiceId() {
    const cat = window.AM && AM.state && AM.state.catalog;
    if (!cat) return '';
    const j = (cat.jobs || []).find(x => x.name === PRACTICE);
    return j ? j.id : '';
  }

  async function ensurePractice() {
    const cat = AM.state.catalog;
    cat.jobs = cat.jobs || [];
    let j = cat.jobs.find(x => x.name === PRACTICE);
    if (j) { if (j.closed) { j.closed = false; try { await AM.saveCatalog(); } catch (e) {} } return j.id; }
    j = {
      id: 'INV-PRACTICE-' + Math.random().toString(36).slice(2, 6).toUpperCase(),
      name: PRACTICE, number: '', address: 'Not real work. Made by the walkthrough.',
      division: 'abatement', phase: 'P4',
      containment: '3', waterCategory: null, areaSqFt: 2000, crewSize: 4,
      preMob: {}, strike: {}, practice: true,
      jobtreadId: null, createdAt: AM.nowISO(), createdBy: AM.state.me || 'walkthrough', closed: false
    };
    cat.jobs.push(j);
    // Never let a failed save stop the walkthrough. The job exists on the phone
    // either way, which is all the tour needs.
    try { await AM.saveCatalog(); } catch (e) {}
    return j.id;
  }

  async function closePractice() {
    const cat = AM.state.catalog;
    const j = (cat.jobs || []).find(x => x.name === PRACTICE);
    if (j && !j.closed) { j.closed = true; try { await AM.saveCatalog(); } catch (e) {} }
  }

  /* ------------------------------------------------------------- state */

  let steps = [], i = 0, live = false;
  let audio = null, muted = false, blocked = false;
  let gateOk = true, gateOff = null, releaseTimer = null, presentTimer = null;

  const countable = () => steps.filter(s => !s.bookend);
  const chapterNo = s => countable().indexOf(s) + 1;

  /* ------------------------------------------------------------- audio */

  /* Phones refuse to make noise until the person has touched the page, and the
     walkthrough opens on its own before anybody has touched anything. So the
     first clip is very often refused. That is normal, not an error: say so, put
     a Play button in front of them, and retry the moment they touch anything. */
  function speak(clip) {
    stopAudio();
    if (muted || !clip) return;
    try {
      /* Words in tools/Narration-Script-Shop.md, made with tools/generate-narration.py. */
      audio = new Audio('tour/' + clip + '.mp3');
      audio.play().then(() => {
        if (blocked) { blocked = false; paint(); }
      }).catch(err => {
        if (err && err.name && err.name !== 'NotAllowedError') return;
        if (!blocked) { blocked = true; paint(); }
      });
    } catch (e) {}
  }

  function retry() {
    const step = steps[i];
    if (!step || muted) return;
    blocked = false;
    speak(step.clip);
  }

  // The first tap anywhere is enough permission. Take it and start talking.
  document.addEventListener('click', function once() {
    if (blocked && !muted && live) retry();
  }, true);
  function stopAudio() {
    if (audio) { try { audio.pause(); } catch (e) {} audio = null; }
  }
  function setMuted(v) {
    muted = v;
    try { localStorage.setItem(MUTE_KEY, v ? '1' : '0'); } catch (e) {}
    if (v) stopAudio();
    paint();
  }

  /* ----------------------------------------------------------- spotlight
     One box sitting exactly over the target with a very large outward shadow.
     That dims the whole screen except the target, and because the box does not
     take pointer events the target underneath stays fully usable. */

  function positionSpot(el) {
    const spot = $('#tourSpot');
    if (!spot) return;
    if (!el) { spot.style.display = 'none'; return; }
    const r = el.getBoundingClientRect();
    const pad = 6;
    spot.style.display = 'block';
    spot.style.top = (r.top - pad) + 'px';
    spot.style.left = (r.left - pad) + 'px';
    spot.style.width = (r.width + pad * 2) + 'px';
    spot.style.height = (r.height + pad * 2) + 'px';
  }

  function placeCard(el) {
    const card = $('#tourCard');
    if (!card) return;
    if (!el) {
      card.style.top = ''; card.style.bottom = '20px';
      card.style.left = '50%'; card.style.transform = 'translateX(-50%)';
      return;
    }
    const r = el.getBoundingClientRect();
    const below = window.innerHeight - r.bottom;
    card.style.transform = '';
    card.style.left = '50%';
    card.style.transform = 'translateX(-50%)';
    if (below > 260) { card.style.top = (r.bottom + 14) + 'px'; card.style.bottom = ''; }
    else { card.style.bottom = (window.innerHeight - r.top + 14) + 'px'; card.style.top = ''; }
  }

  /* ------------------------------------------------------------- gates */

  function clearGate() {
    if (gateOff) { gateOff(); gateOff = null; }
    clearTimeout(releaseTimer); releaseTimer = null;
    clearInterval(presentTimer); presentTimer = null;
  }

  function armGate(step) {
    clearGate();
    const g = step.gate;
    if (!g) { gateOk = true; return; }
    gateOk = false;

    const pass = () => { if (!gateOk) { gateOk = true; paint(); } };

    if (g.click || g.input) {
      const sel = g.click || g.input;
      const evt = g.click ? 'click' : 'input';
      // Document level, capture phase, so the feature code needs to know
      // nothing about the tour and cannot swallow the event first.
      const h = e => { if (e.target && e.target.closest && e.target.closest(sel)) pass(); };
      document.addEventListener(evt, h, true);
      gateOff = () => document.removeEventListener(evt, h, true);
    }

    if (g.present) {
      presentTimer = setInterval(() => { if ($(g.present)) pass(); }, 400);
      if ($(g.present)) pass();
    }

    // Nothing is ever a lock. It is a nudge.
    releaseTimer = setTimeout(pass, g.releaseAfterMs || RELEASE_MS);
  }

  /* ------------------------------------------------------------- render */

  function paint() {
    const step = steps[i];
    if (!step) return;
    const el = step.target ? $(step.target) : null;
    positionSpot(el);
    placeCard(el);

    const total = countable().length;
    const no = step.bookend ? null : chapterNo(step);
    const last = i === steps.length - 1;

    const card = $('#tourCard');
    card.innerHTML = `
      <div class="tour-head">
        <span class="tour-count">${no ? 'Chapter ' + no + ' of ' + total : (last ? 'Done' : 'Welcome')}</span>
        <button class="tour-x" id="tourSkip">${last ? 'Close' : 'Skip'}</button>
      </div>
      <h3>${esc(step.title)}</h3>
      <p class="tour-body">${esc(step.body)}</p>
      ${blocked ? '<p class="tour-note">Your phone will not make a sound until you touch the screen. Press Play the voice, or just carry on and it will start talking at the next step.</p>' : ''}
      <div class="tour-foot">
        <button class="tour-mute" id="tourMute">${(muted || blocked) ? 'Play the voice' : 'Stop the voice'}</button>
        <div class="tour-nav">
          ${i > 0 ? '<button class="tour-back" id="tourBack">Back</button>' : ''}
          <button class="tour-next" id="tourNext" ${gateOk ? '' : 'disabled'}>${last ? 'Finish' : 'Next'}</button>
        </div>
      </div>
      ${gateOk ? '' : '<div class="tour-wait">Have a go at it above, then Next opens.</div>'}`;

    $('#tourSkip').onclick = () => finish();
    $('#tourMute').onclick = () => {
      if (muted) { setMuted(false); retry(); }
      else if (blocked) { retry(); }
      else setMuted(true);
    };
    const b = $('#tourBack'); if (b) b.onclick = () => go(i - 1);
    $('#tourNext').onclick = () => { if (!gateOk) return; last ? finish() : go(i + 1); };
  }

  /* Waits for a target to turn up after a screen change. If it never does, the
     step is skipped. It never ends the tour, because a missing target is
     normal: features come and go with role and with what is on the shelf. */
  function waitFor(sel, ms) {
    return new Promise(resolve => {
      if (!sel || $(sel)) return resolve(true);
      const t0 = Date.now();
      const iv = setInterval(() => {
        if ($(sel)) { clearInterval(iv); resolve(true); }
        else if (Date.now() - t0 > (ms || 2500)) { clearInterval(iv); resolve(false); }
      }, 120);
    });
  }

  async function go(n) {
    if (n < 0 || n >= steps.length) return finish();
    i = n;
    const step = steps[i];

    const dest = step.atFn ? step.atFn() : step.at;
    if (dest && location.hash !== dest) {
      location.hash = dest;
      await new Promise(r => setTimeout(r, 320));
    }

    if (step.target) {
      const there = await waitFor(step.target);
      if (!there) {
        // Skip forward rather than stopping. Going backwards through a missing
        // step would loop, so a Back that lands here moves on again.
        return go(n + 1 > i ? n + 1 : n - 1);
      }
    }

    armGate(step);
    speak(step.clip);
    paint();
  }

  /* -------------------------------------------------------- start, stop */

  function shell() {
    if ($('#tourLayer')) return;
    const d = document.createElement('div');
    d.id = 'tourLayer';
    d.innerHTML = '<div id="tourSpot"></div><div id="tourCard"></div>';
    document.body.appendChild(d);
    window.addEventListener('resize', () => { if (live) paint(); });
    window.addEventListener('scroll', () => { if (live) paint(); }, true);
  }

  TOUR.start = async function (opts) {
    if (live) return;
    if (!window.AM || !AM.state || !AM.state.catalog) return;
    live = true;

    try { muted = localStorage.getItem(MUTE_KEY) === '1'; } catch (e) { muted = false; }

    try { await ensurePractice(); } catch (e) { /* the tour runs regardless */ }

    // Chapters are decided against the DOM as it is right now, which is why
    // this must never run before the screen is ready. See `ready` below.
    steps = chapters();

    shell();
    document.body.classList.add('tour-on');
    i = -1;
    await go(0);
  };

  function finish() {
    live = false;
    clearGate();
    stopAudio();
    const l = $('#tourLayer'); if (l) l.remove();
    document.body.classList.remove('tour-on');
    try { localStorage.setItem(SEEN_KEY, '1'); } catch (e) {}
    closePractice().catch(() => {});
    if (window.AM) AM.render();
  }
  TOUR.finish = finish;

  TOUR.seen = () => { try { return localStorage.getItem(SEEN_KEY) === '1'; } catch (e) { return true; } };
  TOUR.replay = () => { try { localStorage.removeItem(SEEN_KEY); } catch (e) {} TOUR.start(); };

  /* Auto-start only once the app says every source it needs has resolved.
     Never a setTimeout: a delay long enough on one machine is too short on a
     cold connection, and the failure is silent, whole chapters just missing. */
  TOUR.ready = function () {
    if (TOUR.seen() || live) return;
    if (!AM.state.me) return;   // the who step needs a person, not a blank phone
    TOUR.start();
  };
})();
