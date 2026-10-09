/* A&M Office Command Centre - the front door.

   One sign-in for the whole app. Everybody starts here: tap your name, type
   your four digits, and the app sends you to the part your role allows.
     owner, office, field leads   the command centre
     crew                         the shop screens
   Who sees what is still decided by the office server on every request; this
   page only decides where to send people first.

   It signs people in exactly the way the shop screens always have, and keeps
   what it learns in the same place on the device (IndexedDB "am-inventory",
   store "kv"), so the shop works as before:
     token     the person's own key for the office server
     session   who is signed in and when they were last active
     role      owner, office, field or crew, as the server said
     mypin     this person's own PIN check, so the next sign-in works with no signal
     bio       the fingerprint or face this device trusts, if they set it up
   The first sign-in on a device needs a bar of signal. After that the same
   person can sign in underground. Every screen locks after an hour idle and
   sends people back here. */
(function () {
  'use strict';
  const LOCK_MIN_DEFAULT = 60;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const NEXT = params.get('next') || '';          // "shop" or "command": where they were when they were sent here
  const AFTER = params.get('h') || location.hash || '';  // a screen inside the shop, for example #/out
  const OUT = params.has('out');

  /* ------------------------------------------------------------ the device */
  let _db = null;
  function db() {
    if (_db) return Promise.resolve(_db);
    return new Promise((res, rej) => {
      const r = indexedDB.open('am-inventory', 1);
      r.onupgradeneeded = () => {
        const d = r.result;
        if (!d.objectStoreNames.contains('kv')) d.createObjectStore('kv');
        if (!d.objectStoreNames.contains('events')) d.createObjectStore('events', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('outbox')) d.createObjectStore('outbox', { keyPath: 'id' });
      };
      r.onsuccess = () => { _db = r.result; res(_db); };
      r.onerror = () => rej(r.error);
    });
  }
  const kv = (mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction('kv', mode), s = t.objectStore('kv'); let q;
    try { q = fn(s); } catch (e) { rej(e); return; }
    t.oncomplete = () => res(q && 'result' in q ? q.result : undefined);
    t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
  }));
  const get = k => kv('readonly', s => s.get(k)).catch(() => undefined);
  const set = (k, v) => kv('readwrite', s => s.put(v, k)).catch(() => {});

  async function sha256(text) {
    const b = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, '0')).join('');
  }
  const nowISO = () => new Date().toISOString();

  /* ---------------------------------------------------------- where to go */
  function goOn(role) {
    const shopScreen = /^#\//.test(AFTER) ? AFTER : '#/';
    if (!role || role === 'crew') return location.replace('/shop.html' + shopScreen);
    if (NEXT === 'shop') return location.replace('/shop.html' + shopScreen);
    if (NEXT === 'command' && /^#[a-z]+$/.test(AFTER)) return location.replace('/command.html' + AFTER);
    location.replace('/command.html');
  }

  /* -------------------------------------------------------------- drawing */
  const card = html => { $('#door').innerHTML = html; };
  function note(t, cls) { const m = $('#msg'); if (m) { m.textContent = t; m.className = 'msg ' + (cls || ''); } }

  async function bioAvailable() {
    try { return !!(window.PublicKeyCredential && await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()); }
    catch (e) { return false; }
  }

  let roster = null, required = false;
  async function loadRoster() {
    if (!navigator.onLine) return;
    try {
      const r = await fetch('/api/auth', { method: 'GET', cache: 'no-store' });
      if (r.ok) { const b = await r.json(); roster = Array.isArray(b.people) ? b.people : null; required = !!b.required; if (required) set('authRequired', true); }
    } catch (e) {}
  }
  async function people() {
    if (roster) return roster;
    const cat = await get('catalog');
    return ((cat && cat.users) || []).filter(u => u && u.active !== false && u.name)
      .map(u => ({ id: u.id || '', name: u.name, hasPin: !!(u.hasPin || (u.pin && u.pin.hash)) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function drawPick() {
    const list = await people();
    const bio = await get('bio'), token = await get('token'), mine = await get('mypin');
    /* The key kept on this device belongs to whoever last signed in with a PIN.
       A fingerprint only opens the app for that same person. */
    const samePerson = !!(bio && mine && ((bio.userId && mine.id === bio.userId) || mine.name === bio.name));
    const hasBio = !!(bio && bio.credId && token && samePerson) && await bioAvailable();
    card(`
      <h1>Sign in</h1>
      <p class="lede">One sign-in for the whole A&amp;M app. Tap your name and type your four digits. You will see the parts of the app your role allows.</p>
      ${hasBio ? `<button class="btn big" id="bioGo">Unlock as ${esc(bio.name)}</button>
        <button class="link" id="bioAlt">Somebody else, or use a PIN</button>` : ''}
      <div class="who ${hasBio ? 'tucked' : ''}" id="whoList">
        ${list.map(u => `<button class="who-pick" data-n="${esc(u.name)}">${esc(u.name)}</button>`).join('') || '<p class="lede">Nobody has been added yet. The office adds people in Settings.</p>'}
      </div>
      <p class="small">${roster ? 'Not on the list? Ask the office to add you, then close and reopen the app.' : 'No signal, so this is the list this device last saw. Somebody added today shows once there is a bar.'}</p>
      <p class="msg" id="msg"></p>`);
    const bg = $('#bioGo');
    if (bg) bg.onclick = async () => {
      bg.disabled = true; bg.textContent = 'Waiting for the device…';
      let ok = false;
      try {
        const id = new Uint8Array(bio.credId.match(/../g).map(h => parseInt(h, 16)));
        ok = !!(await navigator.credentials.get({ publicKey: { challenge: crypto.getRandomValues(new Uint8Array(32)), allowCredentials: [{ type: 'public-key', id }], userVerification: 'required', timeout: 60000 } }));
      } catch (e) { ok = false; }
      bg.disabled = false; bg.textContent = 'Unlock as ' + bio.name;
      if (!ok) { note('That did not match. Use your PIN.', 'bad'); return; }
      const all = await people();
      if (roster && !all.some(u => (bio.userId && u.id === bio.userId) || u.name === bio.name)) { await set('bio', null); note('That person is no longer on the list. Use a PIN.', 'bad'); return; }
      await set('session', { name: bio.name, id: bio.userId || null, at: nowISO(), lastSeen: nowISO() });
      await set('me', bio.name);
      goOn(await get('role'));
    };
    const ba = $('#bioAlt'); if (ba) ba.onclick = () => $('#whoList').classList.remove('tucked');
    document.querySelectorAll('.who-pick').forEach(b => b.onclick = () => {
      const p = list.find(u => u.name === b.dataset.n); if (!p) return;
      if (!roster && !p.hasPin) { note('The office has not issued you a PIN yet.', 'bad'); return; }
      drawPin(p);
    });
  }

  function drawPin(picked) {
    let entry = '';
    card(`
      <h1>${esc(picked.name)}</h1>
      <p class="lede" id="msg">Your four digits.</p>
      <div class="pin-dots" id="dots">${'<span></span>'.repeat(4)}</div>
      <div class="pin-pad">
        ${[1, 2, 3, 4, 5, 6, 7, 8, 9].map(n => `<button class="pin-k" data-k="${n}">${n}</button>`).join('')}
        <button class="pin-k ghost" id="pinBack">Back</button>
        <button class="pin-k" data-k="0">0</button>
        <button class="pin-k ghost" id="pinOther">Not me</button>
      </div>`);
    const dots = () => document.querySelectorAll('#dots span').forEach((s, i) => s.classList.toggle('on', i < entry.length));
    const msg = (t, cls) => { const m = $('#msg'); m.textContent = t; m.className = 'lede ' + (cls || ''); };

    const submit = async () => {
      const f = (await get('pinFail')) || { n: 0, until: 0 };
      if (f.until && Date.now() < f.until) { msg('Too many wrong. Wait a minute.', 'bad'); entry = ''; dots(); return; }
      const wrong = async why => {
        const n = (f.n || 0) + 1;
        await set('pinFail', { n, until: n >= 5 ? Date.now() + 60000 : 0 });
        entry = ''; dots(); msg(why || (n >= 5 ? 'Too many wrong. Wait a minute.' : 'That is not it. Try again.'), 'bad');
      };
      msg('Checking…');
      let ok = false, role = null;
      try {
        const r = await fetch('/api/auth', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: picked.id || picked.name, pin: entry }) });
        const b = await r.json().catch(() => null);
        if (r.ok && b && b.token) {
          await set('token', b.token);
          if (b.pin) await set('mypin', { id: picked.id || '', name: picked.name, ...b.pin });
          if (b.user && b.user.id && !picked.id) picked = { ...picked, id: b.user.id };
          await set('isOffice', !!(b.user && b.user.office));
          role = (b.user && b.user.role) || 'crew';
          await set('role', role);
          ok = true;
        } else if (r.status === 429 || (r.status === 403 && b && b.error === 'nopin') || r.status === 409) {
          entry = ''; dots(); msg((b && b.message) || 'Ask the office.', 'bad'); return;
        }
      } catch (e) {
        /* No signal: only the last person who signed in on this device, with
           the PIN this device was told about the last time it had signal. */
        const mine = await get('mypin');
        const same = mine && ((picked.id && mine.id === picked.id) || mine.name === picked.name);
        if (!same || !mine.salt) { entry = ''; dots(); msg('No signal, and this device has not signed you in before. The first one needs a bar of signal.', 'bad'); return; }
        ok = (await sha256(mine.salt + ':' + entry)) === mine.hash;
        role = await get('role');
      }
      if (!ok) { await wrong(); return; }
      await set('pinFail', { n: 0, until: 0 });
      await set('session', { name: picked.name, id: picked.id || null, at: nowISO(), lastSeen: nowISO() });
      await set('me', picked.name);
      /* Offered once per device, straight after the first PIN. */
      const bio = await get('bio');
      if (!bio && await bioAvailable()) return offerBio(picked, role);
      goOn(role);
    };
    document.querySelectorAll('.pin-k[data-k]').forEach(b => b.onclick = () => {
      if (entry.length >= 4) return;
      entry += b.dataset.k; dots();
      if (entry.length === 4) setTimeout(submit, 80);
    });
    $('#pinBack').onclick = () => { entry = entry.slice(0, -1); dots(); };
    $('#pinOther').onclick = () => drawPick();
  }

  function offerBio(picked, role) {
    card(`
      <h1>Use your fingerprint next time?</h1>
      <p class="lede">This device can unlock the app with the fingerprint or face it already trusts, so you do not type four digits twenty times a day. Nothing about you leaves the device.</p>
      <button class="btn big" id="bioYes">Set it up</button>
      <button class="link" id="bioNo">Not now</button>`);
    $('#bioNo').onclick = () => goOn(role);
    $('#bioYes').onclick = async () => {
      try {
        const cred = await navigator.credentials.create({ publicKey: {
          challenge: crypto.getRandomValues(new Uint8Array(32)), rp: { name: 'A&M Command Centre' },
          user: { id: crypto.getRandomValues(new Uint8Array(16)), name: picked.name, displayName: picked.name },
          pubKeyCredParams: [{ type: 'public-key', alg: -7 }, { type: 'public-key', alg: -257 }],
          authenticatorSelection: { authenticatorAttachment: 'platform', userVerification: 'required' }, timeout: 60000, attestation: 'none' } });
        if (cred) await set('bio', { userId: picked.id || null, name: picked.name, credId: [...new Uint8Array(cred.rawId)].map(x => x.toString(16).padStart(2, '0')).join(''), pinSetAt: '' });
      } catch (e) {}
      goOn(role);
    };
  }

  /* ---------------------------------------------------------------- start */
  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    if (OUT) await set('session', null);
    const [token, session, role, cat] = await Promise.all([get('token'), get('session'), get('role'), get('catalog')]);
    const lockMin = (cat && cat.settings && cat.settings.lockMinutes) || LOCK_MIN_DEFAULT;
    /* Already signed in on this device and used within the hour: straight through. */
    if (!OUT && token && session && role) {
      const idle = (Date.now() - new Date(session.lastSeen || session.at).getTime()) / 60000;
      if (idle <= lockMin) return goOn(role);
    }
    await loadRoster();
    /* Before anybody has a PIN the app is still being set up, which happens on the shop screens. */
    const list = await people();
    if (roster && !required && !list.some(p => p.hasPin)) return location.replace('/shop.html#/');
    if (session) await set('session', null);
    drawPick();
  }
  window.addEventListener('online', () => { if (!roster && document.querySelector('.who-pick')) loadRoster().then(drawPick); });
  start().catch(() => drawPick());
})();
