import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { resolveCardPrice, buildWantGrade } from './_lib/pricing.js';
import { supabaseUrl, serviceRoleKey } from './_lib/env.js';
import { PTCG_PRODUCTS } from '../src/data/ptcg-products.js';
import { boxSnkrdunkId } from '../src/data/ptcg-boxes.js';
import { PRIMARY_OWNER, ownerOf } from '../src/data/collectionOwners.js';
import { fetchWithTimeout } from '../src/lib/fetchTimeout.js';

// Daily cron. Three jobs, in order:
//   1. Refresh every single card's live market price from its source (Huca for
//      Japanese cards, kapaipai for zh-tw) and persist it back to the row — so
//      prices update automatically each day, not only when the user taps
//      「更新價格」in the app.
//   2. Record EACH card's price for today in collection_price_history, so
//      "which cards moved this week" is answerable. The collection total alone
//      can't answer it: the total also moves when cards are bought or sold.
//   3. Record ONE snapshot of the whole collection's current market value (TWD)
//      so the home screen can show a stock-ticker-style week-over-week change
//      and trend line — even on days the user never opens the app. Keyed by
//      date, so it's idempotent with the client-side upsert-on-load.
//
// Steps 1 and 2 cover EVERY owner's cards (see src/data/collectionOwners.ts) —
// the account is shared, and every tab wants fresh prices and its own history,
// which per-card rows can express. Step 3 covers PRIMARY_OWNER only, because its
// table is keyed by date alone: there is exactly one row per day with no room to
// say whose collection it describes. See the filter at the bottom.
//
//   Cron: /api/snapshot-collection (see vercel.json)

interface ItemRow {
  id: string;
  name: string;
  set_name: string | null;
  card_number: string | null;
  edition: string | null;
  item_type: string | null;
  market_price: number | null;
  market_price_currency: string | null;
  market_price_source: string | null;
  current_value: number | null;
  quantity: number | null;
  is_graded: boolean | null;
  grading_company: string | null;
  grade: string | null;
  owner: string | null;
}

const HUCA_FX = 'https://huca.tw/api/fx_rates.php';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';
const FALLBACK_JPY_TO_TWD = 0.2;

// Japanese set name -> Huca set code (mirrors the client's SET_CODE_BY_NAME).
const SET_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  PTCG_PRODUCTS.map(p => [p.name, p.code]),
);

// JPY -> TWD rate (mirrors /api/fx). Falls back to a rough static rate.
async function jpyToTwd(): Promise<number> {
  try {
    const r = await fetchWithTimeout(HUCA_FX, { headers: { 'User-Agent': UA } });
    if (r.ok) {
      const rates = (await r.json()) as Record<string, number>;
      if (Number.isFinite(rates.JPY) && Number.isFinite(rates.TWD) && rates.JPY > 0) {
        return rates.TWD / rates.JPY;
      }
    }
  } catch {
    // keep fallback
  }
  return FALLBACK_JPY_TO_TWD;
}

// A single card's value in TWD, per copy: market price wins (in its own
// currency), else the manual estimate (JPY). Mirrors src/lib/collectionValue.ts.
function unitTwd(row: ItemRow, rate: number): number {
  if (row.market_price != null) {
    const twd = row.market_price_currency === 'TWD' ? row.market_price : row.market_price * rate;
    return Math.round(twd);
  }
  if (row.current_value != null) return Math.round(row.current_value * rate);
  return 0;
}

// Quantity-aware value of a holding, for the collection total.
function valueTwd(row: ItemRow, rate: number): number {
  return unitTwd(row, rate) * (row.quantity ?? 1);
}

// Re-fetch and persist each single card's live market price. Mutates the passed
// rows in place so the snapshot below reflects today's fresh prices. Best-effort
// per card: a lookup miss or error leaves the previous price untouched. The
// Supabase client is untyped here — the generated-schema generics fight the
// plain snake_case write payload and add no safety for a server-side script.
// Refresh one card's live price and persist it. Best-effort: returns true only
// when a fresh price was fetched and written. Mutates the row so the snapshot
// below totals today's price.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshOne(supabase: any, row: ItemRow): Promise<boolean> {
  const edition = row.edition ?? 'ja';
  const setName = row.set_name ?? '';
  // ja resolves via set code (from our local map); zh-tw resolves via set name.
  const setCode = edition === 'zh-tw' ? '' : (SET_CODE_BY_NAME[setName] ?? '');
  const wantGrade = buildWantGrade(row.is_graded, row.grading_company, row.grade);
  const itemType = row.item_type ?? 'single';
  // Boxes are priced off a curated Snkrdunk id (JA only) when available.
  const snkrdunkId = itemType === 'box'
    ? boxSnkrdunkId(SET_CODE_BY_NAME[setName] ?? '', edition)
    : undefined;
  try {
    const p = await resolveCardPrice({
      setCode,
      setName,
      number: row.card_number ?? '',
      name: row.name ?? '',
      edition,
      wantGrade,
      itemType,
      snkrdunkId,
    });
    if (!p || p.price == null) return false;
    const currency = p.currency ?? (edition === 'zh-tw' ? 'TWD' : 'JPY');
    const source = p.source ?? (edition === 'zh-tw' ? 'kapaipai' : 'huca');
    const { error } = await supabase
      .from('collection_items')
      .update({
        market_price: p.price,
        market_price_currency: currency,
        market_price_source: source,
        market_price_updated_at: p.updatedAt,
        market_price_condition: p.condition ?? null,
      } as never)
      .eq('id', row.id);
    if (error) return false;
    // Reflect the fresh price locally so the snapshot totals it.
    row.market_price = p.price;
    row.market_price_currency = currency;
    return true;
  } catch {
    // leave the previous price in place
    return false;
  }
}

// Refresh every single card's live market price, running a small number of
// lookups concurrently (gentle on the sources, but well under maxDuration).
const REFRESH_CONCURRENCY = 5;

// vercel.json allows this function 60s. Stop starting new lookups once we're
// this far in, so the two writes that follow — the per-card history and the
// day's collection-value snapshot, which are the job's actual output — still
// happen. A day with some prices a little stale beats a day with no row at all,
// and the row can't be recomputed later because it IS the history.
const REFRESH_BUDGET_MS = 45_000;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshPrices(
  supabase: any,
  rows: ItemRow[],
  deadline: number,
): Promise<{ refreshed: number; skipped: number; timedOut: boolean }> {
  // Singles always; boxes only when they map to a curated Snkrdunk id (JA).
  // Manual overrides are skipped so the cron never clobbers a hand-set price.
  const priceable = rows.filter(
    r =>
      r.market_price_source !== 'manual' &&
      (r.item_type === 'single' ||
        (r.item_type === 'box' &&
          boxSnkrdunkId(SET_CODE_BY_NAME[r.set_name ?? ''] ?? '', r.edition ?? 'ja') != null)),
  );
  let refreshed = 0;
  let i = 0;
  for (; i < priceable.length; i += REFRESH_CONCURRENCY) {
    if (Date.now() > deadline) break;
    const batch = priceable.slice(i, i + REFRESH_CONCURRENCY);
    const results = await Promise.all(batch.map(row => refreshOne(supabase, row)));
    refreshed += results.filter(Boolean).length;
  }
  const skipped = Math.max(0, priceable.length - i);
  if (skipped > 0) {
    console.warn(`[snapshot-collection] price budget spent; ${skipped} card(s) keep yesterday's price`);
  }
  return { refreshed, skipped, timedOut: skipped > 0 };
}

// Persist today's per-card prices so "which cards moved" is answerable later.
// Deliberately non-fatal: a missing table (the migration hasn't been run yet) or
// a write error must not lose the collection-total snapshot below, which is the
// job's primary output. Returns a short reason when it didn't write.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function recordPriceHistory(
  supabase: any,
  rows: ItemRow[],
  rate: number,
  date: string,
): Promise<{ written: number; error?: string }> {
  // Only cards we can actually price — a 0 would poison a future baseline.
  const payload = rows
    .map(r => ({ r, unit: unitTwd(r, rate) }))
    .filter(({ unit }) => unit > 0)
    .map(({ r, unit }) => ({
      item_id: r.id,
      snapshot_date: date,
      price: r.market_price ?? r.current_value ?? 0,
      currency: r.market_price != null ? (r.market_price_currency ?? 'JPY') : 'JPY',
      unit_twd: unit,
      quantity: r.quantity ?? 1,
      source: r.market_price != null ? (r.market_price_source ?? null) : 'estimate',
    }));

  if (!payload.length) return { written: 0 };

  const { error } = await supabase
    .from('collection_price_history')
    .upsert(payload, { onConflict: 'item_id,snapshot_date' });

  if (error) {
    console.error('[snapshot-collection] price history write failed:', error.message);
    return { written: 0, error: error.message };
  }
  return { written: payload.length };
}

function todayIso(): string {
  // Taiwan calendar day (UTC+8), so the snapshot date matches the user's day.
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Start the clock before anything else, so the price budget is measured
  // against the platform's limit and not against whenever step 1 begins.
  const startedAt = Date.now();

  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const url = supabaseUrl();
  const key = serviceRoleKey();
  if (!url || !key) {
    console.error('[snapshot-collection] missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY');
    return res.status(503).json({ error: 'Supabase not configured' });
  }
  const supabase = createClient(url, key);

  // Soft-deleted cards (deleted_at set) sit in the app's 已刪除 graveyard and are
  // excluded from the totals the UI shows — so exclude them here too, or the
  // cron's snapshot would disagree with the app and the trend line would step.
  const { data: items, error } = await supabase
    .from('collection_items')
    .select('id, name, set_name, card_number, edition, item_type, market_price, market_price_currency, market_price_source, current_value, quantity, is_graded, grading_company, grade, owner')
    .is('deleted_at', null);

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const rows = (items ?? []) as unknown as ItemRow[];

  // 1) Refresh live prices (mutates rows in place), stopping in time to write.
  const { refreshed, skipped, timedOut } = await refreshPrices(
    supabase,
    rows,
    startedAt + REFRESH_BUDGET_MS,
  );

  // 2) Record each card's price for today (per-card history).
  const rate = await jpyToTwd();
  const history = await recordPriceHistory(supabase, rows, rate, todayIso());

  // 3) Snapshot today's total from the freshened prices — the ACCOUNT HOLDER's
  // cards only. collection_value_snapshots has one row per day keyed by date
  // alone, and the home screen's value chart is drawn from it, so that row has
  // to mean one specific person's collection. Folding a friend's cards in would
  // restate his net worth, and since the history is a running series that can't
  // be recomputed for past days, the damage wouldn't be undoable.
  const ownRows = rows.filter(r => ownerOf({ owner: r.owner ?? undefined }) === PRIMARY_OWNER);
  const totalTwd = ownRows.reduce((sum, r) => sum + valueTwd(r, rate), 0);
  const itemCount = ownRows.reduce((sum, r) => sum + (r.quantity ?? 1), 0);

  const { error: upsertError } = await supabase
    .from('collection_value_snapshots')
    .upsert(
      { snapshot_date: todayIso(), total_twd: Math.round(totalTwd), item_count: itemCount },
      { onConflict: 'snapshot_date' },
    );

  if (upsertError) {
    return res.status(500).json({ error: upsertError.message });
  }

  return res.status(200).json({
    ok: true,
    date: todayIso(),
    refreshed,
    // Reported so a run that ran out of time is visible in the cron log rather
    // than looking like a day when nothing moved.
    ...(timedOut ? { skipped, timedOut } : {}),
    totalTwd: Math.round(totalTwd),
    itemCount,
    historyRows: history.written,
    ...(history.error ? { historyError: history.error } : {}),
  });
}
