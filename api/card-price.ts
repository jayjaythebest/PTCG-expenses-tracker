import type { VercelRequest, VercelResponse } from '@vercel/node';

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
// back to manual entry.

const HUCA_API = 'https://huca.tw/api/api.php';
const KP_API = 'https://trade.kapaipai.tw/api';
const TCGDEX_ZH_SETS = 'https://api.tcgdex.net/v2/zh-tw/sets';
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

// kapaipai shapes (only the fields we use).
interface KpPack {
  packId: string;
  packName: string;
}
interface KpCardRow {
  packId: string;
  packCardId: string;
  cardGlobalKey: string;
  cardName: string;
  rare?: string[];
  lowestPrice?: number;
  averagePrice?: number;
}
interface TcgdexSet {
  id: string;
  name: string;
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
// prices move on a daily cadence and this keeps us gentle on the sources.
const TTL_MS = 12 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; result: PriceResult }>();

// kapaipai catalog caches (shared across all zh-tw lookups within a warm lambda).
let kpPackListCache: { at: number; nameToId: Map<string, string>; idToId: Map<string, string> } | null = null;
let tdZhSetsCache: { at: number; nameToId: Map<string, string> } | null = null;
const kpPackDetailCache = new Map<string, { at: number; rows: KpCardRow[] }>();

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

// -------- Huca (Japanese cards) --------------------------------------------

function pickHucaPrice(row: HucaRow): number | null {
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
    const price = pickHucaPrice(row);
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

// -------- kapaipai (Traditional-Chinese cards) -----------------------------

// Normalise a card-number token so "012", "12" and " 12 " all compare equal.
// Falls back to an upper-cased trim for non-numeric ids (promos like "000P").
function normNum(s: string): string {
  const t = (s ?? '').trim();
  const digits = t.match(/^0*(\d+)/)?.[1];
  return digits ?? t.toUpperCase();
}

function pickKpPrice(row: KpCardRow): number | null {
  if (Number.isFinite(row.averagePrice) && (row.averagePrice as number) > 0) {
    return Math.round(row.averagePrice as number);
  }
  if (Number.isFinite(row.lowestPrice) && (row.lowestPrice as number) > 0) {
    return Math.round(row.lowestPrice as number);
  }
  return null;
}

// kapaipai's full pack list for the zh-tw game. Lets us map a TCGdex set name
// (what the collection stores) to kapaipai's packId, which keys the per-pack
// price endpoint. Cached per warm lambda.
async function getKpPackList() {
  if (kpPackListCache && Date.now() - kpPackListCache.at < TTL_MS) return kpPackListCache;
  const json = await fetchJson<{ data?: { list?: KpPack[] } | KpPack[] }>(`${KP_API}/card/getCardPackList?game=pkmtw`);
  const list = (Array.isArray(json?.data) ? json?.data : json?.data?.list) ?? [];
  if (list.length === 0) return kpPackListCache; // keep any stale cache on failure
  const nameToId = new Map<string, string>();
  const idToId = new Map<string, string>();
  for (const p of list) {
    if (!p?.packId) continue;
    idToId.set(p.packId.toUpperCase(), p.packId);
    if (p.packName) nameToId.set(p.packName.trim(), p.packId);
  }
  kpPackListCache = { at: Date.now(), nameToId, idToId };
  return kpPackListCache;
}

// TCGdex zh-tw set list, used as a bridge: some sets match kapaipai only by
// name and some only by code, so we resolve set name -> TCGdex id -> kapaipai
// packId when a direct name match misses. Cached per warm lambda.
async function getTdZhSets() {
  if (tdZhSetsCache && Date.now() - tdZhSetsCache.at < TTL_MS) return tdZhSetsCache;
  const list = await fetchJson<TcgdexSet[]>(TCGDEX_ZH_SETS);
  if (!list || list.length === 0) return tdZhSetsCache;
  const nameToId = new Map<string, string>();
  for (const s of list) if (s?.name && s?.id) nameToId.set(s.name.trim(), s.id);
  tdZhSetsCache = { at: Date.now(), nameToId };
  return tdZhSetsCache;
}

// Resolve a collection item's set (code and/or zh-tw name) to a kapaipai packId.
async function resolvePackId(setCode: string, setName: string): Promise<string | null> {
  const pl = await getKpPackList();
  if (!pl) return null;
  if (setCode) {
    const byCode = pl.idToId.get(setCode.toUpperCase());
    if (byCode) return byCode;
  }
  if (setName) {
    const byName = pl.nameToId.get(setName.trim());
    if (byName) return byName;
    // Bridge through TCGdex: set name -> TCGdex id -> kapaipai packId.
    const td = await getTdZhSets();
    const id = td?.nameToId.get(setName.trim());
    if (id) {
      const byBridged = pl.idToId.get(id.toUpperCase());
      if (byBridged) return byBridged;
    }
  }
  return null;
}

// All cards (with prices) in one kapaipai pack. Cached per pack per warm lambda.
async function getKpPackDetail(packId: string): Promise<KpCardRow[]> {
  const hit = kpPackDetailCache.get(packId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.rows;
  const json = await fetchJson<{ data?: { list?: KpCardRow[] } }>(
    `${KP_API}/card/getCardPackDetailList?packId=${encodeURIComponent(packId)}&game=pkmtw`,
  );
  const rows = json?.data?.list ?? [];
  if (rows.length > 0) kpPackDetailCache.set(packId, { at: Date.now(), rows });
  return rows;
}

// The local (in-pack) collector number of a kapaipai row. The
// getCardPackDetailList endpoint is inconsistent: packCardId is sometimes
// prefixed ("SV9a-012") and sometimes bare ("131"), and cardGlobalKey is
// sometimes a stable `${packId}-${number}` and sometimes a descriptive junk
// string. We prefer packCardId (stripping an optional `${packId}-` prefix) and
// fall back to cardGlobalKey only when it carries the prefix.
function rowLocalNumber(row: KpCardRow, packId: string): string {
  const prefix = `${packId}-`;
  const pc = row.packCardId ?? '';
  if (pc.startsWith(prefix)) return pc.slice(prefix.length);
  const gk = row.cardGlobalKey ?? '';
  if (gk.startsWith(prefix)) return gk.slice(prefix.length);
  return pc;
}

async function lookupKapaipai(setCode: string, setName: string, num: string, name: string): Promise<PriceResult | null> {
  const packId = await resolvePackId(setCode, setName);
  if (!packId) return null;
  const rows = await getKpPackDetail(packId);
  if (rows.length === 0) return null;

  const target = normNum(num);
  const matches = rows.filter(r => normNum(rowLocalNumber(r, packId)) === target);
  if (matches.length === 0) return null;
  // Canonical kapaipai global key is `${packId}-${localNumber}` (padded form).
  const localNumber = rowLocalNumber(matches[0], packId);

  // Usually one match per number. When a number has several variants (sealed
  // 原盒/散包 etc.), prefer an exact name match, then the first with a real price.
  const ordered = [...matches].sort((a, b) => {
    const an = name && a.cardName === name ? 0 : 1;
    const bn = name && b.cardName === name ? 0 : 1;
    return an - bn;
  });

  for (const row of ordered) {
    const price = pickKpPrice(row);
    if (price == null) continue;
    return {
      price,
      currency: 'TWD',
      source: 'kapaipai',
      condition: null,
      url: `https://trade.kapaipai.tw/card/${packId}-${localNumber}`,
      updatedAt: new Date().toISOString(),
    };
  }
  return null;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const src = req.method === 'POST' ? (req.body ?? {}) : req.query;
  const setCode = String(src.setCode ?? '').trim();
  const setName = String(src.setName ?? '').trim();
  const number = String(src.number ?? '').trim();
  const name = String(src.name ?? '').trim();
  const edition = String(src.edition ?? 'ja').trim();

  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'public, max-age=3600, s-maxage=43200');

  const now = () => new Date().toISOString();

  if (edition === 'zh-tw') {
    if (!setCode && !setName && !number) {
      return res.status(400).json({ ...EMPTY, source: 'kapaipai', updatedAt: now(), error: 'missing set/number' });
    }
    const key = `zh-tw:${setName || setCode.toUpperCase()}:${number}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL_MS) return res.status(200).json(hit.result);
    try {
      const result = await lookupKapaipai(setCode, setName, number, name);
      if (result) {
        cache.set(key, { at: Date.now(), result });
        return res.status(200).json(result);
      }
      return res.status(200).json({ ...EMPTY, source: 'kapaipai', updatedAt: now() });
    } catch {
      return res.status(200).json({ ...EMPTY, source: 'kapaipai', updatedAt: now() });
    }
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
