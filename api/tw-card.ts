import type { VercelRequest, VercelResponse } from '@vercel/node';
import { requireUser } from './_lib/auth.js';
import { fetchWithTimeout } from '../src/lib/fetchTimeout.js';

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
// An optional &name=<zh-tw name> enables a fallback: when the (OCR-read) set code
// can't resolve the number, we keyword-search by name and match the collector
// number — rescuing secret rares whose printed code the AI misread.
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
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
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

// Loose name comparison so a number-only match can be sanity-checked against the
// scanned card name. Whitespace-insensitive, case-insensitive. Returns true when
// we have no name to check (don't block), on exact/substring match, or when the
// names share a ≥2-char leading run (same Pokémon, minor OCR/format drift). A
// clear mismatch (e.g. scanned "N的索羅亞克ex" vs resolved "旋轉洛托姆") returns
// false, so the resolver rejects a same-number-different-card collision and falls
// back to the distinctive name search instead of showing a confidently wrong card.
export function nameMatches(want: string, got: string): boolean {
  const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase();
  const x = norm(want);
  const y = norm(got);
  if (!x || !y) return true; // nothing to check against → don't block
  if (x === y || x.includes(y) || y.includes(x)) return true;
  let i = 0;
  while (i < x.length && i < y.length && x[i] === y[i]) i++;
  return i >= 2;
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
  wantName = '',
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
    if (n === target) {
      // Guard against a same-number-different-card collision: if the scanned name
      // clearly doesn't match this card, reject so the caller falls back to the
      // name search (which pins the real card across all expansions).
      return d && nameMatches(wantName, d.name) ? d : null;
    }
    if (n < target) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

// Fallback resolver: match by the scanned Chinese NAME + collector number when
// the (possibly OCR-misread) set code doesn't resolve. The AI reads the printed
// set code off the card, and for high-numbered secret rares it can slip (e.g.
// 厄鬼椪 水井面具ex 208/187 SAR is printed such that the AI read "sv6a" but the
// site files it under SV8a). The Chinese name is distinctive, so a keyword
// search pins the card, and the collector number disambiguates its prints/SAR.
// Keyword variants to try, most-likely-to-work first. The TW site's keyword
// search is unreliable with multi-token (space-separated) queries — a scanned
// name like "厄鬼椪 水井面具ex" often returns nothing, while the distinctive
// trailing token "水井面具ex" reliably returns the card's prints. So we try the
// full name, then spaces-removed, then each token longest-first (the specific
// form/ex name is usually the longest and least ambiguous).
function keywordCandidates(name: string): string[] {
  const clean = name.trim();
  const out: string[] = [];
  const push = (s: string) => {
    const t = s.trim();
    if (t && !out.includes(t)) out.push(t);
  };
  push(clean);
  push(clean.replace(/\s+/g, ''));
  clean
    .split(/\s+/)
    .filter(Boolean)
    .sort((a, b) => b.length - a.length)
    .forEach(push);
  return out;
}

async function findByName(name: string, target: number): Promise<TwCardData | null> {
  if (!name.trim()) return null;

  // Probe each keyword variant until one yields the card. Track probed ids and
  // cap total detail reads so a generic token can't blow past maxDuration.
  const seen = new Set<number>();
  let probes = 0;
  for (const kw of keywordCandidates(name)) {
    const ids: number[] = [];
    for (let page = 1; page <= 3; page++) {
      const html = await fetchText(
        `${BASE}/tw/card-search/list/?pageNo=${page}&keyword=${encodeURIComponent(kw)}`,
      );
      if (!html) break;
      const pageIds = [...html.matchAll(/card-search\/detail\/(\d+)\//gi)].map(m => Number(m[1]));
      if (pageIds.length === 0) break;
      ids.push(...pageIds);
      if (pageIds.length < PAGE_SIZE) break;
    }
    for (const id of ids) {
      if (seen.has(id)) continue;
      seen.add(id);
      if (probes++ >= 40) return null;
      const d = await detailById(id, ''); // empty → detail page's own expansion code
      if (d && collectorNum(d.collectorNumber) === target) return d;
    }
  }
  return null;
}

// Read name + collector number + image off a single card's detail page. When
// `setCode` is passed empty (the name-search fallback doesn't know it up front),
// read the card's real expansion code straight off the detail page.
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
  const resolvedCode =
    setCode || (html.match(/expansionCodes=([A-Za-z0-9]+)/i)?.[1] ?? '').toUpperCase();

  if (!name) return null;
  return { name, localId, collectorNumber, imageUrl, setCode: resolvedCode };
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
  if (!(await requireUser(req, res))) return;

  const setRaw = String(req.query.set ?? '').trim();
  const numberRaw = String(req.query.number ?? '').trim();
  const nameRaw = String(req.query.name ?? '').trim();
  const number = numberRaw ? Number(numberRaw.match(/\d+/)?.[0]) : NaN;

  res.setHeader('Access-Control-Allow-Origin', '*');
  // Resolved card data is stable — cache hard at the edge and in the browser.
  res.setHeader('Cache-Control', 'public, max-age=86400, s-maxage=604800');

  if (!setRaw || !Number.isFinite(number) || number <= 0) {
    return res.status(400).json({ card: null, error: 'missing set or number' });
  }

  try {
    // 1) Trust the scanned set code first (fast, exact).
    for (const set of setCodeCandidates(setRaw)) {
      const cacheKey = `${set}#${number}`;
      const cached = cardDataCache.get(cacheKey);
      if (cached !== undefined) {
        if (cached) return res.status(200).json({ card: cached });
        continue;
      }
      const card = await findByCollectorNumber(set, set, number, nameRaw);
      // Cache ONLY positive hits: a null here may be a name-mismatch rejection
      // that the name-search below (or a future, better scan) can still resolve,
      // so don't poison the key with a permanent miss.
      if (card) {
        cardDataCache.set(cacheKey, card);
        return res.status(200).json({ card });
      }
    }

    // 2) Set code didn't resolve (often an OCR-misread code on secret rares) —
    //    fall back to the distinctive scanned name + collector number. Cache ONLY
    //    positive hits: the keyword search hits the flaky TW site, so a transient
    //    empty response must NOT be cached as a permanent null (that poisons the
    //    lookup for the warm lambda's lifetime). A miss simply retries next time.
    if (nameRaw) {
      const cacheKey = `name:${nameRaw}#${number}`;
      const cached = cardDataCache.get(cacheKey);
      if (cached) return res.status(200).json({ card: cached });
      const card = await findByName(nameRaw, number);
      if (card) {
        cardDataCache.set(cacheKey, card);
        return res.status(200).json({ card });
      }
    }

    return res.status(200).json({ card: null });
  } catch {
    return res.status(200).json({ card: null });
  }
}
