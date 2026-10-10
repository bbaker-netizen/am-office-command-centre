/* A&M - Ask Claude, inside the command centre.

   POST /api/claude { question, page:{ tab, title, text }, history:[{role,content}] }
   Streams Claude's answer back as plain text, a few words at a time.

   Who: accounts with "Can ask Claude" ticked on People and access.
   What Claude sees: only what is on that person's screen when they ask (the
   page sends its own visible text), plus the conversation so far. Nothing is
   looked up behind the person's back, so Claude can never show someone a
   number their account cannot already see. It cannot change anything in
   JobTread, QuickBooks or the mailbox.

   Needs ANTHROPIC_API_KEY in Netlify, from A&M's own Anthropic Console account
   (console.anthropic.com). CLAUDE_MODEL can change the model, and
   CLAUDE_DAILY_LIMIT the questions per person per day (default 80). */

import { getStore } from "@netlify/blobs";
import { accountGate } from "./_accounts.mjs";

const STORE = "am-inventory";
const store = () => getStore({ name: STORE, consistency: "strong" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const LIMIT = () => Number(process.env.CLAUDE_DAILY_LIMIT || 80);

const SYSTEM = name => `You are Claude, built into the A&M Abatement Services Office Command Centre. A&M is a hazardous materials abatement, demolition and restoration contractor in Edmonton and Calgary, Alberta. You are talking with ${name}.

You are given the text of the page they are looking at right now. Answer from that text. If the answer is not on the page, say so plainly and tell them which page in the command centre, or which system (JobTread, QuickBooks, SiteDocs, Encircle, Google Drive), would have it. Never invent a number, a name, a date or a job. You cannot change anything in any system; if they want something changed, tell them where to do it.

How to write: plain language at job site reading level. Short sentences. Say the thing, then stop. Canadian spelling (colour, labour, centre, cheque) with -ize endings. Never use em dashes. Explain any accounting word the first time you use it. All money is Canadian dollars. Use a short list only when the content really is a list. Keep most answers under 120 words.`;

async function countToday(s, id) {
  const day = new Date().toLocaleDateString("en-CA", { timeZone: "America/Edmonton" });
  const key = "claude-usage-" + day;
  const doc = (await s.get(key, { type: "json" })) || {};
  doc[id] = (doc[id] || 0) + 1;
  await s.setJSON(key, doc);
  return doc[id];
}

export default async (req) => {
  const s = store();
  const denied = await accountGate(req, s);
  if (denied) return denied;
  const u = req.amUser;
  if (!u.claude) return json({ error: "role", message: "Ask Claude is not switched on for your account. Ask an admin." }, 403);
  if (req.method === "GET") return json({ ready: !!process.env.ANTHROPIC_API_KEY, model: MODEL() });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  if (!process.env.ANTHROPIC_API_KEY) return json({ error: "setup", message: "Ask Claude needs ANTHROPIC_API_KEY set in Netlify first." }, 409);

  const body = await req.json().catch(() => ({}));
  const q = String(body.question || "").trim().slice(0, 2000);
  if (!q) return json({ error: "bad", message: "Type a question first." }, 400);
  const n = await countToday(s, u.id);
  if (n > LIMIT()) return json({ error: "limit", message: `That is ${LIMIT()} questions today, the daily limit. It resets at midnight.` }, 429);

  const page = body.page || {};
  const screen = `PAGE: ${String(page.title || page.tab || "").slice(0, 80)}\n\n${String(page.text || "").slice(0, 16000)}`;
  const history = (Array.isArray(body.history) ? body.history : []).slice(-8)
    .filter(m => m && (m.role === "user" || m.role === "assistant") && m.content)
    .map(m => ({ role: m.role, content: String(m.content).slice(0, 4000) }));
  const messages = [...history, { role: "user", content: `<screen>\n${screen}\n</screen>\n\n${q}` }];
  /* The API wants the first message from the user and turns to alternate. */
  while (messages.length && messages[0].role !== "user") messages.shift();

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 900, stream: true, system: SYSTEM(u.name), messages })
  });
  if (!r.ok || !r.body) {
    const t = await r.text().catch(() => "");
    let m = ""; try { m = JSON.parse(t).error.message; } catch (e) { m = t.slice(0, 200); }
    return json({ error: "upstream", message: "Claude did not answer: " + (m || "HTTP " + r.status) }, 502);
  }

  /* Pass on only the words, as they arrive. */
  const enc = new TextEncoder(), dec = new TextDecoder();
  const stream = new ReadableStream({
    async start(controller) {
      const reader = r.body.getReader(); let buf = "";
      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += dec.decode(value, { stream: true });
          let i;
          while ((i = buf.indexOf("\n\n")) >= 0) {
            const chunk = buf.slice(0, i); buf = buf.slice(i + 2);
            const line = chunk.split("\n").find(l => l.startsWith("data: "));
            if (!line) continue;
            let ev; try { ev = JSON.parse(line.slice(6)); } catch (e) { continue; }
            if (ev.type === "content_block_delta" && ev.delta && ev.delta.type === "text_delta") controller.enqueue(enc.encode(ev.delta.text));
            if (ev.type === "error") controller.enqueue(enc.encode("\n\n(Claude stopped: " + ((ev.error && ev.error.message) || "an error") + ")"));
          }
        }
      } catch (e) { controller.enqueue(enc.encode("\n\n(The answer was cut off. Ask again.)")); }
      controller.close();
    }
  });
  return new Response(stream, { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store", "x-claude-left": String(Math.max(0, LIMIT() - n)) } });
};

export const config = { path: "/api/claude" };
