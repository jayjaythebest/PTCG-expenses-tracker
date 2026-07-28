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
// (the caller keeps the rarity read off the card by the AI scan).
//
// IMPORTANT — do NOT map "card N == the Nth item in the list". The expansion list
// contains DUPLICATE entries (multiple prints/reprints per collector number: e.g.
// M2a returns 486 list items for a set numbered up to 250, with 001/193 appearing
// three times) AND secret/SAR cards are numbered far beyond the set total
// (248/193). So the positional guess `ids[N-1]` silently returns the wrong card
// (248 → 094/193 超級摔角鷹人ex). The list IS globally sorted ascending by
// collector number though, so we resolve by BINARY-SEARCHING for the real
// collectorNumber read off each candidate's detail page.

const BASE = 'https://asia.pokemon-card.com';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';
const PAGE_SIZE = 20;
const MAX_PAGES = 50; // safety cap (~1000 list items incl. duplicates + secrets)
const NAME_SUFFIX = ' | 訓練家網站';

// Per-lambda in-memory caches (best-effort; survive warm invocations).
const detailIdsCache = new Map<string, number[]>();
const detailByIdCache = new Map<number, TwCardData | null>();
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

// The FULL ordered list of card DETAIL ids for an expansion (sorted ascending by
// collector number, with duplicate entries per number). Fetched once and cached
// — binary search needs the whole list because secret rares live at the very end.
async function getAllDetailIds(set: string): Promise<number[]> {
  const key = set.toUpperCase();
  const cached = detailIdsCache.get(key);
  if (cached) return cached;

  const ids: number[] = [];
  for (let page = 1; page <= MAX_PAGES; page++) {
    const html = await fetchText(
      `${BASE}/tw/card-search/list/?pageNo=${page}&expansionCodes=${encodeURIComponent(set)}`,
    );
    if (!html) break;
    const pageIds = [...html.matchAll(/card-search\/detail\/(\d+)\//gi)].map(m => Number(m[1]));
    if (pageIds.length === 0) break;
    ids.push(...pageIds);
    if (pageIds.length < PAGE_SIZE) break;
  }
  if (ids.length > 0) detailIdsCache.set(key, ids);
  return ids;
}

// Numeric collector number (the part before the slash) for sorting/matching.
function collectorNum(cn: string): number {
  return Number.parseInt((cn.split('/')[0] ?? '').replace(/\D/g, ''), 10);
}

// Detail data for one id, cached, with a single retry (the detail read is the
// per-probe cost of the binary search, so a transient miss shouldn't abort it).
async function detailById(id: number, setCode: string): Promise<TwCardData | null> {
  if (detailByIdCache.has(id)) return detailByIdCache.get(id) ?? null;
  let d = await fetchDetail(id, setCode);
  if (!d) d = await fetchDetail(id, setCode); // one retry
  detailByIdCache.set(id, d);
  return d;
}

// Resolve a collector number to its card by binary-searching the ascending list.
// Returns null (rather than a wrong card) when the number can't be confirmed —
// a blank auto-fill is always better than confidently wrong data.
async function findByCollectorNumber(
  set: string,
  setCode: string,
  target: number,
): Promise<TwCardData | null> {
  const ids = await getAllDetailIds(set);
  if (ids.length === 0) return null;

  let lo = 0;
  let hi = ids.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = await detailById(ids[mid], setCode);
    const n = d ? collectorNum(d.collectorNumber) : NaN;
    if (!Number.isFinite(n)) return null; // list not readable → don't guess
    if (n === target) return d;
    if (n < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
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

// The AI reads the code PRINTED on the card (zh-tw MEGA/超級進化 prints a trailing
// "F" edition marker: "M5F", "M2aF"), but the site's expansion code drops it
// ("M5", "M2A"). Try the code as-is first, then the F-stripped form.
function setCodeCandidates(raw: string): string[] {
  const code = raw.trim().toUpperCase();
  const out = [code];
  if (/F$/.test(code)) out.push(code.replace(/F$/, ''));
  return [...new Set(out)].filter(Boolean);
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
      const card = await findByCollectorNumber(set, set, number);
      cardDataCache.set(cacheKey, card);
      if (card) return res.status(200).json({ card });
    }
    return res.status(200).json({ card: null });
  } catch {
    return res.status(200).json({ card: null });
  }
}
