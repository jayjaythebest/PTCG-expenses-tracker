import type { VercelRequest, VercelResponse } from '@vercel/node';

// Resolves precise official-style Japanese card artwork by set code + collector
// number. Two complementary free sources, tried in order:
//
//   1. SNKRDUNK (スニダン) — a JP marketplace whose product API keys cards as
//      `pkmn-tcg-{SET}-{number}` and returns a background-removed card image.
//      Covers high-value chase cards (SAR/UR) of the newest sets, including the
//      secret rares that Limitless hasn't uploaded yet.
//   2. Limitless TCG CDN — full card scans for essentially every set, keyed by
//      the same set code + unpadded number. Covers base-set commons/uncommons
//      that SNKRDUNK (a marketplace) doesn't list.
//
// Both APIs are cross-origin with no CORS header, so the browser can't call them
// directly — this same-origin proxy does the lookup server-side and returns just
// the image URL. The image files themselves hotlink freely from an <img> tag.
//
//   GET /api/jp-card-image?set=M5&number=117  → { imageUrl, source }

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const LIMITLESS_CDN = 'https://limitlesstcg.nyc3.cdn.digitaloceanspaces.com/tpc';

async function snkrdunkImage(set: string, num: number): Promise<string | null> {
  try {
    const pn = `pkmn-tcg-${set}-${num}`;
    const res = await fetch(
      `https://snkrdunk.com/v1/apparels?productNumber=${encodeURIComponent(pn)}`,
      { headers: { 'User-Agent': UA, Accept: 'application/json' } },
    );
    if (!res.ok) return null;
    const data = await res.json();
    const apparels: Array<{ primaryMedia?: { imageUrl?: unknown } }> = Array.isArray(data?.apparels) ? data.apparels : [];
    const url = apparels[0]?.primaryMedia?.imageUrl;
    return typeof url === 'string' && url ? url : null;
  } catch {
    return null;
  }
}

async function limitlessImage(set: string, num: number): Promise<string | null> {
  // Spaces returns 200 when the object exists, 403 when it doesn't.
  const url = `${LIMITLESS_CDN}/${set}/${set}_${num}_R_JP.png`;
  try {
    const res = await fetch(url, { method: 'HEAD', headers: { 'User-Agent': UA } });
    return res.ok ? url : null;
  } catch {
    return null;
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const set = String(req.query.set ?? '').trim();
  const numRaw = String(req.query.number ?? '').trim();
  // Accept messy input ("114/083") → collector number before the slash.
  const num = Number(numRaw.match(/(\d+)\s*\/\s*\d+/)?.[1] ?? numRaw.match(/\d+/)?.[0]);

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Resolved image URLs are stable enough — cache hard at the edge and browser.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');

  if (!set || !Number.isFinite(num) || num <= 0) {
    return res.status(400).json({ imageUrl: null, error: 'missing set/number' });
  }

  try {
    const snkr = await snkrdunkImage(set, num);
    if (snkr) return res.status(200).json({ imageUrl: snkr, source: 'snkrdunk' });

    const limitless = await limitlessImage(set, num);
    if (limitless) return res.status(200).json({ imageUrl: limitless, source: 'limitless' });

    return res.status(200).json({ imageUrl: null });
  } catch {
    return res.status(200).json({ imageUrl: null });
  }
}
