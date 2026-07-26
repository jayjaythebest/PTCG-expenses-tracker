import type { VercelRequest, VercelResponse } from '@vercel/node';

// Resolves full Traditional-Chinese CARD DATA (name + collector number + precise
// artwork) from the official Pokémon TCG Asia site (asia.pokemon-card.com/tw).
// This is the companion to /api/tw-card-image (which returns only an image): it
// also reads the card's Chinese name off the detail page, so brand-new zh-tw
// sets that TCGdex hasn't catalogued yet (e.g. the MEGA "M#" series, SV11…) can
// still auto-fill on scan. The official site is effectively the complete,
// always-current zh-tw card table — we query it live and cache hard at the edge.
//
//   GET /api/tw-card?set=M5&number=114
//     → { name: "超級達克萊伊ex", localId: "114", collectorNumber: "114/081",
//         imageUrl: "https://asia.pokemon-card.com/tw/card-img/tw00019279.png",
//         setCode: "M5" }
//
// The site has NO rarity letter on the page, so rarity is intentionally omitted
// (the caller keeps the rarity read off the card by the AI scan). The expansion
// list is returned in collector-number order (verified: M5 index 0 = 001/081,
// index 113 = 114/081), so card N is the Nth detail id in that list.

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';
const PAGE_SIZE = 20;
const MAX_PAGES = 40; // safety cap (~800 cards)
const NAME_SUFFIX = ' | 訓練家網站';

// Per-lambda in-memory caches (best-effort; survive warm invocations).
const detailIdsCache = new Map<string, number[]>();
const cardDataCache = new Map<string, TwCardData | null>();

interface TwCardData {
  name: string;
  localId: string;
  collectorNumber: string;
  imageUrl: string;
  setCode: string;
}

async function fetchText(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// Ordered list of card DETAIL ids for an expansion (index 0 == card 001). Pages
// are fetched only until we have at least `need` cards, then cached.
async function getDetailIds(set: string, need: number): Promise<number[]> {
  const key = set.toUpperCase();
  const cached = detailIdsCache.get(key);
  if (cached && cached.length >= need) return cached;

  const ids: number[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(
      `${BASE}/tw/card-search/list/?pageNo=${page}&expansionCodes=${encodeURIComponent(set)}`,
    );
    if (!html) break;
    const pageIds = [...html.matchAll(/card-search\/detail\/(\d+)\//gi)].map(m => Number(m[1]));
    if (pageIds.length === 0) break;
    ids.push(...pageIds);
    if (ids.length >= need || pageIds.length < PAGE_SIZE) break;
  }
  if (!cached || ids.length >= cached.length) detailIdsCache.set(key, ids);
  return detailIdsCache.get(key) ?? ids;
}

// Read name + collector number + image off a single card's detail page.
async function fetchDetail(id: number, setCode: string): Promise<TwCardData | null> {
  const html = await fetchText(`${BASE}/tw/card-search/detail/${id}/`);
  if (!html) return null;

  const rawTitle = (html.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ?? '').trim();
  const name = rawTitle.endsWith(NAME_SUFFIX)
    ? rawTitle.slice(0, -NAME_SUFFIX.length).trim()
    : rawTitle.replace(/\s*\|\s*訓練家網站\s*$/, '').trim();
  const collectorNumber = (html.match(/collectorNumber["']?>\s*([0-9]+\/[0-9]+)/i)?.[1] ?? '').trim();
  const imgFile = html.match(/card-img\/(tw\d+\.png)/i)?.[1] ?? '';
  const imageUrl = imgFile ? `${BASE}/tw/card-img/${imgFile}` : '';
  const localId = collectorNumber ? collectorNumber.split('/')[0].replace(/^0+(?=\d)/, '') : '';

  if (!name) return null;
  return { name, localId, collectorNumber, imageUrl, setCode };
}

// The AI reads the code PRINTED on the card ("M5F"), but the site's expansion
// code drops the trailing edition letter ("M5"). Try the code as-is first, then
// the F-stripped MEGA form.
function setCodeCandidates(raw: string): string[] {
  const code = raw.trim().toUpperCase();
  const out = [code];
  if (/^M\d+[A-Z]$/.test(code)) out.push(code.slice(0, -1));
  return [...new Set(out)];
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const setRaw = String(req.query.set ?? '').trim();
  const numberRaw = String(req.query.number ?? '').trim();
  const number = numberRaw ? Number(numberRaw.match(/\d+/)?.[0]) : NaN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Resolved card data is stable — cache hard at the edge and in the browser.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');

  if (!setRaw || !Number.isFinite(number) || number <= 0) {
    return res.status(400).json({ card: null, error: 'missing set or number' });
  }

  try {
    for (const set of setCodeCandidates(setRaw)) {
      const cacheKey = `${set}#${number}`;
      const cached = cardDataCache.get(cacheKey);
      if (cached !== undefined) {
        if (cached) return res.status(200).json({ card: cached });
        continue;
      }
      const ids = await getDetailIds(set, number);
      const id = ids[number - 1];
      if (!id) {
        cardDataCache.set(cacheKey, null);
        continue;
      }
      const card = await fetchDetail(id, set);
      cardDataCache.set(cacheKey, card);
      if (card) return res.status(200).json({ card });
    }
    return res.status(200).json({ card: null });
  } catch {
    return res.status(200).json({ card: null });
  }
}
