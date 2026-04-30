// chat: AI chat over user's Plynth data with tool-calling + SSE streaming.
//
// Body shapes:
//   POST { message, conversation_id? }   — main chat turn (returns SSE)
//   POST { action: 'list' }              — list user's conversations (JSON)
//   POST { action: 'history', conversation_id } — list messages (JSON)
//   POST { action: 'delete', conversation_id }  — delete conversation
//   POST { action: 'rename', conversation_id, title }
//
// SSE event payloads (one JSON per `data:` line):
//   { conversation_id, user_message_id }     — once at start
//   { tool_call: {name, args} }              — when AI requests a tool
//   { tool_result: {name, ok} }              — after tool runs
//   { delta: "..." }                         — token chunk
//   { done: true, message_id }               — end of assistant message
//   { error: "..." }                         — fatal

import { admin, json, corsHeaders, userFromAuth } from '../_shared/util.ts';
import { ollamaChatJSON, ollamaChatStream, type ChatMsg } from '../_shared/ollama.ts';
import { runTool, toolsCatalogText } from '../_shared/chat-tools.ts';

const MAX_HISTORY = 12;
const MAX_TOOL_LOOPS = 4;

function sseLine(obj: unknown): Uint8Array {
  return new TextEncoder().encode(`data: ${JSON.stringify(obj)}\n\n`);
}

function systemPromptDecide(): string {
  return [
    "You are Plynth's personal assistant. The user has a productivity app tracking their tasks, learning topics, finances (budget/loans/EMIs/expenses), and job applications.",
    "On each turn, decide whether you need to fetch data via a tool, or whether you can answer directly.",
    "Available tools (call user-scoped, read-only):",
    toolsCatalogText(),
    "",
    "RESPOND WITH ONLY ONE OF THESE JSON OBJECTS, no prose:",
    `  {"action":"tool","tool":"<name>","args":{...}}`,
    `  {"action":"final"}                               // when ready to answer`,
    "",
    "Rules:",
    "- Use a tool ONLY if the question is about the user's own data (their EMIs, topics, tasks, jobs, etc.).",
    "- For general knowledge (e.g. capital of France, code help, definitions), choose action='final' immediately — DO NOT call tools.",
    "- After receiving a tool result, you may either call another tool or choose action='final'.",
    "- Never invent data not present in tool results.",
  ].join('\n');
}

function systemPromptCompose(): string {
  return [
    "You are Plynth's personal assistant. Compose a friendly, concise reply for the user based on the conversation and any tool results above.",
    "Render in clean Markdown. Use bullet lists or small tables when appropriate. Format currency in INR (₹) when relevant.",
    "If a tool result was empty, say so plainly. Never fabricate numbers, dates, or names.",
  ].join('\n');
}

async function loadHistory(sb: ReturnType<typeof admin>, userId: string, conversationId: string): Promise<ChatMsg[]> {
  const { data } = await sb.from('chat_messages')
    .select('role, content, tool_name, tool_input, tool_output')
    .eq('conversation_id', conversationId)
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(MAX_HISTORY);
  const rows = (data ?? []).reverse();
  const msgs: ChatMsg[] = [];
  for (const r of rows) {
    if (r.role === 'tool') {
      msgs.push({ role: 'tool', content: `Tool ${r.tool_name} returned:\n${JSON.stringify(r.tool_output).slice(0, 4000)}` });
    } else if (r.role === 'user' || r.role === 'assistant' || r.role === 'system') {
      msgs.push({ role: r.role, content: r.content });
    }
  }
  return msgs;
}

async function ensureConversation(sb: ReturnType<typeof admin>, userId: string, conversationId: string | undefined, firstMessage: string): Promise<string> {
  if (conversationId) {
    const { data } = await sb.from('chat_conversations').select('id').eq('id', conversationId).eq('user_id', userId).maybeSingle();
    if (data) return data.id;
  }
  const title = firstMessage.trim().slice(0, 60) || 'New chat';
  const { data, error } = await sb.from('chat_conversations').insert({ user_id: userId, title }).select('id').single();
  if (error) throw error;
  return data.id;
}

async function bumpConversation(sb: ReturnType<typeof admin>, conversationId: string) {
  await sb.from('chat_conversations').update({ updated_at: new Date().toISOString() }).eq('id', conversationId);
}

function safeParseJSON<T = unknown>(text: string): T | null {
  try { return JSON.parse(text) as T; } catch { /* try to extract */ }
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]) as T; } catch { return null; }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders() });
  if (req.method !== 'POST') return json({ error: 'POST only' }, 405);

  const user = await userFromAuth(req);
  if (!user) return json({ error: 'Unauthorized' }, 401);
  const sb = admin();

  const body = await req.json().catch(() => ({}));
  const action: string | undefined = body.action;

  // ---- JSON management actions ----
  if (action === 'list') {
    const { data } = await sb.from('chat_conversations')
      .select('id,title,updated_at,created_at')
      .eq('user_id', user.id).order('updated_at', { ascending: false }).limit(100);
    return json({ conversations: data ?? [] });
  }
  if (action === 'history') {
    const cid = String(body.conversation_id || '');
    if (!cid) return json({ error: 'conversation_id required' }, 400);
    const { data } = await sb.from('chat_messages')
      .select('id,role,content,tool_name,tool_input,tool_output,created_at')
      .eq('conversation_id', cid).eq('user_id', user.id)
      .order('created_at', { ascending: true }).limit(500);
    return json({ messages: data ?? [] });
  }
  if (action === 'delete') {
    const cid = String(body.conversation_id || '');
    if (!cid) return json({ error: 'conversation_id required' }, 400);
    await sb.from('chat_conversations').delete().eq('id', cid).eq('user_id', user.id);
    return json({ ok: true });
  }
  if (action === 'rename') {
    const cid = String(body.conversation_id || '');
    const title = String(body.title || '').slice(0, 120);
    if (!cid || !title) return json({ error: 'conversation_id and title required' }, 400);
    await sb.from('chat_conversations').update({ title }).eq('id', cid).eq('user_id', user.id);
    return json({ ok: true });
  }

  // ---- Streaming chat turn ----
  const message: string = String(body.message || '').trim();
  if (!message) return json({ error: 'message required' }, 400);

  const conversationId = await ensureConversation(sb, user.id, body.conversation_id, message);

  // persist user message
  const { data: userMsgRow } = await sb.from('chat_messages').insert({
    conversation_id: conversationId, user_id: user.id, role: 'user', content: message,
  }).select('id').single();

  const stream = new ReadableStream({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(sseLine(obj));
      try {
        send({ conversation_id: conversationId, user_message_id: userMsgRow?.id });

        const history = await loadHistory(sb, user.id, conversationId);

        // ---- Tool decision loop ----
        const decideMessages: ChatMsg[] = [
          { role: 'system', content: systemPromptDecide() },
          ...history,
        ];

        for (let i = 0; i < MAX_TOOL_LOOPS; i++) {
          const raw = await ollamaChatJSON(decideMessages);
          const parsed = safeParseJSON<{ action: string; tool?: string; args?: Record<string, unknown> }>(raw) || { action: 'final' };
          if (parsed.action === 'tool' && parsed.tool) {
            send({ tool_call: { name: parsed.tool, args: parsed.args ?? {} } });
            let result: unknown; let ok = true;
            try { result = await runTool(sb, user.id, parsed.tool, parsed.args ?? {}); }
            catch (e) { ok = false; result = { error: (e as Error).message }; }
            send({ tool_result: { name: parsed.tool, ok } });
            // persist tool message
            await sb.from('chat_messages').insert({
              conversation_id: conversationId, user_id: user.id, role: 'tool',
              content: '', tool_name: parsed.tool, tool_input: parsed.args ?? {}, tool_output: result as object,
            });
            decideMessages.push({ role: 'assistant', content: JSON.stringify({ action: 'tool', tool: parsed.tool, args: parsed.args ?? {} }) });
            decideMessages.push({ role: 'tool', content: `Tool ${parsed.tool} returned:\n${JSON.stringify(result).slice(0, 4000)}` });
            continue;
          }
          break; // action === 'final'
        }

        // ---- Compose final answer (streamed) ----
        const finalHistory = await loadHistory(sb, user.id, conversationId);
        const composeMessages: ChatMsg[] = [
          { role: 'system', content: systemPromptCompose() },
          ...finalHistory,
        ];

        let full = '';
        for await (const delta of ollamaChatStream(composeMessages, { signal: req.signal })) {
          full += delta;
          send({ delta });
        }

        // persist assistant message
        const { data: aMsg } = await sb.from('chat_messages').insert({
          conversation_id: conversationId, user_id: user.id, role: 'assistant', content: full,
        }).select('id').single();

        await bumpConversation(sb, conversationId);
        send({ done: true, message_id: aMsg?.id });
      } catch (e) {
        send({ error: (e as Error).message });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'X-Accel-Buffering': 'no',
      ...corsHeaders(),
    },
  });
});
