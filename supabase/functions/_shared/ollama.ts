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
  const baseUrl = await getSecret('OLLAMA_BASE_URL');
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
