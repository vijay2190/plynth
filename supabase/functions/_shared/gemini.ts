// _shared/gemini.ts — minimal Gemini 2.5 Flash REST client

import { getSecret } from './util.ts';

export async function geminiJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const key = await getSecret('GEMINI_API_KEY');
  if (!key) throw new Error('GEMINI_API_KEY not configured');
  const url = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`;
  const r = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: `${prompt}\n\nReturn ONLY valid JSON matching this shape:\n${schemaHint}` }] }],
      generationConfig: { responseMimeType: 'application/json', temperature: 0.7 },
    }),
  });
  if (!r.ok) throw new Error(`Gemini ${r.status}: ${await r.text()}`);
  const data = await r.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? '{}';
  return JSON.parse(text) as T;
}
