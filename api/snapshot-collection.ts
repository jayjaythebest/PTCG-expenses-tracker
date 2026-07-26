import type { VercelRequest, VercelResponse } from '@vercel/node';
import { createClient } from '@supabase/supabase-js';

// Daily cron: record ONE snapshot of the whole collection's current market value
// (in TWD) so the home screen can show a stock-ticker-style week-over-week
// change and trend line — even on days the user never opens the app. Keyed by
// date, so it's idempotent with the client-side upsert-on-load.
//
//   Cron: /api/snapshot-collection (see vercel.json)

interface ItemRow {
  market_price: number | null;
  market_price_currency: string | null;
  current_value: number | null;
  quantity: number | null;
}

const HUCA_FX = 'https://huca.tw/api/fx_rates.php';
const UA = 'Mozilla/5.0 (compatible; PTCGTracker/1.0)';
const FALLBACK_JPY_TO_TWD = 0.2;

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
    .select('market_price, market_price_currency, current_value, quantity');

  if (error) {
    return res.status(500).json({ error: error.message });
  }

  const rows = (items ?? []) as ItemRow[];
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

  return res.status(200).json({ ok: true, date: todayIso(), totalTwd: Math.round(totalTwd), itemCount });
}
