/* A random secret the app makes once and keeps in its own store, so only the
   scheduled check-in can start a background check-in. */
export async function runSecret(s) {
  let v = await s.get("assist-run-secret");
  if (!v) { v = crypto.randomUUID() + crypto.randomUUID(); await s.set("assist-run-secret", v); }
  return v;
}
