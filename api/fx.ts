import type { VercelRequest, VercelResponse } from '@vercel/node';

// Currency conversion rate for the collection's value display. Market prices are
// stored in their source's native currency (JPY from Huca) but shown in TWD, so
// the client needs a JPY -> TWD rate. We proxy Huca's own fx endpoint (rates are
// per 1 USD) so our conversion matches the numbers Huca itself shows. Falls back
// to a reasonable static rate if the source is unreachable.
//
//   GET /api/fx  ->  { jpyToTwd, updatedAt, source }

const HUCA_FX = 'https://huca.tw/api/fx_rates.php';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';
const FALLBACK_JPY_TO_TWD = 0.2; // rough long-run rate; only used if fetch fails

const TTL_MS = 12 * 60 * 60 * 1000;
let cache: { at: number; jpyToTwd: number; source: string } | null = null;

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=43200');

  if (cache && Date.now() - cache.at < TTL_MS) {
    return res.status(200).json({ jpyToTwd: cache.jpyToTwd, updatedAt: new Date(cache.at).toISOString(), source: cache.source });
  }

  let jpyToTwd = FALLBACK_JPY_TO_TWD;
  let source = 'fallback';
  try {
    const r = await fetch(HUCA_FX, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const rates = (await r.json()) as Record<string, number>;
      // rates are per 1 USD, so JPY -> TWD = TWD_perUSD / JPY_perUSD.
      if (Number.isFinite(rates.JPY) && Number.isFinite(rates.TWD) && rates.JPY > 0) {
        jpyToTwd = rates.TWD / rates.JPY;
        source = 'huca';
      }
    }
  } catch {
    // keep fallback
  }

  cache = { at: Date.now(), jpyToTwd, source };
  return res.status(200).json({ jpyToTwd, updatedAt: new Date().toISOString(), source });
}
