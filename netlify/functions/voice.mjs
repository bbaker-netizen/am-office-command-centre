/* A&M - a natural, welcoming voice for the two walkthroughs.

   The clips that ship with the app are made with a free voice engine (Piper).
   This records every line again with a far more natural voice, once, and the
   tours play those instead. Nothing is generated while people use the app.

   GET  /api/voice?action=status               is a recorded voice live, and which
   GET  /api/voice?clip=cc/welcome&v=3         one recorded clip (public: it is the tour's own words)
   POST /api/voice { action:"sample", voice }  admin: hear one line in a voice before choosing
   POST /api/voice { action:"begin", voice }   admin: start a new recording, returns the clip list
   POST /api/voice { action:"record", take, clip }   admin: record one clip into that take
   POST /api/voice { action:"publish", take }  admin: switch the tours to that take
   POST /api/voice { action:"builtin" }        admin: go back to the clips that ship with the app

   Needs OPENAI_API_KEY in Netlify. TTS_MODEL can change the model
   (default gpt-4o-mini-tts, which takes a description of the tone). The whole
   script is about 6,000 characters, so recording it costs well under a dollar. */

import { getStore } from "@netlify/blobs";
import { accountGate, isAdmin } from "./_accounts.mjs";
import { LINES } from "./_voicelines.mjs";

const vstore = () => getStore({ name: "am-voice", consistency: "strong" });
const astore = () => getStore({ name: "am-inventory", consistency: "strong" });
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json", "cache-control": "no-store" } });
export const VOICES = ["coral", "nova", "shimmer", "sage", "ballad", "verse", "ash"];
const STYLE = "You are a friendly, warm colleague welcoming someone to their new workplace app and showing them around. Smile as you speak. Relaxed, upbeat, conversational and encouraging, at an easy pace with natural pauses. Never stern, formal or like a teacher. Canadian workplace, plain words.";
const speakable = t => String(t).replace(/A&M/g, "A and M").replace(/\bHEPA\b/g, "hepa");

async function tts(voice, input) {
  const r = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: { authorization: "Bearer " + process.env.OPENAI_API_KEY, "content-type": "application/json" },
    body: JSON.stringify({ model: process.env.TTS_MODEL || "gpt-4o-mini-tts", voice, input: speakable(input), instructions: STYLE, response_format: "mp3" })
  });
  if (!r.ok) {
    const t = await r.text().catch(() => ""); let m = ""; try { m = JSON.parse(t).error.message; } catch (e) { m = t.slice(0, 200); }
    throw new Error("The voice service did not answer: " + (m || "HTTP " + r.status));
  }
  return await r.arrayBuffer();
}

export default async (req) => {
  const url = new URL(req.url), vs = vstore();
  if (req.method === "GET") {
    const meta = (await vs.get("meta", { type: "json" })) || {};
    const clip = url.searchParams.get("clip");
    if (clip) {
      if (!meta.take || !LINES[clip]) return new Response("Not recorded", { status: 404 });
      const buf = await vs.get(`take${meta.take}/${clip}`, { type: "arrayBuffer" });
      if (!buf) return new Response("Not recorded", { status: 404 });
      return new Response(buf, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "public, max-age=31536000, immutable" } });
    }
    return json({ take: meta.take || null, voice: meta.voice || null, recordedAt: meta.recordedAt || null, recordedBy: meta.recordedBy || "", ready: !!process.env.OPENAI_API_KEY, voices: VOICES, total: Object.keys(LINES).length });
  }
  if (req.method !== "POST") return json({ error: "Use GET or POST." }, 405);
  const denied = await accountGate(req, astore());
  if (denied) return denied;
  if (!isAdmin(req.amUser)) return json({ error: "role", message: "Recording the tour voice is for an admin." }, 403);
  if (!process.env.OPENAI_API_KEY) return json({ error: "setup", message: "Add OPENAI_API_KEY in Netlify first." }, 409);
  const body = await req.json().catch(() => ({}));
  const voice = VOICES.includes(body.voice) ? body.voice : "coral";
  try {
    if (body.action === "sample") {
      const buf = await tts(voice, "Hi, and welcome to the A&M command centre! I'm really glad you're here. Let's take a quick look around together.");
      return new Response(buf, { status: 200, headers: { "content-type": "audio/mpeg", "cache-control": "no-store" } });
    }
    if (body.action === "begin") {
      const meta = (await vs.get("meta", { type: "json" })) || {};
      const take = (meta.lastTake || 0) + 1;
      await vs.setJSON("meta", { ...meta, lastTake: take, pending: { take, voice, by: req.amUser.name } });
      return json({ take, clips: Object.keys(LINES) });
    }
    if (body.action === "record") {
      const meta = (await vs.get("meta", { type: "json" })) || {};
      const take = Number(body.take), clip = String(body.clip || "");
      if (!meta.pending || meta.pending.take !== take) return json({ error: "stale", message: "That recording was replaced by a newer one. Start again." }, 409);
      if (!LINES[clip]) return json({ error: "bad", message: "No such line." }, 400);
      const buf = await tts(meta.pending.voice, LINES[clip]);
      await vs.set(`take${take}/${clip}`, buf);
      return json({ ok: true, clip, bytes: buf.byteLength });
    }
    if (body.action === "publish") {
      const meta = (await vs.get("meta", { type: "json" })) || {};
      const take = Number(body.take);
      if (!meta.pending || meta.pending.take !== take) return json({ error: "stale", message: "That recording was replaced by a newer one." }, 409);
      for (const clip of Object.keys(LINES)) { if (!(await vs.getMetadata(`take${take}/${clip}`))) return json({ error: "incomplete", message: "Not every line was recorded. Press Record again." }, 409); }
      const old = meta.take;
      await vs.setJSON("meta", { lastTake: meta.lastTake, take, voice: meta.pending.voice, recordedAt: new Date().toISOString(), recordedBy: req.amUser.name });
      if (old && old !== take) { const { blobs } = await vs.list({ prefix: `take${old}/` }); for (const b of blobs) await vs.delete(b.key); }
      return json({ ok: true, take });
    }
    if (body.action === "builtin") {
      const meta = (await vs.get("meta", { type: "json" })) || {};
      await vs.setJSON("meta", { lastTake: meta.lastTake || 0 });
      return json({ ok: true });
    }
    return json({ error: "Unknown action." }, 400);
  } catch (e) { return json({ error: "upstream", message: e.message }, 502); }
};

export const config = { path: "/api/voice" };
