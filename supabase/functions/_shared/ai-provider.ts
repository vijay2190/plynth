// _shared/ai-provider.ts — single dispatch point for server-side AI calls.
// Swap providers via the AI_PROVIDER secret without touching call sites.
//   AI_PROVIDER=gemini   (default)
//   AI_PROVIDER=qwen     (stub — wire up when migrating)
//
// All providers must return parsed JSON matching the requested schema hint.

import { getSecret } from './util.ts';
import { geminiJSON } from './gemini.ts';

export async function aiJSON<T>(prompt: string, schemaHint: string): Promise<T> {
  const provider = (await getSecret('AI_PROVIDER')) || 'gemini';
  switch (provider) {
    case 'gemini':
      return await geminiJSON<T>(prompt, schemaHint);
    case 'qwen':
      // Future: OpenAI-compatible endpoint (Together / Fireworks / OpenRouter / DashScope).
      // Expected secrets: QWEN_API_KEY, QWEN_BASE_URL, QWEN_MODEL.
      throw new Error('AI_PROVIDER=qwen is not yet configured. See docs/ai-providers.md');
    default:
      throw new Error(`Unknown AI_PROVIDER: ${provider}`);
  }
}
