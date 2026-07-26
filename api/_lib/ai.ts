// Shared server-side AI provider layer with automatic fallback.
//
// Files under `api/` whose name starts with `_` are NOT treated as serverless
// endpoints by Vercel, so this module is safe to import from the real handlers
// (api/scan-card.ts, api/detect-series.ts, api/summary.ts, api/weekly-summary.ts).
//
// Goal: keep every provider's free quota alive. We try providers in order and
// fall through to the next one on any failure (rate limit / 4xx-5xx / empty or
// invalid JSON). Order + models are env-driven so they can be tuned without a
// code change:
//   AI_PROVIDER_ORDER   default "gemini,groq,openrouter"
//   GEMINI_VISION_MODEL / GEMINI_TEXT_MODEL
//   GROQ_VISION_MODEL   / GROQ_TEXT_MODEL      (+ GROQ_API_KEY)
//   OPENROUTER_VISION_MODEL / OPENROUTER_TEXT_MODEL (+ OPENROUTER_API_KEY)
//
// A provider is only used when its API key env var is present, so equipping a
// new provider is just "add the key in Vercel".

import { GoogleGenAI } from '@google/genai';

export type Provider = 'gemini' | 'groq' | 'openrouter';

interface RawResult {
  text: string;
  model: string;
}

interface VisionArgs {
  imageBase64: string;
  mimeType: string;
  prompt: string;
  /** Gemini responseSchema (strict JSON). Ignored by OpenAI-compatible providers. */
  schema?: unknown;
}

interface TextArgs {
  prompt: string;
}

interface Adapter {
  name: Provider;
  enabled: () => boolean;
  vision: (args: VisionArgs) => Promise<RawResult>;
  text: (args: TextArgs) => Promise<RawResult>;
}

// ---- Gemini adapter (@google/genai) ----
const geminiAdapter: Adapter = {
  name: 'gemini',
  enabled: () => !!process.env.GEMINI_API_KEY,
  async vision({ imageBase64, mimeType, prompt, schema }) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
    // Use the maintained "-latest" alias, not a pinned version. Google
    // discontinues dated flash builds (2.0/2.5 are gone as of mid-2026) and a
    // pinned ID 404s for new API keys — which is exactly what broke scanning.
    const model = process.env.GEMINI_VISION_MODEL || 'gemini-flash-latest';
    const res = await ai.models.generateContent({
      model,
      contents: [
        {
          parts: [
            { inlineData: { mimeType: mimeType as 'image/jpeg', data: imageBase64 } },
            { text: prompt },
          ],
        },
      ],
      config: {
        responseMimeType: 'application/json',
        ...(schema ? { responseSchema: schema as object } : {}),
      },
    });
    return { text: res.text ?? '', model };
  },
  async text({ prompt }) {
    const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY ?? '' });
    const model = process.env.GEMINI_TEXT_MODEL || 'gemini-flash-latest';
    const res = await ai.models.generateContent({ model, contents: prompt });
    return { text: res.text ?? '', model };
  },
};

// ---- OpenAI-compatible adapter factory (Groq, OpenRouter) ----
function openAiCompatible(opts: {
  name: Provider;
  baseUrl: string;
  keyEnv: string;
  visionModelEnv: string;
  visionModelDefault: string;
  textModelEnv: string;
  textModelDefault: string;
  extraHeaders?: Record<string, string>;
}): Adapter {
  const call = async (model: string, messages: unknown, json: boolean): Promise<string> => {
    const res = await fetch(`${opts.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${process.env[opts.keyEnv] ?? ''}`,
        ...opts.extraHeaders,
      },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0,
        ...(json ? { response_format: { type: 'json_object' } } : {}),
      }),
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`${opts.name} ${res.status} ${body.slice(0, 200)}`);
    }
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content ?? '');
  };

  return {
    name: opts.name,
    enabled: () => !!process.env[opts.keyEnv],
    async vision({ imageBase64, mimeType, prompt }) {
      const model = process.env[opts.visionModelEnv] || opts.visionModelDefault;
      const messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: `data:${mimeType};base64,${imageBase64}` } },
          ],
        },
      ];
      return { text: await call(model, messages, true), model };
    },
    async text({ prompt }) {
      const model = process.env[opts.textModelEnv] || opts.textModelDefault;
      const messages = [{ role: 'user', content: prompt }];
      return { text: await call(model, messages, false), model };
    },
  };
}

const groqAdapter = openAiCompatible({
  name: 'groq',
  baseUrl: 'https://api.groq.com/openai/v1',
  keyEnv: 'GROQ_API_KEY',
  visionModelEnv: 'GROQ_VISION_MODEL',
  // llama-4-scout was deprecated on Groq; use the current Llama-4 Maverick
  // vision model. Override with GROQ_VISION_MODEL if Groq rotates it again.
  visionModelDefault: 'meta-llama/llama-4-maverick-17b-128e-instruct',
  textModelEnv: 'GROQ_TEXT_MODEL',
  textModelDefault: 'llama-3.3-70b-versatile',
});

const openRouterAdapter = openAiCompatible({
  name: 'openrouter',
  baseUrl: 'https://openrouter.ai/api/v1',
  keyEnv: 'OPENROUTER_API_KEY',
  visionModelEnv: 'OPENROUTER_VISION_MODEL',
  // llama-3.2-11b-vision:free was removed from OpenRouter. Default to a current
  // free vision model; override with OPENROUTER_VISION_MODEL as needed.
  visionModelDefault: 'meta-llama/llama-4-scout:free',
  textModelEnv: 'OPENROUTER_TEXT_MODEL',
  textModelDefault: 'meta-llama/llama-4-scout:free',
  extraHeaders: { 'X-Title': 'PTCG Expenses Tracker' },
});

const ADAPTERS: Record<Provider, Adapter> = {
  gemini: geminiAdapter,
  groq: groqAdapter,
  openrouter: openRouterAdapter,
};

// Ordered, enabled provider list. Unknown names in AI_PROVIDER_ORDER are ignored.
function providerOrder(): Provider[] {
  const raw = (process.env.AI_PROVIDER_ORDER || 'gemini,groq,openrouter')
    .split(',')
    .map(s => s.trim().toLowerCase())
    .filter((p): p is Provider => p === 'gemini' || p === 'groq' || p === 'openrouter');
  const order = raw.length ? raw : (['gemini', 'groq', 'openrouter'] as Provider[]);
  // De-dupe while preserving order, then keep only providers that have a key.
  return [...new Set(order)].filter(p => ADAPTERS[p].enabled());
}

// The providers that are actually usable right now (key present + in the
// configured order). Exposed so endpoints can report configuration back to the
// client — e.g. to hint that only one provider is set up, so a single quota
// wall takes the whole chain down.
export function enabledProviders(): Provider[] {
  return providerOrder();
}

// Extract the first JSON object from a model response (tolerates code fences /
// leading prose that non-strict providers sometimes emit).
function parseJsonLoose<T>(text: string): T | null {
  const cleaned = text.replace(/```json/gi, '').replace(/```/g, '').trim();
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(cleaned.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}

export interface AiResult<T> {
  data: T;
  provider: Provider;
  model: string;
  attempts?: VisionAttempt[];
}

// Per-provider outcome of one vision→JSON pass, kept so a total failure isn't a
// black box: the endpoint can report exactly which provider failed and why
// (bad key, wrong model, quota, or a model that simply couldn't read the card).
export interface VisionAttempt {
  provider: Provider;
  model?: string;
  outcome: 'ok' | 'error' | 'invalid' | 'empty';
  detail?: string;
}

// Error thrown when every provider fails; carries the per-provider attempts so
// callers can surface them for diagnosis.
export interface VisionChainError extends Error {
  attempts: VisionAttempt[];
}

// Run a vision→JSON task across the provider chain. `validate` decides whether a
// parsed object is acceptable; a rejected/failed provider is skipped. Records an
// attempt per provider so the caller can see why the whole chain failed.
export async function visionJson<T>(
  args: VisionArgs & { validate: (obj: unknown) => obj is T },
): Promise<AiResult<T>> {
  const order = providerOrder();
  const attempts: VisionAttempt[] = [];
  for (const p of order) {
    try {
      const raw = await ADAPTERS[p].vision(args);
      const parsed = parseJsonLoose<unknown>(raw.text);
      if (parsed && args.validate(parsed)) {
        attempts.push({ provider: p, model: raw.model, outcome: 'ok' });
        return { data: parsed, provider: p, model: raw.model, attempts };
      }
      // Distinguish "couldn't parse any JSON" (empty) from "parsed but the shape
      // didn't pass validation" (invalid) — the two point at different fixes.
      attempts.push({
        provider: p,
        model: raw.model,
        outcome: parsed ? 'invalid' : 'empty',
      });
    } catch (e) {
      const detail = (e instanceof Error ? e.message : String(e ?? '')).slice(0, 140);
      attempts.push({ provider: p, outcome: 'error', detail });
    }
  }
  const err = new Error('all vision providers failed') as VisionChainError;
  err.attempts = attempts;
  throw err;
}

// Run a text-completion task across the provider chain. Returns trimmed text.
export async function textCompletion(args: TextArgs): Promise<AiResult<string>> {
  const order = providerOrder();
  let lastErr: unknown = null;
  for (const p of order) {
    try {
      const raw = await ADAPTERS[p].text(args);
      const text = raw.text.trim();
      if (text) return { data: text, provider: p, model: raw.model };
      lastErr = new Error(`${p}: empty text`);
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('no AI provider available');
}
