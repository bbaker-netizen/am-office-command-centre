/* Stand-in for @netlify/blobs, kept in memory, for tests only. */
const stores = globalThis.__fakeStores || (globalThis.__fakeStores = new Map());
let n = 0;
export function getStore(opts) {
  const name = typeof opts === "string" ? opts : opts.name;
  if (!stores.has(name)) stores.set(name, new Map());
  const m = stores.get(name);
  const read = (k, o) => { if (!m.has(k)) return null; const v = m.get(k).v; return o && o.type === "json" ? JSON.parse(v) : v; };
  return {
    async get(k, o) { return read(k, o); },
    async getWithMetadata(k, o) { if (!m.has(k)) return null; return { data: read(k, o), etag: m.get(k).etag, metadata: {} }; },
    async set(k, v) { m.set(k, { v: String(v), etag: "e" + (++n) }); return { modified: true }; },
    async setJSON(k, v, o = {}) {
      if (o.onlyIfNew && m.has(k)) return { modified: false };
      if (o.onlyIfMatch && (!m.has(k) || m.get(k).etag !== o.onlyIfMatch)) return { modified: false };
      m.set(k, { v: JSON.stringify(v), etag: "e" + (++n) }); return { modified: true, etag: "e" + n };
    },
    async delete(k) { m.delete(k); },
    async list() { return { blobs: [...m.keys()].map(key => ({ key })) }; },
  };
}
export const getDeployStore = getStore;
