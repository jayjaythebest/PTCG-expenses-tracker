import type { VercelRequest, VercelResponse } from '@vercel/node';

// Resolves a card's market price from a free source, keyed by set code + number
// (+ edition). Japanese cards use Huca (huca.tw), which exposes a clean JSON API
// backed by Snkrdunk transaction data — prices come back in JPY. The browser
// can't call huca directly (no CORS + it would leak the scraping shape into the
// client), so this same-origin serverless function does the lookup.
//
//   GET  /api/card-price?setCode=M5&number=114&edition=ja
//   POST /api/card-price  { setCode, number, edition, name }
//
// Returns { price, currency, source, condition, url, updatedAt } — price is the
// average recent transaction price in the source's native currency; the client
// converts to TWD (see /api/fx) for display. Returns { price: null } when no
// match is found (any edition) so the UI can fall back to manual entry.
//
// Traditional-Chinese (zh-tw) pricing is not wired up yet (kapaipai is a pure
// SPA whose JSON API still needs live inspection) — it returns price: null.

const HUCA_API = 'https://huca.tw/api/api.php';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';

interface HucaRow {
  id: number;
  title?: string;
  product_link?: string;
  latest_price?: number;
  latest_condition?: string;
  average_price?: string | number;
  sort_price?: number;
}

interface PriceResult {
  price: number | null;
  currency: string | null;
  source: string | null;
  condition: string | null;
  url: string | null;
  updatedAt: string; // ISO of when this price was fetched
}

// Per-lambda cache (best-effort; survives warm invocations). 12h TTL — card
// prices move on a daily cadence and this keeps us gentle on huca.
const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: PriceResult }>();

const EMPTY: Omit<PriceResult, 'updatedAt'> = {
  price: null,
  currency: null,
  source: null,
  condition: null,
  url: null,
};

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function pickPrice(row: HucaRow): number | null {
  const avg = row.average_price != null ? Number(row.average_price) : NaN;
  if (Number.isFinite(avg) && avg > 0) return Math.round(avg);
  if (Number.isFinite(row.latest_price) && (row.latest_price as number) > 0) {
    return Math.round(row.latest_price as number);
  }
  return null;
}

// Look a Japanese card up on Huca. Prefer an exact set+number query; if that
// misses (odd set-code spellings, promos), retry a keyword search on the name.
async function lookupHuca(setCode: string, num: string, name: string): Promise<PriceResult | null> {
  const digits = (num.match(/\d+/)?.[0] ?? num).trim();
  const attempts: string[] = [];
  if (setCode && digits) {
    attempts.push(
      `${HUCA_API}?search=&set_code=${encodeURIComponent(setCode)}&card_number=${encodeURIComponent(digits)}&promo=0&accuracy=1&limit=3`,
    );
  }
  if (name) {
    attempts.push(`${HUCA_API}?search=${encodeURIComponent(name)}&promo=0&accuracy=1&limit=5`);
  }

  for (const url of attempts) {
    const json = await fetchJson<{ data?: HucaRow[] }>(url);
    const rows = json?.data ?? [];
    if (rows.length === 0) continue;
    const row = rows[0];
    const price = pickPrice(row);
    if (price == null) continue;
    return {
      price,
      currency: 'JPY',
      source: 'huca',
      condition: row.latest_condition ?? null,
      url: row.product_link ?? `https://huca.tw/cards/${row.id}`,
      updatedAt: new Date().toISOString(),
    };
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const src = req.method === 'POST' ? (req.body ?? {}) : req.query;
  const setCode = String(src.setCode ?? '').trim();
  const number = String(src.number ?? '').trim();
  const name = String(src.name ?? '').trim();
  const edition = String(src.edition ?? 'ja').trim();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=43200');

  const now = () => new Date().toISOString();

  // zh-tw pricing not implemented yet (kapaipai API pending inspection).
  if (edition === 'zh-tw') {
    return res.status(200).json({ ...EMPTY, source: 'kapaipai', updatedAt: now() });
  }

  if (!setCode && !name) {
    return res.status(400).json({ ...EMPTY, updatedAt: now(), error: 'missing setCode/name' });
  }

  const key = `${edition}:${setCode.toUpperCase()}:${number}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return res.status(200).json(hit.result);
  }

  try {
    const result = await lookupHuca(setCode, number, name);
    if (result) {
      cache.set(key, { at: Date.now(), result });
      return res.status(200).json(result);
    }
    return res.status(200).json({ ...EMPTY, updatedAt: now() });
  } catch {
    return res.status(200).json({ ...EMPTY, updatedAt: now() });
  }
}
