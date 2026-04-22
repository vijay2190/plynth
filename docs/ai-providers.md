# AI Providers — Plynth

Plynth's server-side AI calls go through a single dispatcher in
[supabase/functions/_shared/ai-provider.ts](../supabase/functions/_shared/ai-provider.ts).
Switch providers by setting Supabase secrets — no code change at call sites.

## Default chain (no quota)

```bash
supabase secrets set AI_PROVIDER=chain
supabase secrets set AI_PROVIDER_CHAIN=groq,ollama
```

The dispatcher tries providers in order. On rate-limit / network / timeout it
advances to the next. Auth or programming errors bubble immediately.

| Position | Provider | Why |
| --- | --- | --- |
| 1 | **Groq Cloud** | Free, ~14,400 req/day per model, no monthly cap, ~10× faster than Gemini. OpenAI-compatible. Runs `llama-3.3-70b-versatile` (primary) and `llama-3.1-8b-instant` (fast). |
| 2 | **Self-hosted Ollama** | Truly unlimited; runs on your box via Cloudflare tunnel. CPU inference with `llama3.1:8b` (~8 GB RAM). |
| opt-in | **Gemini** | Original; kept for A/B (`AI_PROVIDER=gemini`). Free tier has a hard monthly cap and a SAFETY filter that occasionally blocks benign topics like "OpenBMC" — that's why it's no longer the default. |

## Setup

### 1. Groq (mandatory for primary)

1. Create a free key at https://console.groq.com/keys
2. `supabase secrets set GROQ_API_KEY=<key>`
3. (optional) `supabase secrets set GROQ_MODEL_PRIMARY=llama-3.3-70b-versatile GROQ_MODEL_FAST=llama-3.1-8b-instant`

### 2. Ollama fallback (optional but recommended)

```bash
bash scripts/install-ollama-bridge.sh
# prints the public URL — paste into:
supabase secrets set OLLAMA_BASE_URL='https://<sub>.trycloudflare.com'
supabase secrets set OLLAMA_MODEL='llama3.1:8b'
supabase secrets set OLLAMA_SHARED_SECRET='<choose-strong-token>'
```

Without `OLLAMA_BASE_URL` the chain skips Ollama and surfaces the Groq error.

## Adding a new provider

1. Add `_shared/<name>.ts` exporting `<name>JSON<T>(prompt, schemaHint)` and
   `<name>Text(prompt, system?)`. Throw `RateLimitError` (from
   `_shared/groq.ts`) on 429 so the chain can advance.
2. Add a `case` in `tryJSON` and `tryText` inside
   [`_shared/ai-provider.ts`](../supabase/functions/_shared/ai-provider.ts).
3. Add the provider name to `AI_PROVIDER_CHAIN`.

## API surface for callers

```ts
import { aiJSON, aiText } from '../_shared/ai-provider.ts';

const plan = await aiJSON<{ items: Item[] }>(prompt, schemaHint);
const advice = await aiText('Suggest 3 ETFs for monthly SIP of 10k', 'You are a frugal Indian investor.');
```

## Use-cases inside Plynth

| Surface | Method | Notes |
| --- | --- | --- |
| Learning plans (per-topic + daily allocation) | `aiJSON` | live |
| Job-search optimization (resume → JD match) | `aiText` | planned |
| Finance advice chatbot | `aiText` | planned |
| Topic research (C, C++, OpenBMC, Linux) | `aiJSON` | live; open-source models avoid Gemini's SAFETY blocks |
