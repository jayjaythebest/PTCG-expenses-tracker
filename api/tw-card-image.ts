import type { VercelRequest, VercelResponse } from '@vercel/node';

// Resolves precise official Traditional-Chinese card / product artwork from the
// official Pokémon TCG Asia site (asia.pokemon-card.com/tw). That site serves no
// CORS header, so the browser cannot scrape its search pages directly — this
// same-origin proxy does the lookup server-side and returns just the image URL.
// The images themselves hotlink freely, so the browser then loads them directly.
//
//   GET /api/tw-card-image?set=M5            → booster/product pack image
//   GET /api/tw-card-image?set=M5&number=16  → the exact card (016/081) image
//
// Card image ids are sequential with the collector number within an expansion
// (verified: M5 001 = tw00019145, 016 = tw00019160), so once we know the first
// card's id we can compute any card's image without scraping every page.

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';

// Per-lambda in-memory caches (best-effort; survive warm invocations).
const firstCardIdCache = new Map<string, number | null>();
let productMap: Map<string, string> | null = null;

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// First card's 8-digit image id for an expansion (== collector number 001).
async function getFirstCardId(set: string): Promise<number | null> {
  const key = set.toUpperCase();
  if (firstCardIdCache.has(key)) return firstCardIdCache.get(key)!;
  const html = await fetchText(
    `${BASE}/tw/card-search/list/?pageNo=1&expansionCodes=${encodeURIComponent(set)}`,
  );
  const m = html?.match(/card-img\/tw0*(\d+)\.png/i);
  const id = m ? Number(m[1]) : null;
  firstCardIdCache.set(key, id);
  return id;
}

// Map of expansion code → product/pack image URL, scraped once from the
// card-search landing page (filenames start with the code, e.g. M5_pillow_...).
async function getProductMap(): Promise<Map<string, string>> {
  if (productMap) return productMap;
  const map = new Map<string, string>();
  const html = await fetchText(`${BASE}/tw/card-search/`);
  if (html) {
    const re = /card-img\/products\/([A-Za-z0-9]+)_[^"'\s]*\.png/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(html))) {
      const code = m[1].toUpperCase();
      if (!map.has(code)) map.set(code, `${BASE}/tw/card-img/products/${m[0].split('/').pop()}`);
    }
  }
  productMap = map;
  return map;
}

const pad8 = (n: number) => String(n).padStart(8, '0');
const cardImageUrl = (id: number) => `${BASE}/tw/card-img/tw${pad8(id)}.png`;

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const set = String(req.query.set ?? '').trim();
  const numberRaw = String(req.query.number ?? '').trim();
  const number = numberRaw ? Number(numberRaw.match(/\d+/)?.[0]) : NaN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Resolved image URLs are stable — cache hard at the edge and in the browser.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');

  if (!set) {
    return res.status(400).json({ imageUrl: null, error: 'missing set' });
  }

  try {
    // 1) Precise single card, when a collector number is given.
    if (Number.isFinite(number) && number > 0) {
      const firstId = await getFirstCardId(set);
      if (firstId) {
        return res.status(200).json({ imageUrl: cardImageUrl(firstId + number - 1), kind: 'card' });
      }
    }

    // 2) Product / pack image (boxes, packs, or singles with no number).
    const products = await getProductMap();
    const product = products.get(set.toUpperCase());
    if (product) {
      return res.status(200).json({ imageUrl: product, kind: 'product' });
    }

    // 3) Fall back to the expansion's first card as a representative image.
    const firstId = await getFirstCardId(set);
    if (firstId) {
      return res.status(200).json({ imageUrl: cardImageUrl(firstId), kind: 'card' });
    }

    return res.status(200).json({ imageUrl: null });
  } catch {
    return res.status(200).json({ imageUrl: null });
  }
}
