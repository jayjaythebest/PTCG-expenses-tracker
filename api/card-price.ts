import type { VercelRequest, VercelResponse } from '@vercel/node';
import { resolveCardPrice, buildWantGrade, EMPTY_PRICE, type PriceResult } from './_lib/pricing';

// Resolves a card's market price from a free source, keyed by set code + number
// (+ edition). Japanese cards use Huca (huca.tw), which exposes a clean JSON API
// backed by Snkrdunk transaction data — prices come back in JPY. Traditional
// Chinese (zh-tw) cards use kapaipai (trade.kapaipai.tw), whose public JSON API
// returns per-card lowest/average trade prices in TWD. The browser can't call
// either directly (no CORS + it would leak the scraping shape into the client),
// so this same-origin serverless function does the lookup.
//
//   GET  /api/card-price?setCode=M5&number=114&edition=ja
//   POST /api/card-price  { setCode, number, edition, name, setName }
//
// Returns { price, currency, source, condition, url, updatedAt } — price is the
// average recent transaction price in the source's native currency (JPY for
// huca, TWD for kapaipai); the client converts JPY to TWD (see /api/fx) for
// display. Returns { price: null } when no match is found so the UI can fall
// back to manual entry. The actual source lookups live in ./_lib/pricing so the
// daily cron (/api/snapshot-collection) can reuse the exact same resolver.

// Per-lambda result cache (best-effort; survives warm invocations). 12h TTL —
// card prices move on a daily cadence and this keeps us gentle on the sources.
const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: PriceResult }>();

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const src = req.method === 'POST' ? (req.body ?? {}) : req.query;
  const setCode = String(src.setCode ?? '').trim();
  const setName = String(src.setName ?? '').trim();
  const number = String(src.number ?? '').trim();
  const name = String(src.name ?? '').trim();
  const edition = String(src.edition ?? 'ja').trim();
  const isGraded = src.isGraded === true || src.isGraded === 'true';
  const gradingCompany = String(src.gradingCompany ?? '').trim();
  const grade = String(src.grade ?? '').trim();
  const wantGrade = buildWantGrade(isGraded, gradingCompany, grade);
  const itemType = String(src.itemType ?? 'single').trim();
  const snkrdunkId = String(src.snkrdunkId ?? '').trim();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=43200');

  const now = () => new Date().toISOString();

  const isBoxWithId = itemType === 'box' && !!snkrdunkId;
  if (!isBoxWithId) {
    if (edition === 'zh-tw') {
      if (!setCode && !setName && !number) {
        return res.status(400).json({ ...EMPTY_PRICE, source: 'kapaipai', updatedAt: now(), error: 'missing set/number' });
      }
    } else if (!setCode && !name) {
      return res.status(400).json({ ...EMPTY_PRICE, updatedAt: now(), error: 'missing setCode/name' });
    }
  }

  const key = `${edition}:${itemType}:${(setName || setCode).toUpperCase()}:${number}:${snkrdunkId || (wantGrade ?? 'raw')}`;
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) {
    return res.status(200).json(hit.result);
  }

  const emptySource = edition === 'zh-tw' ? 'kapaipai' : null;

  try {
    const result = await resolveCardPrice({ setCode, setName, number, name, edition, wantGrade, itemType, snkrdunkId });
    if (result) {
      cache.set(key, { at: Date.now(), result });
      return res.status(200).json(result);
    }
    return res.status(200).json({ ...EMPTY_PRICE, source: emptySource, updatedAt: now() });
  } catch {
    return res.status(200).json({ ...EMPTY_PRICE, source: emptySource, updatedAt: now() });
  }
}
