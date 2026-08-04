import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth.js';

// Resolves precise official Traditional-Chinese card / product artwork from the
// official Pokémon TCG Asia site (asia.pokemon-card.com/tw). That site serves no
// CORS header, so the browser cannot scrape its search pages directly — this
// same-origin proxy does the lookup server-side and returns just the image URL.
// The images themselves hotlink freely, so the browser then loads them directly.
//
//   GET /api/tw-card-image?set=M5            → booster/product pack image
//   GET /api/tw-card-image?set=M5&number=16  → the exact card (016/081) image
//
// IMPORTANT — the image for card N is NOT the Nth item in the list. The list has
// DUPLICATE entries per collector number (reprints/variants) and secret/SAR cards
// are numbered beyond the set total (248/193), so a positional `ids[N-1]` returns
// the wrong card's art. The list IS sorted ascending by collector number, and the
// image file id equals the card's detail id (tw000<ID>.png ↔ detail/<ID>), so we
// binary-search for the real collectorNumber (read off the detail page) and build
// the image URL from that id.

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';
const PAGE_SIZE = 20;
const MAX_PAGES = 50; // safety cap (~1000 list items incl. duplicates + secrets)

// Per-lambda in-memory caches (best-effort; survive warm invocations).
const cardIdsCache = new Map<string, number[]>();
const collectorNumCache = new Map<number, number>(); // detail id → collector number
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

// The FULL ordered list of card image ids for an expansion (sorted ascending by
// collector number, with duplicate entries). Fetched once and cached — binary
// search needs the whole list because secret rares live at the very end.
async function getAllCardIds(set: string): Promise<number[]> {
  const key = set.toUpperCase();
  const cached = cardIdsCache.get(key);
  if (cached) return cached;

  const ids: number[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(
      `${BASE}/tw/card-search/list/?pageNo=${page}&expansionCodes=${encodeURIComponent(set)}`,
    );
    if (!html) break;
    const pageIds = [...html.matchAll(/card-img\/tw0*(\d+)\.png/gi)].map(m => Number(m[1]));
    if (pageIds.length === 0) break;
    ids.push(...pageIds);
    if (pageIds.length < PAGE_SIZE) break;
  }
  if (ids.length > 0) cardIdsCache.set(key, ids);
  return ids;
}

// Collector number (int, part before the slash) read off a card's detail page.
// Cached per id, with one retry so a transient miss doesn't abort a binary search.
async function collectorNumberOf(id: number): Promise<number | null> {
  const hit = collectorNumCache.get(id);
  if (hit !== undefined) return hit;
  let html = await fetchText(`${BASE}/tw/card-search/detail/${id}/`);
  if (!html) html = await fetchText(`${BASE}/tw/card-search/detail/${id}/`);
  const cn = html?.match(/collectorNumber["']?>\s*([0-9]+)\/[0-9]+/i)?.[1] ?? '';
  if (!cn) return null;
  const n = Number.parseInt(cn, 10);
  if (Number.isFinite(n)) collectorNumCache.set(id, n);
  return Number.isFinite(n) ? n : null;
}

// Resolve a collector number to its image id by binary-searching the ascending
// list. Returns null (not a wrong id) when the number can't be confirmed.
async function findImageIdByNumber(set: string, target: number): Promise<number | null> {
  const ids = await getAllCardIds(set);
  if (ids.length === 0) return null;

  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const n = await collectorNumberOf(ids[mid]);
    if (n == null) return null; // list not readable → don't guess
    if (n === target) return ids[mid];
    if (n < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
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

// zh-tw MEGA/超級進化 prints a trailing "F" edition marker (M5F, M2aF); the site's
// expansion code drops it (M5, M2A). Try the code as-is first, then F-stripped.
function setCodeCandidates(raw: string): string[] {
  const code = raw.trim().toUpperCase();
  const out = [code];
  if (/F$/.test(code)) out.push(code.replace(/F$/, ''));
  return [...new Set(out)].filter(Boolean);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!(await requireUser(req, res))) return;

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
    const candidates = setCodeCandidates(set);
    // A caller that supplied a collector number wants THAT card. A caller that
    // didn't (boxes, packs, "自動取得系列圖") just wants something representative
    // of the set. The two must not share fallbacks — see below.
    const wantsSpecificCard = Number.isFinite(number) && number > 0;

    // 1) Precise single card, when a collector number is given. Binary-search the
    // ascending list for the real collector number (handles duplicates + secrets).
    if (wantsSpecificCard) {
      for (const code of candidates) {
        const id = await findImageIdByNumber(code, number);
        if (id) {
          return res.status(200).json({ imageUrl: cardImageUrl(id), kind: 'card' });
        }
      }
      // Couldn't confirm that exact card — answer "no image" rather than some
      // OTHER card's art. Substituting here is how a UR オリジンパルキアVSTAR
      // (S12a/259, a secret rare the TW site doesn't list) came back as 派拉斯,
      // S12a's card 001: silently wrong, and the caller saved it as the card's
      // picture. A missing thumbnail is recoverable; a confidently wrong one
      // gets stored and trusted.
      return res.status(200).json({ imageUrl: null, reason: 'card_not_found' });
    }

    // 2) Product / pack image (boxes, packs, or singles with no number).
    const products = await getProductMap();
    for (const code of candidates) {
      const product = products.get(code);
      if (product) {
        return res.status(200).json({ imageUrl: product, kind: 'product' });
      }
    }

    // 3) Fall back to the expansion's first card as a representative image. Only
    // reachable when no specific card was requested, so it can't misrepresent one.
    for (const code of candidates) {
      const ids = await getAllCardIds(code);
      if (ids[0]) {
        return res.status(200).json({ imageUrl: cardImageUrl(ids[0]), kind: 'representative' });
      }
    }

    return res.status(200).json({ imageUrl: null, reason: 'set_not_found' });
  } catch {
    return res.status(200).json({ imageUrl: null });
  }
}
