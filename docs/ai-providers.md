# AI Providers — Plynth

The server-side AI dispatcher lives in [supabase/functions/_shared/ai-provider.ts](../supabase/functions/_shared/ai-provider.ts).
Switch providers by setting the `AI_PROVIDER` Supabase secret. No code changes needed at call sites — they all go through `aiJSON()`.

```bash
supabase secrets set AI_PROVIDER=gemini   # current default
```

## Current: Gemini (default)

- Models tried in order: `gemini-2.5-flash` → `gemini-2.0-flash` → `gemini-flash-latest`.
- Free tier on `generativelanguage.googleapis.com` is generous (~15 RPM, 1M TPM, 1500 req/day for 2.5 Flash as of 2026-04).
- Pricing (paid tier): ~$0.075 / 1M input tokens, $0.30 / 1M output tokens.
- Known caveat: SAFETY filter occasionally blocks innocuous prompts. We log `finishReason` and `promptFeedback` so SAFETY blocks are visible in `supabase functions logs`.

## Future: Qwen3-30B-A3B

> Note: the model name "qwen3.6-35B-A3B" does not exist. The intended model is **Qwen3-30B-A3B** — a Mixture-of-Experts model with **3 B active parameters** out of a **30 B** total, released April 2025 under Apache-2.0.

### Hosting options
| Option | Notes | Rough cost |
| --- | --- | --- |
| **Self-host** (vLLM / Ollama) | Apache-2.0 weights. Needs ~24 GB VRAM (Q4) or ~60 GB (FP16). | $0 marginal once GPU is paid for. |
| **Together.ai** | OpenAI-compatible API. | ~$0.20 / M in, $0.60 / M out |
| **Fireworks** | OpenAI-compatible. | similar to Together |
| **Hyperbolic** | OpenAI-compatible. | ~$0.10 / M (cheapest hosted) |
| **OpenRouter** | OpenAI-compatible, free tier exists but heavily throttled. | Free / pay per use |
| **Alibaba DashScope** | Native API + OpenAI-compat endpoint. | Region-dependent |

### Pros (vs Gemini)
- **No SAFETY blocks** — open-weight models don't refuse on benign topic names like "openBMC" or "exploit techniques". This is the suspected cause of the empty-payload bug we just fixed.
- Open weights → can self-host for privacy / unlimited quota.
- 32 K context (extensible to 128 K via YaRN).
- Strong on code + multilingual (Chinese, Japanese, etc.).
- Stable structured-output mode via guided decoding (vLLM / outlines).

### Cons
- Hosted endpoints are **~3× more expensive** than Gemini 2.5 Flash for input tokens.
- Smaller community than OpenAI/Gemini → fewer SDKs, less doc.
- Self-host needs hardware + uptime ops.

### Limits to plan around
- Together free trial: $1 credit, then pay-per-use.
- OpenRouter free models: 20 req/min, 200 req/day.
- Self-host: only your own hardware throughput.

## Recommendation

1. **Now**: stay on Gemini — it works and is free.
2. **When chatbot ships**: add `AI_PROVIDER=qwen` wiring in [`_shared/ai-provider.ts`](../supabase/functions/_shared/ai-provider.ts) using the OpenAI-compatible client (`fetch` against `${QWEN_BASE_URL}/chat/completions`). Required secrets:
   - `QWEN_API_KEY`
   - `QWEN_BASE_URL` (e.g. `https://api.together.xyz/v1`)
   - `QWEN_MODEL` (e.g. `Qwen/Qwen3-30B-A3B-Instruct`)
3. A/B test by flipping `AI_PROVIDER` on a single edge function first, not all at once.
