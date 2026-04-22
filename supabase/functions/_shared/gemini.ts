// _shared/gemini.ts — minimal Gemini REST client with retry + model fallback

import { getSecret } from './util.ts';

const MODELS = ['gemini-2.5-flash', 'gemini-2.0-flash', 'gemini-flash-latest'];

async function callOnce(model: string, key: string, body: unknown): Promise<Response> {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${key}`;
  return await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

export async function geminiJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const key = await getSecret('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const body = {
    contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nReturn ONLY valid JSON matching this shape:\n${schemaHint}` }] }],
    generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
  };

  let lastErr = '';
  for (const model of MODELS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      const r = await callOnce(model, key, body);
      if (r.ok) {
        const data = await r.json();
        const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
        return JSON.parse(text) as T;
      }
      lastErr = `${model} → ${r.status}: ${await r.text()}`;
      // Retry only on 429/503 (overload). Otherwise, switch model.
      if (r.status !== 429 && r.status !== 503) break;
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  throw new Error(`Gemini failed after retries: ${lastErr}`);
}
