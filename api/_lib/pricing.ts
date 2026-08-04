// Shared card-price resolver used by BOTH the on-demand endpoint
// (/api/card-price) and the daily cron (/api/snapshot-collection), so prices
// refresh automatically every day — not only when the user taps 「更新價格」.
//
// Japanese cards -> Huca (huca.tw, JPY, backed by Snkrdunk transactions).
// Traditional-Chinese (zh-tw) cards -> kapaipai (trade.kapaipai.tw, TWD).
// Returns null when no match is found so callers can fall back to manual entry.

const HUCA_API = 'https://huca.tw/api/api.php';
const KP_API = 'https://trade.kapaipai.tw/api';
const TCGDEX_ZH_SETS = 'https://api.tcgdex.net/v2/zh-tw/sets';
const TCGDEX_JA_SETS = 'https://api.tcgdex.net/v2/ja/sets';
const SNKRDUNK_API = 'https://snkrdunk.com/v1/apparels';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';

interface HucaRow {
  id: number;
  title?: string;
  product_link?: string;
  latest_price?: number;
  latest_condition?: string;
  average_price?: string | number;
  sort_price?: number;
  // Huca's representative row carries the Snkrdunk product id, letting us fetch
  // the true raw/used floor (usedMinPrice) directly — Huca's own sort_price is
  // frequently a PSA10/graded representative price for chase cards.
  snkrdunk_id?: string | number;
}

// Snkrdunk apparel detail shape (only the fields we use). Public JSON, no auth.
interface SnkrdunkApparel {
  usedMinPrice?: number;        // second-hand (raw) floor
  minPrice?: number;            // lowest listing (may be sealed/new)
  minPriceOfNewListing?: number; // new/unopened floor
  usedListingCount?: number;
}

// kapaipai shapes (only the fields we use).
interface KpPack {
  packId: string;
  packName: string;
}
export interface KpCardRow {
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

export interface PriceResult {
  price: number | null;
  currency: string | null;
  source: string | null;
  condition: string | null;
  url: string | null;
  updatedAt: string; // ISO of when this price was fetched
}

export const EMPTY_PRICE: Omit<PriceResult, 'updatedAt'> = {
  price: null,
  currency: null,
  source: null,
  condition: null,
  url: null,
};

// Source catalog caches (shared across lookups within a warm lambda).
const TTL_MS = 12 * 60 * 60 * 1000;
let jaSetNameToCodeCache: { at: number; map: Map<string, string[]> } | null = null;
let kpPackListCache: { at: number; nameToId: Map<string, string>; idToId: Map<string, string> } | null = null;
let tdZhSetsCache: { at: number; nameToId: Map<string, string> } | null = null;
const kpPackDetailCache = new Map<string, { at: number; rows: KpCardRow[] }>();

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

// -------- Snkrdunk (raw/used floor for single cards; box pricing) -----------

// Fetch a Snkrdunk apparel's second-hand (raw) floor price. Huca gives us the
// snkrdunk_id on its representative row, so we can go straight to the source and
// read `usedMinPrice` — the true ungraded floor — instead of Huca's sort_price,
// which is frequently a PSA10/graded representative price for chase cards.
// Returns null when there is no usable used listing (usedMinPrice 0/absent).
export async function lookupSnkrdunkUsed(
  snkrdunkId: string | number,
): Promise<{ price: number; count: number } | null> {
  const id = String(snkrdunkId ?? '').trim();
  if (!id) return null;
  const data = await fetchJson<SnkrdunkApparel>(`${SNKRDUNK_API}/${encodeURIComponent(id)}`);
  if (!data) return null;
  const used = Number(data.usedMinPrice);
  if (Number.isFinite(used) && used > 0) {
    return { price: Math.round(used), count: Number(data.usedListingCount) || 0 };
  }
  return null;
}

// Pick a sealed-box price from a Snkrdunk apparel payload. Prefer the
// second-hand floor (usedMinPrice), then the lowest listing (minPrice), then
// the new-listing floor (minPriceOfNewListing). Pure so it can be unit-tested
// without a network call. Returns null when nothing usable is present.
export function pickSnkrdunkBoxPrice(
  data: SnkrdunkApparel,
): { price: number; condition: string } | null {
  const used = Number(data.usedMinPrice);
  if (Number.isFinite(used) && used > 0) return { price: Math.round(used), condition: '二手' };
  const min = Number(data.minPrice);
  if (Number.isFinite(min) && min > 0) return { price: Math.round(min), condition: '最低' };
  const newMin = Number(data.minPriceOfNewListing);
  if (Number.isFinite(newMin) && newMin > 0) return { price: Math.round(newMin), condition: '全新' };
  return null;
}

// Fetch a Snkrdunk apparel's price for a sealed box product. Boxes are looked
// up by a manually-curated Snkrdunk product id (see ptcg-boxes).
export async function lookupSnkrdunkBox(snkrdunkId: string | number): Promise<PriceResult | null> {
  const id = String(snkrdunkId ?? '').trim();
  if (!id) return null;
  const data = await fetchJson<SnkrdunkApparel>(`${SNKRDUNK_API}/${encodeURIComponent(id)}`);
  if (!data) return null;
  const picked = pickSnkrdunkBoxPrice(data);
  if (!picked) return null;
  return {
    price: picked.price,
    currency: 'JPY',
    source: 'snkrdunk',
    condition: picked.condition,
    url: `https://snkrdunk.com/apparels/${encodeURIComponent(id)}`,
    updatedAt: new Date().toISOString(),
  };
}

// Extract the collector number from a possibly-messy stored value. The number
// is the part before a slash ("117/081" -> "117"); we also ignore set-code-ish
// prefixes ("J m5 117" -> "117") by taking the LAST run of digits in that part.
export function extractNumber(num: string): string {
  const head = (num ?? '').split('/')[0];
  const groups = head.match(/\d+/g);
  if (groups && groups.length) return groups[groups.length - 1];
  return (num ?? '').trim();
}

// -------- Huca (Japanese cards) --------------------------------------------

// TCGdex ja set NAME -> set code(s). Huca uses the SAME set codes TCGdex does
// (SV2D, M4, SV8a…). A collection item stores its set *name* (resolved from
// TCGdex on scan), and that name frequently either isn't in the client's small
// local product map — so the client sends an empty setCode — or maps to a
// stale/wrong local code (e.g. クレイバースト is SV2D on Huca/TCGdex but sv1b
// locally, 黒炎の支配者 is SV3 but sv2 locally). Resolving the code straight from
// TCGdex by name is authoritative and fixes both, which is the main cause of
// "many cards show no price". Cached per warm lambda.
async function getJaSetNameToCode(): Promise<Map<string, string[]>> {
  if (jaSetNameToCodeCache && Date.now() - jaSetNameToCodeCache.at < TTL_MS) {
    return jaSetNameToCodeCache.map;
  }
  const list = await fetchJson<Array<{ id?: unknown; name?: unknown }>>(TCGDEX_JA_SETS);
  const map = new Map<string, string[]>();
  for (const s of list ?? []) {
    const name = String(s?.name ?? '').trim();
    const id = String(s?.id ?? '').trim();
    if (!name || !id) continue;
    const arr = map.get(name);
    if (arr) arr.push(id);
    else map.set(name, [id]);
  }
  if (map.size > 0) jaSetNameToCodeCache = { at: Date.now(), map };
  return jaSetNameToCodeCache?.map ?? map;
}

// Authoritative Huca set code for a stored set name. Returns null when the name
// is unknown OR ambiguous (a handful of TCGdex sets share a name) so the caller
// falls back to the client-supplied code rather than guessing the wrong set.
async function resolveHucaSetCode(setName: string): Promise<string | null> {
  const name = (setName ?? '').trim();
  if (!name) return null;
  const map = await getJaSetNameToCode();
  const ids = map.get(name);
  return ids && ids.length === 1 ? ids[0] : null;
}

// Pick a usable price from a Huca row. Prefer the average, then the latest
// transaction, then `sort_price` — which is frequently the ONLY populated field
// on set+number lookups (average/latest come back null for many cards), so
// ignoring it used to make clearly-listed cards look price-less.
export function pickHucaPrice(row: HucaRow): number | null {
  const avg = row.average_price != null ? Number(row.average_price) : NaN;
  if (Number.isFinite(avg) && avg > 0) return Math.round(avg);
  if (Number.isFinite(row.latest_price) && (row.latest_price as number) > 0) {
    return Math.round(row.latest_price as number);
  }
  if (Number.isFinite(row.sort_price) && (row.sort_price as number) > 0) {
    return Math.round(row.sort_price as number);
  }
  return null;
}

// Rarity/edition tokens Huca appends after the card name in a listing title.
const HUCA_TITLE_TOKENS = new Set([
  'UR', 'MUR', 'SAR', 'AR', 'SR', 'HR', 'CSR', 'SER', 'CHR', 'RR', 'RRR', 'R', 'U', 'C',
  'ACE', 'SPEC', 'P', 'PROMO', 'K', 'S',
]);

// The card name out of a Huca listing title. Titles are shaped
// 「イーブイex SAR [SV8a 223/187](ハイクラスパック「テラスタルフェスex」)」 — name,
// then optional rarity tokens, then a bracketed set/number and set label.
export function hucaTitleCardName(title: string): string {
  const head = (title ?? '').split('[')[0].trim();
  const parts = head.split(/\s+/).filter(Boolean);
  while (parts.length > 1 && HUCA_TITLE_TOKENS.has(parts[parts.length - 1].toUpperCase())) parts.pop();
  return parts.join(' ');
}

// Does a Huca listing title name THIS card? Used to guard the name-keyword
// fallback, which is the only lookup path with no set code to pin it down.
//
// A substring test is not enough and actively harmful: searching 「イーブイ」
// returns 「イーブイex SAR [SV8a 223/187]」, whose title contains 「イーブイ」, so a
// plain SV-P promo worth a few hundred yen would be priced off a ~13,000 JPY
// SAR. Require the title's name portion to match exactly instead — an honest
// "no price" beats a confidently wrong one.
export function hucaTitleMatchesName(title: string, name: string): boolean {
  const want = nameKey(name);
  if (!want) return false;
  return nameKey(hucaTitleCardName(title)) === want;
}

// Classify a Huca `latest_condition` string as raw (ungraded) or graded, and
// normalise it to a stable label. Raw grades are single letters A/B/C/D. Graded
// slabs look like "PSA10", "PSA 10", "BGS 9.5", "CGC-9" etc. — we normalise to a
// compact `${COMPANY}${GRADE}` form ("PSA10", "BGS9.5") so it can be compared to
// a wanted grade built from the collection item's grading fields.
export function classifyCondition(raw: string | null | undefined): { graded: boolean; label: string | null } {
  const t = (raw ?? '').trim();
  if (!t) return { graded: false, label: null };
  const m = t.match(/^(PSA|BGS|CGC|ARS)\s*-?\s*(10|\d(?:\.5)?)/i);
  if (m) {
    return { graded: true, label: `${m[1].toUpperCase()}${m[2]}` };
  }
  const upper = t.toUpperCase();
  if (/^[ABCD]$/.test(upper)) return { graded: false, label: upper };
  return { graded: false, label: upper };
}

// Build the wanted graded label ("PSA10", "BGS9.5") from a collection item's
// grading fields, or null when the card is not graded. Shared by the on-demand
// endpoint and the daily cron so both match the same slab price.
export function buildWantGrade(
  isGraded?: boolean | null,
  company?: string | null,
  grade?: string | null,
): string | null {
  if (!isGraded || !company || !grade) return null;
  return `${String(company).toUpperCase()}${String(grade).trim()}`;
}

// Turn a chosen Huca row into a PriceResult, tagging it with the normalised
// condition label so callers can honestly show "PSA10 參考" vs a raw grade.
function hucaResult(row: HucaRow, price: number): PriceResult {
  return {
    price,
    currency: 'JPY',
    source: 'huca',
    condition: classifyCondition(row.latest_condition).label,
    url: row.product_link ?? `https://huca.tw/cards/${row.id}`,
    updatedAt: new Date().toISOString(),
  };
}

// Pick the best-matching priced row from a Huca set+number result.
//  - Graded card (wantGrade set): prefer an exact grade match, then any graded
//    row, then any priced row.
//  - Raw card (wantGrade null): prefer an ungraded row; if only graded
//    representative rows exist, still return one but keep its graded label so we
//    never masquerade a slab price as a raw price.
function pickHucaRow(rows: HucaRow[], wantGrade: string | null): PriceResult | null {
  const priced = rows
    .map(row => ({ row, price: pickHucaPrice(row), cls: classifyCondition(row.latest_condition) }))
    .filter((r): r is { row: HucaRow; price: number; cls: { graded: boolean; label: string | null } } => r.price != null);
  if (priced.length === 0) return null;

  if (wantGrade) {
    const exact = priced.find(r => r.cls.label === wantGrade);
    if (exact) return hucaResult(exact.row, exact.price);
    const anyGraded = priced.find(r => r.cls.graded);
    if (anyGraded) return hucaResult(anyGraded.row, anyGraded.price);
    return hucaResult(priced[0].row, priced[0].price);
  }

  const raw = priced.find(r => !r.cls.graded);
  if (raw) return hucaResult(raw.row, raw.price);
  // Only graded representatives available: return one, labelled as graded.
  return hucaResult(priced[0].row, priced[0].price);
}

// Resolve a RAW (ungraded) price from a Huca set+number result. Huca's
// representative row is frequently a PSA10/graded price for chase cards, so a
// naive read masquerades a slab price as a raw price (this is exactly the MUR
// 甲賀忍蛙 bug). Instead, prefer a genuine used AVERAGE, then Snkrdunk's used
// floor (the true raw price), and only then fall back to Huca's representative.
async function pickHucaRawResult(rows: HucaRow[]): Promise<PriceResult | null> {
  if (rows.length === 0) return null;

  // 1) Genuine used average from Huca — ONLY from an ungraded row. Huca's
  //    average_price on a graded (e.g. PSA10) row is a slab average, not a raw
  //    price, so we must NOT fall back to it here (that's the MUR 甲賀忍蛙 bug:
  //    its only Huca row is PSA10). Graded-only cards fall through to the
  //    Snkrdunk used floor below, which is the true raw price.
  const avgCandidates = rows
    .map(row => ({
      row,
      avg: row.average_price != null ? Number(row.average_price) : NaN,
      cls: classifyCondition(row.latest_condition),
    }))
    .filter(r => Number.isFinite(r.avg) && r.avg > 0);
  const avgRow = avgCandidates.find(r => !r.cls.graded);
  if (avgRow) {
    return {
      price: Math.round(avgRow.avg),
      currency: 'JPY',
      source: 'huca',
      condition: avgRow.cls.label ?? 'raw',
      url: avgRow.row.product_link ?? `https://huca.tw/cards/${avgRow.row.id}`,
      updatedAt: new Date().toISOString(),
    };
  }

  // 2) Snkrdunk used floor via the representative row's snkrdunk_id (true raw).
  const repRow = rows.find(r => r.snkrdunk_id) ?? rows[0];
  if (repRow?.snkrdunk_id) {
    const used = await lookupSnkrdunkUsed(repRow.snkrdunk_id);
    if (used) {
      return {
        price: used.price,
        currency: 'JPY',
        source: 'snkrdunk',
        condition: '二手最低',
        url: `https://snkrdunk.com/apparels/${encodeURIComponent(String(repRow.snkrdunk_id))}`,
        updatedAt: new Date().toISOString(),
      };
    }
  }

  // 3) Fall back to Huca's representative row (may carry a graded price) — keep
  //    its graded label so we never silently pass off a slab price as raw.
  return pickHucaRow(rows, null);
}

// Resolve a Huca result: graded cards keep the exact-slab matching logic; raw
// cards go through the average -> Snkrdunk-used -> representative fallback.
async function resolveHucaResult(rows: HucaRow[], wantGrade: string | null): Promise<PriceResult | null> {
  if (wantGrade) return pickHucaRow(rows, wantGrade);
  return pickHucaRawResult(rows);
}

// Look a Japanese card up on Huca. Prefer an exact set+number query, resolving
// the set code from the set NAME (TCGdex-authoritative) before trusting the
// client-supplied code, then only fall back to a name keyword search when no set
// code is available at all — and even then require the returned title to contain
// the card name, since the name search otherwise mis-prices unrelated cards.
async function lookupHuca(
  setCode: string,
  setName: string,
  num: string,
  name: string,
  wantGrade: string | null = null,
): Promise<PriceResult | null> {
  const digits = extractNumber(num);

  if (digits) {
    // Try the authoritative code resolved from the set NAME (TCGdex ids == Huca
    // codes) first, then the client-supplied code. This fixes cards whose stored
    // setName isn't in the client's local product map (empty setCode) or maps to
    // a stale/wrong code — the main "no price" cause. First code that returns a
    // priced row wins; a valid set-code lookup for the real card number can't
    // resolve to a different card.
    const resolved = await resolveHucaSetCode(setName);
    const seen = new Set<string>();
    const candidates = [resolved, setCode.trim()].filter((c): c is string => !!c);
    for (const code of candidates) {
      const key = code.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      const url = `${HUCA_API}?search=&set_code=${encodeURIComponent(code)}&card_number=${encodeURIComponent(digits)}&promo=0&accuracy=1&limit=10`;
      const json = await fetchJson<{ data?: HucaRow[] }>(url);
      const rows = json?.data ?? [];
      const result = await resolveHucaResult(rows, wantGrade);
      if (result) return result;
    }

    // Name-search fallback ONLY when we had no set code to query with at all
    // (both the resolved and client codes were empty). It's kept narrow because
    // a name keyword search readily returns a *different* same-named card and
    // would mis-price it — a wrong price is worse than an honest "no price".
    if (candidates.length === 0 && name) {
      const url = `${HUCA_API}?search=${encodeURIComponent(name)}&promo=0&accuracy=1&limit=5`;
      const json = await fetchJson<{ data?: HucaRow[] }>(url);
      const rows = json?.data ?? [];
      // Guard against unrelated matches: the title's name portion must BE this
      // card's name, not merely contain it (see hucaTitleMatchesName).
      const related = rows.filter(r => hucaTitleMatchesName(r.title ?? '', name));
      const result = await resolveHucaResult(related, wantGrade);
      if (result) return result;
    }
  }

  return null;
}

// -------- kapaipai (Traditional-Chinese cards) -----------------------------

// Normalise a card-number token so "012", "12" and " 12 " all compare equal.
// Falls back to an upper-cased trim for non-numeric ids (promos like "000P").
export function normNum(s: string): string {
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

// Whitespace-insensitive name key so "超級噴火龍Xex" and "超級噴火龍X ex" compare
// equal across kapaipai's inconsistent spacing.
export function nameKey(s: string): string {
  return (s ?? '').replace(/\s+/g, '').toLowerCase();
}

// Find the best-priced card row for a target number within one pack's rows.
// Returns the row + its in-pack number, preferring an exact name match when a
// number has several variants (sealed 原盒/散包 etc.).
export function pickKpRowForNumber(
  rows: KpCardRow[],
  packId: string,
  target: string,
  name: string,
): { row: KpCardRow; localNumber: string; price: number } | null {
  const matches = rows.filter(r => normNum(rowLocalNumber(r, packId)) === target);
  if (matches.length === 0) return null;
  const wantKey = nameKey(name);
  const ordered = [...matches].sort((a, b) => {
    const an = wantKey && nameKey(a.cardName) === wantKey ? 0 : 1;
    const bn = wantKey && nameKey(b.cardName) === wantKey ? 0 : 1;
    return an - bn;
  });
  for (const row of ordered) {
    const price = pickKpPrice(row);
    if (price == null) continue;
    return { row, localNumber: rowLocalNumber(row, packId), price };
  }
  return null;
}

function kpResult(packId: string, localNumber: string, price: number): PriceResult {
  return {
    price,
    currency: 'TWD',
    source: 'kapaipai',
    condition: null,
    // Canonical kapaipai global key is `${packId}-${localNumber}` (padded form).
    url: `https://trade.kapaipai.tw/card/${packId}-${localNumber}`,
    updatedAt: new Date().toISOString(),
  };
}

// Cross-pack fallback: kapaipai frequently files a card under a packId that
// differs from its printed set code (e.g. the SAR 超級噴火龍Xex printed "223/…"
// lives in pack M2a, not M2), and secret-rare numbers run past the base set's
// range — so a number lookup in the "expected" pack misses. When the direct
// pack lookup fails (or the item has no stored setName at all), scan every pack
// for a row whose card NAME matches (whitespace-insensitive) at the same number.
// Short-circuits on the first exact-name hit; caches each pack's detail. Only
// runs when we have both a name and a number to match on (avoids false hits).
async function findKapaipaiByName(num: string, name: string): Promise<PriceResult | null> {
  const wantKey = nameKey(name);
  if (!wantKey) return null;
  const pl = await getKpPackList();
  if (!pl) return null;
  const target = normNum(num);
  const packIds = [...pl.idToId.values()];
  // Scan packs in bounded-concurrency batches so a full miss (card in no pack)
  // stays a few seconds instead of ~174 sequential round-trips (would risk the
  // cron/interactive timeout). Detail fetches are cached, so this warms the
  // cache for later cards in the same run too.
  const BATCH = 8;
  for (let i = 0; i < packIds.length; i += BATCH) {
    const batch = packIds.slice(i, i + BATCH);
    const results = await Promise.all(
      batch.map(async packId => {
        const rows = await getKpPackDetail(packId);
        const hit = rows.find(
          r => normNum(rowLocalNumber(r, packId)) === target && nameKey(r.cardName) === wantKey,
        );
        if (!hit) return null;
        const price = pickKpPrice(hit);
        return price != null ? kpResult(packId, rowLocalNumber(hit, packId), price) : null;
      }),
    );
    const found = results.find(r => r != null);
    if (found) return found;
  }
  return null;
}

async function lookupKapaipai(setCode: string, setName: string, num: string, name: string): Promise<PriceResult | null> {
  // 1) Direct: resolve the item's set to a kapaipai packId and match by number.
  const packId = await resolvePackId(setCode, setName);
  if (packId) {
    const rows = await getKpPackDetail(packId);
    const picked = pickKpRowForNumber(rows, packId, normNum(num), name);
    if (picked) return kpResult(packId, picked.localNumber, picked.price);
  }
  // 2) Fallback: the set didn't resolve, the number wasn't in that pack, or the
  //    card is filed under a different packId (secret rares). Search by name.
  return findKapaipaiByName(num, name);
}

export interface PriceQuery {
  setCode: string;
  setName: string;
  number: string;
  name: string;
  edition: string; // 'ja' | 'zh-tw' | ...
  wantGrade?: string | null; // e.g. 'PSA10' when the card is graded
  itemType?: string | null; // 'single' | 'box'
  snkrdunkId?: string | number | null; // sealed-box Snkrdunk product id
}

// Resolve a market price from the right free source. Sealed boxes with a
// curated Snkrdunk id price directly off Snkrdunk. For singles: zh-tw ->
// kapaipai (TWD), everything else -> Huca (JPY). Graded cards pass a wantGrade
// so Huca lookups match the right slab price.
export async function resolveCardPrice(q: PriceQuery): Promise<PriceResult | null> {
  const edition = (q.edition || 'ja').trim();
  if (q.itemType === 'box' && q.snkrdunkId) {
    const boxResult = await lookupSnkrdunkBox(q.snkrdunkId);
    if (boxResult) return boxResult;
  }
  if (edition === 'zh-tw') {
    return lookupKapaipai(q.setCode, q.setName, q.number, q.name);
  }
  return lookupHuca(q.setCode, q.setName, q.number, q.name, q.wantGrade ?? null);
}
