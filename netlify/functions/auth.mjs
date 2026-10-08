/* A&M Inventory - signing in.

   One job: take a name and four digits, decide whether that is really that
   person, and hand back a token for their phone to keep.

   WHY THE COUNTING OF WRONG GUESSES MOVED HERE
   The app already refused a fifth wrong PIN and made you wait a minute, but it
   did that on the phone, in the phone's own storage. That stops a cold pair of
   hands from fumbling, which is what it was written for, and it stops nothing
   else: somebody talking to this endpoint directly never runs the app's code at
   all and can simply ask ten thousand times. Four digits is ten thousand
   guesses. So the counting is done here now, per person, where it cannot be
   skipped, and it is deliberately slow to climb out of.

   THE BOOTSTRAP, AND WHY IT CANNOT BE LEFT LYING AROUND
   Nobody can be given a PIN until somebody is already in the office screen, and
   nobody is in the office screen until they have a PIN. That knot is cut once,
   with a code set on the server, which signs in one named person and nothing
   else. It stops working by itself the moment the first PIN exists, so it
   cannot be forgotten about and left as a way in. */

import { authStore, signToken, readAuthIndex, writeAuthIndex, isArmed, isOffice, roleOf } from "./_auth.mjs";
import { update } from "./_lock.mjs";

const CATALOG = "catalog";

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", "cache-control": "no-store" }
  });
}

const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, "0")).join("");

async function pinHash(pin, salt) {
  const data = new TextEncoder().encode(String(salt) + ":" + String(pin));
  return hex(await globalThis.crypto.subtle.digest("SHA-256", data));
}

/* Compared all the way through rather than stopping at the first difference,
   for the same reason the old shop code was. */
function same(a, b) {
  const x = String(a || ""), y = String(b || "");
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

const failKey = uid => "authfail-" + uid;

async function readFails(s, uid) {
  return (await s.get(failKey(uid), { type: "json" })) || { n: 0, until: 0 };
}

/* Counted with a write that fails if somebody else counted in between, so a
   burst of guesses sent all at once cannot all see the same count. */
async function addFail(s, uid) {
  return update(s, failKey(uid), cur => {
    const n = ((cur && cur.n) || 0) + 1;
    return { n, until: Date.now() + waitFor(n) };
  });
}

/* A second count per network address, so one machine cannot work through
   everybody's names in turn. Thirty wrong in an hour from one address, and that
   address waits an hour. The address is scrambled before it is stored. */
async function ipKey(req) {
  const ip = req.headers.get("x-nf-client-connection-ip") || req.headers.get("x-forwarded-for") || "";
  if (!ip) return "";
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode("am:" + ip.split(",")[0].trim()));
  return "authfail-ip-" + [...new Uint8Array(d)].slice(0, 12).map(b => b.toString(16).padStart(2, "0")).join("");
}
async function ipBlocked(s, key) {
  if (!key) return false;
  const v = await s.get(key, { type: "json" });
  return !!(v && v.n >= 30 && Date.now() - v.since < 3600000);
}
async function ipFail(s, key) {
  if (!key) return;
  try {
    await update(s, key, cur => (!cur || Date.now() - cur.since > 3600000) ? { n: 1, since: Date.now() } : { n: cur.n + 1, since: cur.since });
  } catch (e) {}
}

/* Five is generous for cold hands on a small keypad. After that the wait grows,
   because somebody who has been wrong ten times in a row is not fumbling. At
   fifteen minutes a run through all ten thousand takes about a year. */
function waitFor(n) {
  if (n < 5) return 0;
  if (n < 10) return 15 * 60 * 1000;
  return 60 * 60 * 1000;
}

export default async (req) => {
  const s = authStore();

  /* WHO CAN SIGN IN ON THIS PHONE
     The sign-in screen used to build its list of names from the copy of the
     people list already on the phone, and a phone can only get a fresh copy
     after it has signed in. A new person's phone therefore never showed their
     name, and fell back to the three names that ship with the app. This hands
     out names and whether each has a PIN, and nothing else. */
  if (req.method === "GET") {
    const catalog = await s.get(CATALOG, { type: "json" });
    const idx = await readAuthIndex(s);
    const people = ((catalog && catalog.users) || [])
      .filter(u => u && u.active !== false && u.name)
      .map(u => ({ id: u.id || "", name: u.name, hasPin: !!(u.pin && u.pin.hash) }))
      .sort((a, b) => a.name.localeCompare(b.name));
    return json({ people, required: await isArmed(s, idx) });
  }

  if (req.method !== "POST") return json({ error: "Use POST." }, 405);

  let body;
  try { body = await req.json(); }
  catch { return json({ error: "Body was not valid JSON." }, 400); }

  const ik = await ipKey(req);
  if (await ipBlocked(s, ik)) {
    return json({ error: "locked", message: "Too many wrong tries from this connection. Wait an hour, or ask the office." }, 429);
  }

  const name = String(body.name || "").trim();
  const pin = String(body.pin || "").trim();
  const bootstrap = String(body.bootstrap || "").trim();
  if (!name) return json({ error: "auth", message: "Tell the office who you are." }, 400);

  const catalog = await s.get(CATALOG, { type: "json" });
  const users = (catalog && Array.isArray(catalog.users)) ? catalog.users : [];
  const user = users.find(u => u && u.active !== false && (u.id === name || u.name === name));

  /* Deliberately the same answer whether the name is unknown or the PIN is
     wrong, so this cannot be used to work out who is on the list. The list is
     not much of a secret, but there is no reason to hand it over either. */
  const nope = () => json({ error: "auth", message: "That is not it. Check with the office." }, 401);

  if (!user) return nope();

  const uid = user.id || "";
  if (!uid) return json({ error: "auth", message: "That person is not set up properly yet. The office can fix it on the people screen." }, 409);

  const fails = await readFails(s, uid);
  if (fails.until && Date.now() < fails.until) {
    const mins = Math.max(1, Math.ceil((fails.until - Date.now()) / 60000));
    return json({
      error: "locked",
      message: `Too many wrong tries. Wait ${mins} minute${mins === 1 ? "" : "s"}, or ask the office to reset your PIN.`
    }, 429);
  }

  const idx = await readAuthIndex(s);

  // ------------------------------------------------------------- bootstrap
  if (bootstrap) {
    if (idx.anyPins) {
      return json({ error: "auth", message: "The app is already set up. Sign in with your PIN." }, 403);
    }
    const want = process.env.BOOTSTRAP_CODE || "";
    if (!want || !same(bootstrap, want)) {
      await addFail(s, uid); await ipFail(s, ik);
      return nope();
    }
    await s.setJSON(failKey(uid), { n: 0, until: 0 });
    const token = await signToken(s, { u: uid, p: user.pinSetAt || "", t: Date.now() });
    return json({
      token,
      user: { id: uid, name: user.name },
      pin: null,
      setUpFirst: true,
      message: "Signed in to set the app up. Issue yourself a PIN on the people screen before you do anything else."
    });
  }

  // ------------------------------------------------------------------ PIN
  if (!/^\d{4}$/.test(pin)) return nope();
  if (!(user.pin && user.pin.hash && user.pin.salt)) {
    return json({ error: "nopin", message: "The office has not issued you a PIN yet." }, 403);
  }

  const got = await pinHash(pin, user.pin.salt);
  if (!same(got, user.pin.hash)) {
    await addFail(s, uid); await ipFail(s, ik);
    return nope();
  }

  await s.setJSON(failKey(uid), { n: 0, until: 0 });

  /* The index is what the gate reads, and it can be stale if the catalog was
     saved by something that did not rebuild it. Cheap to put right here, at the
     one moment somebody is definitely waiting on a round trip anyway. */
  if (!idx.users || !idx.users[uid]) await writeAuthIndex(s, catalog);

  const token = await signToken(s, { u: uid, p: user.pinSetAt || "", t: Date.now() });
  return json({
    token,
    user: { id: uid, name: user.name, office: isOffice({ id: uid, name: user.name }), role: roleOf({ id: uid, name: user.name }) },
    /* Their own, and nobody else's. This is what lets the phone unlock itself
       in a basement: the token is already held, and this is only used to check
       the four digits typed on the lock screen when there is no signal to ask. */
    pin: { salt: user.pin.salt, hash: user.pin.hash }
  });
};

export const config = { path: "/api/auth" };
