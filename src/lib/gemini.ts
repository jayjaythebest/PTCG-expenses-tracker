import type { ScanLanguage } from './tcgdex';

// Thin client wrappers over the serverless AI endpoints (api/scan-card,
// api/detect-series, api/summary). The AI provider keys live ONLY on the server
// now — nothing here touches @google/genai, and vite no longer bundles a key.
// Each endpoint runs a multi-provider fallback chain (Gemini → Groq →
// OpenRouter) so a single provider's free quota running out never breaks scans.

// What the scan endpoint reads off the card — only the reliably-printed
// identifiers. Authoritative data is resolved afterwards via TCGdex / TW proxy.
export interface CardScanResult {
  setCode: string;
  localId: string;
  name: string;
  rarity: string;
  language: ScanLanguage | '';
  provider?: string; // which AI provider actually answered (debug/compare)
  model?: string;
  // 'ai_failed' when the provider chain errored / returned nothing readable
  // (quota exhausted, all providers down, or an unreadable photo) — lets the UI
  // distinguish "AI couldn't run" from "card genuinely not in the database".
  error?: string;
  // Diagnostics for the failure banner: which providers are configured on the
  // server, and why the chain failed ('quota' | 'no_provider' | 'unreadable' |
  // 'endpoint_missing' | 'endpoint_error' | 'network').
  providers?: string[];
  reason?: string;
  // Per-provider failure lines (e.g. "gemini:error API key not valid",
  // "groq:invalid") so the banner can show the true cause of an "unreadable".
  debug?: string[];
}

const EMPTY_SCAN: CardScanResult = { setCode: '', localId: '', name: '', rarity: '', language: '' };

// Downscale + re-encode the photo before upload: keeps the POST body small
// (well under Vercel's ~5MB limit), cuts vision-token cost, and speeds things
// up. 1600px longest edge at q0.92 keeps the tiny bottom-corner set code /
// collector number legible — critical for reflective gold (UR/MUR) cards where
// the embossed text is low-contrast; over-compressing them loses the digits.
async function fileToScaledBase64(
  file: File,
  maxEdge = 1600,
  quality = 0.92,
): Promise<{ base64: string; mimeType: string }> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });

  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = reject;
      el.src = dataUrl;
    });

    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const w = Math.round(img.width * scale);
    const h = Math.round(img.height * scale);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('no 2d context');
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', quality);
    return { base64: out.split(',')[1], mimeType: 'image/jpeg' };
  } catch {
    // Fallback: send the original bytes unmodified.
    return { base64: dataUrl.split(',')[1], mimeType: file.type || 'image/jpeg' };
  }
}

export async function recognizeCardFromPhoto(file: File): Promise<CardScanResult> {
  try {
    const { base64, mimeType } = await fileToScaledBase64(file);
    const res = await fetch('/api/scan-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
    });
    // Non-OK means the serverless endpoint itself failed — NOT that the AI
    // providers are misconfigured. 404 = function not deployed; 5xx = it crashed
    // (e.g. bad import) or timed out. Flag this distinctly so the UI doesn't
    // wrongly blame "no AI keys" (which is a res.ok=200 + reason:'no_provider').
    if (!res.ok) {
      return {
        ...EMPTY_SCAN,
        error: 'ai_failed',
        reason: res.status === 404 ? 'endpoint_missing' : 'endpoint_error',
      };
    }
    const data = await res.json();
    const lang = data.language === 'ja' || data.language === 'zh-tw' ? data.language : '';
    return {
      setCode: String(data.setCode ?? ''),
      localId: String(data.localId ?? ''),
      name: String(data.name ?? ''),
      rarity: String(data.rarity ?? ''),
      language: lang as ScanLanguage | '',
      provider: typeof data.provider === 'string' ? data.provider : undefined,
      model: typeof data.model === 'string' ? data.model : undefined,
      error: typeof data.error === 'string' ? data.error : undefined,
      providers: Array.isArray(data.providers) ? data.providers.map(String) : undefined,
      reason: typeof data.reason === 'string' ? data.reason : undefined,
      debug: Array.isArray(data.debug) ? data.debug.map(String) : undefined,
    };
  } catch {
    // fetch threw before we got a response (offline, DNS, CORS, aborted).
    return { ...EMPTY_SCAN, error: 'ai_failed', reason: 'network' };
  }
}

export interface WeeklySummaryExpense {
  title: string;
  category: string;
  amount: number;
  quantity: number;
  type: 'Expense' | 'Income';
  date: string;
}

export async function generateWeeklySummary(expenses: WeeklySummaryExpense[]): Promise<string> {
  if (expenses.length === 0) {
    return '本週沒有任何支出或收入記錄，繼續保持荷包扎實！';
  }
  const res = await fetch('/api/summary', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expenses }),
  });
  if (!res.ok) throw new Error(`summary ${res.status}`);
  const data = await res.json();
  return String(data.summary ?? '').trim();
}

export async function detectPtcgSeries(title: string): Promise<string> {
  try {
    const res = await fetch('/api/detect-series', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title }),
    });
    if (!res.ok) return '不明';
    const data = await res.json();
    return String(data.series ?? '不明').trim() || '不明';
  } catch {
    return '不明';
  }
}
