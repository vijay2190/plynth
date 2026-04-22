// _shared/ai-provider.ts — single dispatch point for server-side AI calls.
// Configure via Supabase secrets (no code change needed at call sites):
//   AI_PROVIDER=chain                    (default — try providers in order)
//   AI_PROVIDER_CHAIN=groq,ollama        (default chain)
//   AI_PROVIDER=groq | ollama | gemini   (single provider, no fallback)

import { getSecret } from './util.ts';
import { geminiJSON } from './gemini.ts';
import { groqJSON, groqText, RateLimitError } from './groq.ts';
import { ollamaJSON, ollamaText } from './ollama.ts';

type Provider = 'gemini' | 'groq' | 'ollama';

async function resolveChain(): Promise<Provider[]> {
  const mode = ((await getSecret('AI_PROVIDER')) || 'chain').toLowerCase();
  if (mode === 'chain') {
    const chain = ((await getSecret('AI_PROVIDER_CHAIN')) || 'groq,ollama')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean) as Provider[];
    return chain.length ? chain : ['groq', 'ollama'];
  }
  return [mode as Provider];
}

async function tryJSON<T>(provider: Provider, prompt: string, schemaHint: string): Promise<T> {
  switch (provider) {
    case 'groq':
      return await groqJSON<T>(prompt, schemaHint);
    case 'ollama':
      return await ollamaJSON<T>(prompt, schemaHint);
    case 'gemini':
      return await geminiJSON<T>(prompt, schemaHint);
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

async function tryText(provider: Provider, prompt: string, system?: string): Promise<string> {
  switch (provider) {
    case 'groq':
      return await groqText(prompt, system);
    case 'ollama':
      return await ollamaText(prompt, system);
    case 'gemini': {
      const r = await geminiJSON<{ text: string }>(
        `${system ? system + '\n\n' : ''}${prompt}`,
        '{"text": "..."}',
      );
      return r.text;
    }
    default:
      throw new Error(`Unknown AI provider: ${provider}`);
  }
}

function isRetryable(err: unknown): boolean {
  if (err instanceof RateLimitError) return true;
  const msg = (err as Error)?.message || '';
  return /aborted|timeout|ECONNREFUSED|fetch failed|503|502|504|not configured|empty payload|quota/i.test(
    msg,
  );
}

export async function aiJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const chain = await resolveChain();
  let lastErr: unknown = null;
  for (const p of chain) {
    try {
      const out = await tryJSON<T>(p, prompt, schemaHint);
      console.log(`[ai-provider] ${p} ok`);
      return out;
    } catch (e) {
      console.warn(`[ai-provider] ${p} failed: ${(e as Error).message}`);
      lastErr = e;
      if (!isRetryable(e)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed');
}

export async function aiText(prompt: string, system?: string): Promise<string> {
  const chain = await resolveChain();
  let lastErr: unknown = null;
  for (const p of chain) {
    try {
      const out = await tryText(p, prompt, system);
      console.log(`[ai-provider] ${p} ok (text)`);
      return out;
    } catch (e) {
      console.warn(`[ai-provider] ${p} failed (text): ${(e as Error).message}`);
      lastErr = e;
      if (!isRetryable(e)) break;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('All AI providers failed');
}

export async function aiActiveProvider(): Promise<string> {
  const chain = await resolveChain();
  return chain.join(',');
}
