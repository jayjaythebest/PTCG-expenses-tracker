import type { ScanLanguage } from './tcgdex';
import { apiFetch } from './apiFetch';

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
  // Set NAME, filled only when the endpoint confirmed the card against a live
  // card table — the app's catalog may not carry a set this new.
  setName?: string;
  // 'huca' when the ja identifiers were confirmed (or corrected) against Huca,
  // which makes name/setCode/rarity authoritative even with no TCGdex record.
  verified?: string;
  // Graded-slab label, when the card is encased. Empty for raw cards.
  // gradingCompany is the raw label text ("PSA"/"BGS"/…); the caller normalizes it.
  gradingCompany?: string;
  grade?: string;
  gradingCert?: string;
  provider?: string; // which AI provider actually answered (debug/compare)
  model?: string;
  // 'ai_failed' when the provider chain errored / returned nothing readable
  // (quota exhausted, all providers down, or an unreadable photo) — lets the UI
  // distinguish "AI couldn't run" from "card genuinely not in the database".
  error?: string;
  // Diagnostics for the failure banner: which providers are configured on the
  // server, and why the chain failed ('quota' | 'no_provider' | 'unreadable' |
  // 'endpoint_missing' | 'endpoint_error' | 'network' | 'unauthorized' |
  // 'auth_unconfigured').
  providers?: string[];
  reason?: string;
  // Per-provider failure lines (e.g. "gemini:error API key not valid",
  // "groq:invalid") so the banner can show the true cause of an "unreadable".
  debug?: string[];
}

// One card out of a multi-card photo: the same read, plus where it sits in the
// image ([ymin, xmin, ymax, xmax], 0–1000 of the height/width — Gemini's box_2d)
// so the review list can show the actual card the row came from.
export interface ScannedCard extends CardScanResult {
  box?: number[];
}

export interface MultiScanResult {
  cards: ScannedCard[];
  provider?: string;
  // Same failure fields as a single scan — the whole read either ran or didn't.
  error?: string;
  providers?: string[];
  reason?: string;
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

function httpFailureReason(status: number): string {
  if (status === 401) return 'unauthorized';
  if (status === 503) return 'auth_unconfigured';
  if (status === 404) return 'endpoint_missing';
  return 'endpoint_error';
}

export async function recognizeCardFromPhoto(file: File): Promise<CardScanResult> {
  try {
    const { base64, mimeType } = await fileToScaledBase64(file);
    const res = await apiFetch('/api/scan-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType }),
    });
    // Non-OK means the serverless endpoint itself failed — NOT that the AI
    // providers are misconfigured. 401 = the JWT gate rejected us (session
    // expired); 503 = the gate has no Supabase config on the server; 404 =
    // function not deployed; other 5xx = it crashed (e.g. bad import) or timed
    // out. Flag these distinctly so the UI doesn't wrongly blame "no AI keys"
    // (which is a res.ok=200 + reason:'no_provider') or tell the user to wait
    // when the real fix is re-logging in / adding an env var.
    if (!res.ok) {
      return { ...EMPTY_SCAN, error: 'ai_failed', reason: httpFailureReason(res.status) };
    }
    return parseScanCard(await res.json());
  } catch {
    // fetch threw before we got a response (offline, DNS, CORS, aborted).
    return { ...EMPTY_SCAN, error: 'ai_failed', reason: 'network' };
  }
}

// Endpoint JSON -> ScannedCard. Pure, and shared by the single and the batch
// read so one card out of a photo of six is normalized exactly like a card
// photographed on its own.
export function parseScanCard(raw: unknown): ScannedCard {
  const data = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);
  const lang = data.language === 'ja' || data.language === 'zh-tw' ? data.language : '';
  const box = Array.isArray(data.box) && data.box.length === 4 && data.box.every(n => typeof n === 'number' && Number.isFinite(n))
    ? (data.box as number[])
    : undefined;
  return {
    setCode: String(data.setCode ?? ''),
    localId: String(data.localId ?? ''),
    name: String(data.name ?? ''),
    rarity: String(data.rarity ?? ''),
    language: lang as ScanLanguage | '',
    setName: str('setName'),
    verified: str('verified') || undefined,
    gradingCompany: str('gradingCompany'),
    grade: str('grade'),
    gradingCert: str('gradingCert'),
    provider: str('provider'),
    model: str('model'),
    error: str('error'),
    providers: Array.isArray(data.providers) ? data.providers.map(String) : undefined,
    reason: str('reason'),
    debug: Array.isArray(data.debug) ? data.debug.map(String) : undefined,
    box,
  };
}

// Endpoint JSON -> the batch result. Pure. Drops entries the read couldn't put
// a name OR a set code + number on: a row with nothing identifiable on it is
// something the user would only have to untick again.
export function parseMultiScan(raw: unknown): MultiScanResult {
  const data = (raw ?? {}) as Record<string, unknown>;
  const str = (k: string) => (typeof data[k] === 'string' ? (data[k] as string) : undefined);
  const cards = (Array.isArray(data.cards) ? data.cards : [])
    .map(parseScanCard)
    .filter(c => c.name.trim() || (c.setCode.trim() && c.localId.trim()));
  return {
    cards,
    provider: str('provider'),
    error: str('error'),
    providers: Array.isArray(data.providers) ? data.providers.map(String) : undefined,
    reason: str('reason'),
    debug: Array.isArray(data.debug) ? data.debug.map(String) : undefined,
  };
}

// Read EVERY card in one photo. Same endpoint and the same per-card rules as
// recognizeCardFromPhoto (`multi: true` switches the prompt), so a batch read
// is held to the same standard — including the Huca confirmation of a Japanese
// set code. The photo goes up larger than a single-card shot: six cards on a
// table means each one is a fraction of the frame, and the set code is 2mm of
// low-contrast print in the corner of that fraction.
export async function recognizeCardsFromPhoto(file: File): Promise<MultiScanResult> {
  try {
    const { base64, mimeType } = await fileToScaledBase64(file, 2400, 0.9);
    const res = await apiFetch('/api/scan-card', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageBase64: base64, mimeType, multi: true }),
    });
    if (!res.ok) {
      return { cards: [], error: 'ai_failed', reason: httpFailureReason(res.status) };
    }
    return parseMultiScan(await res.json());
  } catch {
    return { cards: [], error: 'ai_failed', reason: 'network' };
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
  const res = await apiFetch('/api/summary', {
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
    const res = await apiFetch('/api/detect-series', {
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
