import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';
import { resolveCardPrice, buildWantGrade } from './_lib/pricing';
import { PTCG_PRODUCTS } from '../src/data/ptcg-products';

// Daily cron. Two jobs, in order:
//   1. Refresh every single card's live market price from its source (Huca for
//      Japanese cards, kapaipai for zh-tw) and persist it back to the row — so
//      prices update automatically each day, not only when the user taps
//      「更新價格」in the app.
//   2. Record ONE snapshot of the whole collection's current market value (TWD)
//      so the home screen can show a stock-ticker-style week-over-week change
//      and trend line — even on days the user never opens the app. Keyed by
//      date, so it's idempotent with the client-side upsert-on-load.
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
  current_value: number | null;
  quantity: number | null;
  is_graded: boolean | null;
  grading_company: string | null;
  grade: string | null;
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
    const r = await fetch(HUCA_FX, { headers: { 'User-Agent': UA } });
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

// A card's current value in TWD (quantity-aware): market price wins (its own
// currency), else the manual estimate (JPY). Mirrors src/lib/collectionValue.ts.
function valueTwd(row: ItemRow, rate: number): number {
  const qty = row.quantity ?? 1;
  if (row.market_price != null) {
    const twd = row.market_price_currency === 'TWD' ? row.market_price : row.market_price * rate;
    return Math.round(twd) * qty;
  }
  if (row.current_value != null) return Math.round(row.current_value * rate) * qty;
  return 0;
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
  try {
    const p = await resolveCardPrice({
      setCode,
      setName,
      number: row.card_number ?? '',
      name: row.name ?? '',
      edition,
      wantGrade,
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function refreshPrices(supabase: any, rows: ItemRow[]): Promise<{ refreshed: number }> {
  const singles = rows.filter(r => r.item_type === 'single');
  let refreshed = 0;
  for (let i = 0; i < singles.length; i += REFRESH_CONCURRENCY) {
    const batch = singles.slice(i, i + REFRESH_CONCURRENCY);
    const results = await Promise.all(batch.map(row => refreshOne(supabase, row)));
    refreshed += results.filter(Boolean).length;
  }
  return { refreshed };
}

function todayIso(): string {
  // Taiwan calendar day (UTC+8), so the snapshot date matches the user's day.
  const tw = new Date(Date.now() + 8 * 60 * 60 * 1000);
  return tw.toISOString().slice(0, 10);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.headers.authorization !== `Bearer ${process.env.CRON_SECRET}`) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const supabase = createClient(
    process.env.SUPABASE_URL as string,
    process.env.SUPABASE_SERVICE_ROLE_KEY as string,
  );

  const { data: items, error } = await supabase
    .from('collection_items')
    .select('id, name, set_name, card_number, edition, item_type, market_price, market_price_currency, current_value, quantity, is_graded, grading_company, grade');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const rows = (items ?? []) as unknown as ItemRow[];

  // 1) Refresh live prices (mutates rows in place).
  const { refreshed } = await refreshPrices(supabase, rows);

  // 2) Snapshot today's total from the freshened prices.
  const rate = await jpyToTwd();
  const totalTwd = rows.reduce((sum, r) => sum + valueTwd(r, rate), 0);
  const itemCount = rows.reduce((sum, r) => sum + (r.quantity ?? 1), 0);

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
    totalTwd: Math.round(totalTwd),
    itemCount,
  });
}
