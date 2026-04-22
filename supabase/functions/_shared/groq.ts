// _shared/groq.ts — Groq Cloud (OpenAI-compatible) provider.
// Free tier: ~14,400 req/day per model, no monthly cap, ~10x faster than Gemini.
// Docs: https://console.groq.com/docs

import { getSecret } from './util.ts';

const PER_CALL_TIMEOUT_MS = 12_000;
const DEFAULT_PRIMARY = 'llama-3.3-70b-versatile';
const DEFAULT_FAST = 'llama-3.1-8b-instant';

export class RateLimitError extends Error {
  constructor(provider: string, detail: string) {
    super(`${provider} rate-limited: ${detail}`);
    this.name = 'RateLimitError';
  }
}

async function callGroq(model: string, key: string, body: unknown): Promise<Response> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), PER_CALL_TIMEOUT_MS);
  try {
    return await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } finally {
    clearTimeout(t);
  }
}

async function chat(model: string, messages: unknown[], asJson: boolean): Promise<string> {
  const key = await getSecret('GROQ_API_KEY');
  if (!key) throw new Error('GROQ_API_KEY not configured');

  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.7,
  };
  if (asJson) body.response_format = { type: 'json_object' };

  const r = await callGroq(model, key, body);
  if (r.status === 429) {
    const detail = (await r.text()).slice(0, 200);
    throw new RateLimitError('groq', `${model} ${detail}`);
  }
  if (!r.ok) {
    const detail = (await r.text()).slice(0, 400);
    throw new Error(`Groq ${model} → ${r.status}: ${detail}`);
  }
  const data = await r.json();
  const text = data?.choices?.[0]?.message?.content ?? '';
  if (!text || text.trim() === '' || text.trim() === '{}') {
    throw new Error(`Groq ${model} returned empty payload`);
  }
  return text;
}

export async function groqJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const model = (await getSecret('GROQ_MODEL_PRIMARY')) || DEFAULT_PRIMARY;
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
  const text = await chat(model, messages, true);
  try {
    return JSON.parse(text) as T;
  } catch (e) {
    throw new Error(`Groq ${model} invalid JSON: ${(e as Error).message} :: ${text.slice(0, 200)}`);
  }
}

export async function groqText(prompt: string, system?: string): Promise<string> {
  const model = (await getSecret('GROQ_MODEL_FAST')) || DEFAULT_FAST;
  const messages = [
    { role: 'system', content: system || 'You are a helpful assistant for Plynth users.' },
    { role: 'user', content: prompt },
  ];
  return await chat(model, messages, false);
}
