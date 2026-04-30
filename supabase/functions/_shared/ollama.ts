// _shared/ollama.ts — Self-hosted Ollama fallback (truly unlimited, runs on user's box).
// Tunneled via Cloudflare; protected by an HMAC-style shared secret header.

import { getSecret } from './util.ts';
import { RateLimitError } from './groq.ts';

const PER_CALL_TIMEOUT_MS = 25_000; // CPU inference is slow

async function callOllama(baseUrl: string, path: string, body: unknown): Promise<Response> {
  const sharedSecret = await getSecret('OLLAMA_SHARED_SECRET');
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PER_CALL_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sharedSecret) headers['X-Plynth-Token'] = sharedSecret;
    return await fetch(`${baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers,
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function chat(messages: unknown[], asJson: boolean): Promise<string> {
  let baseUrl = await getSecret('OLLAMA_BASE_URL');
  if (!baseUrl) baseUrl = await getDynamicBaseUrl();
  if (!baseUrl) throw new Error('OLLAMA_BASE_URL not configured');
  const model = (await getSecret('OLLAMA_MODEL')) || 'llama3.1:8b';

  const body: Record<string, unknown> = { model, messages, stream: false };
  if (asJson) body.format = 'json';

  const r = await callOllama(baseUrl, '/api/chat', body);
  if (r.status === 429 || r.status === 503) {
    throw new RateLimitError('ollama', `${model} ${r.status}`);
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 400);
    throw new Error(`Ollama ${model} → ${r.status}: ${detail}`);
  }
  const data = await r.json();
  const text = data?.message?.content ?? '';
  if (!text || text.trim() === '' || text.trim() === '{}') {
    throw new Error(`Ollama ${model} returned empty payload`);
  }
  return text;
}

export async function ollamaJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const messages = [
    {
      role: 'system',
      content: 'You are a precise JSON generator. Output ONLY valid JSON. No markdown, no commentary.',
    },
    {
      role: 'user',
      content: `${prompt}\n\nReturn ONLY a non-empty JSON object matching this shape:\n${schemaHint}`,
    },
  ];
  const text = await chat(messages, true);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Ollama invalid JSON: ${(e as Error).message} :: ${text.slice(0, 200)}`);
  }
}

export async function ollamaText(prompt: string, system?: string): Promise<string> {
  const messages = [
    { role: 'system', content: system || 'You are a helpful assistant for Plynth users.' },
    { role: 'user', content: prompt },
  ];
  return await chat(messages, false);
}

// ---------- Chat-page helpers (no per-call timeout, larger budget) ----------

const CHAT_TIMEOUT_MS = 120_000;

async function chatBaseAndModel(): Promise<{ baseUrl: string; model: string }> {
  let baseUrl = await getSecret('OLLAMA_BASE_URL');
  if (!baseUrl) baseUrl = await getDynamicBaseUrl();
  if (!baseUrl) throw new Error('OLLAMA_BASE_URL not configured (env or system_kv)');
  const model = (await getSecret('OLLAMA_CHAT_MODEL')) || (await getSecret('OLLAMA_MODEL')) || 'qwen2.5:3b-instruct';
  return { baseUrl: baseUrl.replace(/\/$/, ''), model };
}

// Fallback: read live tunnel URL from `public.system_kv` (key='ollama_base_url').
// Cached briefly inside the same function instance for performance.
let _cachedUrl: { url: string; at: number } | null = null;
const URL_CACHE_MS = 30_000;
async function getDynamicBaseUrl(): Promise<string | null> {
  if (_cachedUrl && Date.now() - _cachedUrl.at < URL_CACHE_MS) return _cachedUrl.url;
  const supaUrl = Deno.env.get('SUPABASE_URL');
  const srk = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!supaUrl || !srk) return null;
  try {
    const r = await fetch(`${supaUrl}/rest/v1/system_kv?key=eq.ollama_base_url&select=value`, {
      headers: { apikey: srk, Authorization: `Bearer ${srk}` },
    });
    if (!r.ok) return null;
    const rows = await r.json() as Array<{ value: string }>;
    const url = rows?.[0]?.value;
    if (url) { _cachedUrl = { url, at: Date.now() }; return url; }
  } catch { /* ignore */ }
  return null;
}

async function chatHeaders(): Promise<Record<string, string>> {
  const sharedSecret = await getSecret('OLLAMA_SHARED_SECRET');
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (sharedSecret) headers['X-Plynth-Token'] = sharedSecret;
  return headers;
}

export interface ChatMsg { role: 'system' | 'user' | 'assistant' | 'tool'; content: string }

/** One-shot non-streaming JSON-mode chat. Used for tool-call decisions. */
export async function ollamaChatJSON(messages: ChatMsg[], opts?: { model?: string; timeoutMs?: number }): Promise<string> {
  const { baseUrl, model } = await chatBaseAndModel();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? CHAT_TIMEOUT_MS);
  try {
    const r = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: await chatHeaders(),
      body: JSON.stringify({
        model: opts?.model ?? model,
        messages,
        stream: false,
        format: 'json',
        keep_alive: '30m',
        options: { temperature: 0.1, num_predict: 128 },
      }),
      signal: ctl.signal,
    });
    if (!r.ok) {
      const detail = (await r.text()).slice(0, 400);
      throw new Error(`Ollama chat ${r.status}: ${detail}`);
    }
    const data = await r.json();
    return data?.message?.content ?? '';
  } finally {
    clearTimeout(t);
  }
}

/** Streaming chat. Yields token deltas as they arrive (Ollama NDJSON). */
export async function* ollamaChatStream(
  messages: ChatMsg[],
  opts?: { model?: string; timeoutMs?: number; signal?: AbortSignal },
): AsyncGenerator<string, void, unknown> {
  const { baseUrl, model } = await chatBaseAndModel();
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), opts?.timeoutMs ?? CHAT_TIMEOUT_MS);
  if (opts?.signal) {
    if (opts.signal.aborted) ctl.abort();
    else opts.signal.addEventListener('abort', () => ctl.abort(), { once: true });
  }
  try {
    const r = await fetch(`${baseUrl}/api/chat`, {
      method: 'POST',
      headers: await chatHeaders(),
      body: JSON.stringify({
        model: opts?.model ?? model,
        messages,
        stream: true,
        keep_alive: '30m',
        options: { temperature: 0.4, num_predict: 768 },
      }),
      signal: ctl.signal,
    });
    if (!r.ok || !r.body) {
      const detail = r.body ? (await r.text()).slice(0, 400) : '';
      throw new Error(`Ollama chat stream ${r.status}: ${detail}`);
    }
    const reader = r.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trim();
        buf = buf.slice(nl + 1);
        if (!line) continue;
        try {
          const obj = JSON.parse(line);
          const delta: string = obj?.message?.content ?? '';
          if (delta) yield delta;
          if (obj?.done) return;
        } catch { /* skip malformed line */ }
      }
    }
  } finally {
    clearTimeout(t);
  }
}
