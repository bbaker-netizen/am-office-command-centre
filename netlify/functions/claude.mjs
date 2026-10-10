/* A&M - Ask Claude, inside the command centre.

   POST /api/claude { question, page:{ tab, title, text }, history:[{role,content}] }
   Streams Claude's answer back as plain text, a few words at a time.

   Who: accounts with "Can ask Claude" ticked on People and access.
   What Claude sees: what is on that person's screen when they ask (the page
   sends its own visible text), the conversation so far, a guide to the whole
   command centre (_guide.mjs), and, if that person connected Google Drive under
   My account, A&M's documents read with their own Drive access (_drive.mjs), so
   it can answer from the SOP, the position profiles and the org chart without
   ever showing a file the person could not open themselves. It cannot change
   anything in JobTread, QuickBooks, Drive or the mailbox.

   Needs ANTHROPIC_API_KEY in Netlify, from A&M's own Anthropic Console account
   (console.anthropic.com). CLAUDE_MODEL can change the model, and
   CLAUDE_DAILY_LIMIT the questions per person per day (default 80). */

import { getStore } from "@netlify/blobs";
import { accountGate } from "./_accounts.mjs";
import { APP_GUIDE } from "./_guide.mjs";
import { tokenInfo, accessToken, search as driveSearch, readText as driveRead } from "./_drive.mjs";

const STORE = "am-inventory";
const store = () => getStore({ name: STORE, consistency: "strong" });
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const MODEL = () => process.env.CLAUDE_MODEL || "claude-sonnet-5-5";
const LIMIT = () => Number(process.env.CLAUDE_DAILY_LIMIT || 80);

const SYSTEM = (u, drive) => `You are Claude, built into the A&M Abatement Services Office Command Centre. A&M is a hazardous materials abatement, demolition and restoration contractor in Edmonton and Calgary, Alberta. Owners: Craig and Amir. You are talking with ${u.name}${u.title ? ", " + u.title : ""}. They see these sections: ${(u.areas || []).join(", ") || "Overview only"}${u.admin ? ", and Admin" : ""}.

You are given the text of the page they are looking at right now. For questions about numbers, jobs and people, answer from that text. If the answer is not on the page, say so plainly and tell them which page in the command centre, or which system (JobTread, QuickBooks, Encircle, Google Drive), would have it. For questions about how the command centre works, where something is, or how to do something in it, use the guide below. Never invent a number, a name, a date or a job. You cannot change anything in any system; if they want something changed, tell them where and how to do it. Only tell them about pages in sections they can see; if something needs another section, say who to ask.

${drive ? `You can search A&M's Google Drive as this person, with their own access, using the search_drive and read_drive_file tools. Use them when the question is about how A&M does something (the SOP Manual, a position profile such as "Your Role at A&M", the org chart, policies, templates), or about a document. Name the document and give its link. Quote no more than a sentence or two; summarize the rest. When the SOP says Canopy, say that A&M now uses JobTread and this command centre for it. If a search finds nothing, say so; they may not have access to it.` : `This person has not connected Google Drive, so you cannot open A&M's documents for them. If the question needs the SOP, a position profile, the org chart or another document, answer what you can from the guide and tell them they can connect Google Drive under My account so you can read A&M's documents with their own access.`}

${APP_GUIDE}

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

  /* With Drive connected, Claude may look things up first, as this person. */
  if (await tokenInfo(s, u.id).catch(() => null)) {
    try { return await withDrive(s, u, messages, n); }
    catch (e) { return json({ error: "upstream", message: "Claude did not answer: " + e.message }, 502); }
  }

  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ model: MODEL(), max_tokens: 900, stream: true, system: SYSTEM(u, false), messages })
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

const TOOLS = [
  { name: "search_drive", description: "Search A&M's Google Drive, with the asking person's own access, for documents whose name or text contains the words. Returns up to 10 files with id, name, type, link and last change. Use short searches: SOP Manual, Your Role Estimator, Organization Chart, Naming Standard.",
    input_schema: { type: "object", properties: { query: { type: "string", description: "A few words to look for" } }, required: ["query"] } },
  { name: "read_drive_file", description: "Read the text of one Google Doc, Sheet, Slides or text file found by search_drive, with the person's own access. Word files and PDFs return only a link.",
    input_schema: { type: "object", properties: { file_id: { type: "string" } }, required: ["file_id"] } }
];
async function withDrive(s, u, messages, n) {
  const call = async msgs => {
    const r = await fetch("https://api.anthropic.com/v1/messages", { method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODEL(), max_tokens: 1200, system: SYSTEM(u, true), tools: TOOLS, messages: msgs }) });
    const b = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error((b.error && b.error.message) || "HTTP " + r.status);
    return b;
  };
  let msgs = messages.slice(), out = null, looked = [];
  for (let round = 0; round < 5; round++) {
    const b = await call(msgs);
    if (b.stop_reason !== "tool_use") { out = b; break; }
    const results = [];
    for (const c of b.content || []) {
      if (c.type !== "tool_use") continue;
      let res;
      try {
        const tok = await accessToken(s, u.id);
        if (c.name === "search_drive") { res = await driveSearch(tok, c.input && c.input.query, 10); looked.push("searched Drive for \"" + String(c.input && c.input.query).slice(0, 40) + "\""); }
        else if (c.name === "read_drive_file") { res = await driveRead(tok, c.input && c.input.file_id); looked.push("read " + res.name); }
        else res = { error: "Unknown tool." };
      } catch (e) { res = { error: e.message }; }
      results.push({ type: "tool_result", tool_use_id: c.id, content: JSON.stringify(res).slice(0, 30000) });
    }
    msgs = msgs.concat([{ role: "assistant", content: b.content }, { role: "user", content: results }]);
  }
  const text = out ? (out.content || []).filter(c => c.type === "text").map(c => c.text).join("\n").trim() : "I looked, but ran out of steps before I had an answer. Ask a narrower question.";
  return new Response(text || "I could not find an answer.", { status: 200, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store",
    "x-claude-left": String(Math.max(0, LIMIT() - n)), "x-claude-looked": encodeURIComponent(looked.join("; ").slice(0, 300)) } });
}

export const config = { path: "/api/claude" };
