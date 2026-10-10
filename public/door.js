/* A&M Office Command Centre - the front door.

   The command centre is signed in to with a work email and a password. Each
   person's account, and what it can see and do, is set by an admin on Admin,
   People and access, inside the command centre.

   The shop is separate and unchanged: crew sign in there with their name and
   four-digit PIN, on the shop's own screen, and it still works with no signal.
   This page sends crew phones straight to the shop, and has a button to it for
   anybody else.

   What this page keeps on the device (IndexedDB "am-inventory", store "kv"),
   apart from anything the shop keeps:
     acctToken    the signed-in person's key for the command centre
     acctSession  who is signed in here and when they last used it
     acctIdle     hours without use before it asks for the password again
     acctEver     an account has signed in on this device at some point
   The password itself is never kept. */
(function () {
  'use strict';
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const params = new URLSearchParams(location.search);
  const NEXT = params.get('next') || '';                 // "command" (or an old "shop") : where they were sent from
  const AFTER = params.get('h') || location.hash || '';  // the page they were on, for example #money
  const OUT = params.has('out');
  const MIN_PW = 10;

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
  const nowISO = () => new Date().toISOString();

  async function call(body) {
    const r = await fetch('/api/account', { method: 'POST', headers: { 'content-type': 'application/json', ...(body._tok ? { authorization: 'Bearer ' + body._tok } : {}) }, body: JSON.stringify({ ...body, _tok: undefined }), cache: 'no-store' });
    const b = await r.json().catch(() => ({}));
    return { ok: r.ok, status: r.status, b };
  }

  /* ---------------------------------------------------------- where to go */
  const shopScreen = () => (/^#\//.test(AFTER) ? AFTER : '#/');
  function goOn() {
    if (NEXT === 'shop') return location.replace('/shop.html' + shopScreen());
    if (/^#[a-z]+$/.test(AFTER)) return location.replace('/command.html' + AFTER);
    location.replace('/command.html');
  }
  async function keep(b) {
    await set('acctToken', b.token);
    await set('acctSession', { id: b.account.id, name: b.account.name, email: b.account.email, at: nowISO(), lastSeen: nowISO() });
    if (b.idleHours) await set('acctIdle', b.idleHours);
    await set('acctEver', true);
  }

  /* -------------------------------------------------------------- drawing */
  const card = html => { $('#door').innerHTML = html; };
  const note = (t, cls) => { const m = $('#msg'); if (m) { m.textContent = t; m.className = 'msg ' + (cls || ''); } };
  const pwField = (id, label, auto, extra) =>
    `<label class="fld"><span>${label}</span><span class="pw"><input id="${id}" type="password" autocomplete="${auto}" autocapitalize="none" spellcheck="false" ${extra || ''}><button type="button" class="show" data-for="${id}" aria-pressed="false">Show</button></span></label>`;
  function wireShow() {
    document.querySelectorAll('.show').forEach(b => b.onclick = () => {
      const i = document.getElementById(b.dataset.for); const on = i.type === 'password';
      i.type = on ? 'text' : 'password'; b.textContent = on ? 'Hide' : 'Show'; b.setAttribute('aria-pressed', String(on)); i.focus();
    });
  }
  const shopDoor = () => `
    <div class="shop-door">
      <div><b>Crew and the shop floor</b><span>Stock out and back, transfers and counts. Sign in there with your name and four-digit PIN, as before.</span></div>
      <a class="btn ghost" href="/shop.html#/" id="toShop">Open the shop</a>
    </div>`;
  const busy = (btn, on, text) => { btn.disabled = on; if (text) btn.textContent = text; };

  /* ------------------------------------------------------------- sign in */
  async function drawSignIn(lede, cls) {
    const last = await get('acctSession');
    card(`
      <h1>Sign in</h1>
      <p class="lede ${cls || ''}" id="lede">${esc(lede || 'The A&M Office Command Centre. Use your work email and your password.')}</p>
      <form id="f" novalidate>
        <label class="fld"><span>Work email</span><input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false" value="${esc((last && last.email) || '')}"></label>
        ${pwField('pw', 'Password', 'current-password')}
        <button class="btn big" type="submit" id="go">Sign in</button>
        <p class="msg" id="msg" role="status"></p>
      </form>
      <p class="small">Forgot your password? An admin gives you a new one from Admin, People and access in the command centre.</p>
      ${shopDoor()}`);
    wireShow();
    (last && last.email ? $('#pw') : $('#em')).focus();
    $('#f').onsubmit = async ev => {
      ev.preventDefault();
      const email = $('#em').value.trim(), password = $('#pw').value, btn = $('#go');
      if (!email || !password) return note('Type your email and your password.', 'bad');
      busy(btn, true, 'Signing in…'); note('');
      let r;
      try { r = await call({ action: 'login', email, password }); }
      catch (e) { busy(btn, false, 'Sign in'); return note('No connection. The command centre needs a bar of signal. The shop works without one.', 'bad'); }
      if (!r.ok) { busy(btn, false, 'Sign in'); $('#pw').value = ''; $('#pw').focus(); return note(r.b.message || 'That did not work. Try again.', 'bad'); }
      await keep(r.b);
      if (r.b.mustChange) return drawChange(password, r.b.account);
      goOn();
    };
  }

  /* ------------------------------------------------- choose own password */
  function drawChange(current, account) {
    const first = String((account && account.name) || '').split(' ')[0];
    card(`
      <h1>Choose your own password</h1>
      <p class="lede">${first ? 'Hi ' + esc(first) + '. ' : ''}You signed in with a temporary password from an admin. Now choose one only you know. At least ${MIN_PW} characters. A short sentence you will remember works well.</p>
      <form id="f" novalidate>
        <input type="email" autocomplete="username" value="${esc((account && account.email) || '')}" hidden>
        ${pwField('n1', 'New password', 'new-password', 'minlength="' + MIN_PW + '"')}
        ${pwField('n2', 'Type it again', 'new-password')}
        <button class="btn big" type="submit" id="go">Save and carry on</button>
        <p class="msg" id="msg" role="status"></p>
      </form>`);
    wireShow(); $('#n1').focus();
    $('#f').onsubmit = async ev => {
      ev.preventDefault();
      const a = $('#n1').value, b = $('#n2').value, btn = $('#go');
      if (a.length < MIN_PW) return note(`Use at least ${MIN_PW} characters.`, 'bad');
      if (a !== b) return note('The two do not match. Type them again.', 'bad');
      busy(btn, true, 'Saving…');
      let r;
      try { r = await call({ action: 'password', current, next: a, _tok: await get('acctToken') }); }
      catch (e) { busy(btn, false, 'Save and carry on'); return note('No connection. Try again with a bar of signal.', 'bad'); }
      if (!r.ok) {
        busy(btn, false, 'Save and carry on');
        if (r.status === 401) { await set('acctToken', null); return drawSignIn(r.b.message || 'Sign in again.', 'bad'); }
        return note(r.b.message || 'That did not save.', 'bad');
      }
      await keep({ ...r.b, idleHours: await get('acctIdle') });
      goOn();
    };
  }

  /* ------------------------------------------------- the very first account */
  async function drawSetup() {
    let names = [];
    try { const r = await fetch('/api/auth', { cache: 'no-store' }); const b = await r.json(); names = (b.people || []).filter(p => p.hasPin).map(p => p.name); } catch (e) {}
    card(`
      <h1>Set up the first account</h1>
      <p class="lede">Nobody has a command centre account yet. An owner sets up the first one, then adds everybody else from Admin, People and access. To prove it is you, use your name and PIN from the shop.</p>
      <form id="f" novalidate>
        <div class="two">
          <label class="fld"><span>Your name in the shop</span><select id="sn"><option value="">Choose</option>${names.map(n => `<option>${esc(n)}</option>`).join('')}</select></label>
          <label class="fld"><span>Your shop PIN</span><input id="pin" type="password" inputmode="numeric" maxlength="4" autocomplete="off"></label>
        </div>
        <hr>
        <label class="fld"><span>Your full name</span><input id="nm" type="text" autocomplete="name"></label>
        <label class="fld"><span>Work email</span><input id="em" type="email" autocomplete="username" inputmode="email" autocapitalize="none" spellcheck="false"></label>
        ${pwField('n1', 'Choose a password', 'new-password', 'minlength="' + MIN_PW + '"')}
        ${pwField('n2', 'Type it again', 'new-password')}
        <button class="btn big" type="submit" id="go">Create my account</button>
        <p class="msg" id="msg" role="status"></p>
      </form>
      <p class="small">This only works while there are no accounts, and only for an owner (a name in OWNER_USERS in Netlify). Your account gets the whole company and admin.</p>
      ${shopDoor()}`);
    wireShow();
    $('#f').onsubmit = async ev => {
      ev.preventDefault();
      const v = id => $('#' + id).value, btn = $('#go');
      if (!v('sn') || !/^\d{4}$/.test(v('pin'))) return note('Choose your shop name and type your four-digit PIN.', 'bad');
      if (!v('nm').trim() || !v('em').trim()) return note('Type your full name and your work email.', 'bad');
      if (v('n1').length < MIN_PW) return note(`Use at least ${MIN_PW} characters for the password.`, 'bad');
      if (v('n1') !== v('n2')) return note('The two passwords do not match.', 'bad');
      busy(btn, true, 'Setting up…');
      let r;
      try { r = await call({ action: 'setup', shopName: v('sn'), pin: v('pin'), name: v('nm').trim(), email: v('em').trim(), password: v('n1') }); }
      catch (e) { busy(btn, false, 'Create my account'); return note('No connection. Try again with a bar of signal.', 'bad'); }
      if (!r.ok) { busy(btn, false, 'Create my account'); if (r.b.error === 'ready') return drawSignIn(r.b.message); return note(r.b.message || 'That did not work.', 'bad'); }
      await keep(r.b);
      goOn();
    };
  }

  /* ---------------------------------------------------------------- start */
  async function start() {
    if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
    /* An old link from the shop. The shop signs its own people in now. */
    if (NEXT === 'shop') return location.replace('/shop.html' + shopScreen());
    if (OUT) { await set('acctToken', null); await set('acctSession', null); }
    const [token, session, idleH, ever, shopToken, shopRole] = await Promise.all([get('acctToken'), get('acctSession'), get('acctIdle'), get('acctEver'), get('token'), get('role')]);
    /* Signed in here and used recently: straight through. Idle too long, and
       the key on this device is thrown away, so the password is needed again. */
    let idledOut = false;
    if (!OUT && token && session) {
      const idleMin = (Date.now() - new Date(session.lastSeen || session.at).getTime()) / 60000;
      if (idleMin <= (Number(idleH) || 8) * 60) return goOn();
      idledOut = true; await set('acctToken', null);
    }
    /* A crew phone: the shop signed a crew member in on it, and no account
       has ever signed in here. The app icon on a crew phone opens this page,
       so send it straight on to the shop. */
    if (!OUT && !NEXT && !ever && shopToken && shopRole === 'crew') return location.replace('/shop.html#/');
    let ready = true;
    try {
      const r = await fetch('/api/account?action=status', { cache: 'no-store' });
      const b = await r.json(); ready = !!b.ready;
    } catch (e) {
      return drawSignIn('No connection right now. The command centre needs a bar of signal. The shop works without one.', 'bad');
    }
    if (!ready) return drawSetup();
    if (OUT) return drawSignIn('You are signed out of the command centre on this device.');
    if (idledOut) return drawSignIn('Signed out after a while without use. Sign in again to carry on.');
    drawSignIn();
  }
  start().catch(() => drawSignIn());
})();
