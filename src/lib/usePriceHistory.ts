import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { CollectionItem, ItemPricePoint } from '../types';
import { estValue, toTwd } from './collectionValue';

// Per-card daily price history. collection_value_snapshots tracks the collection
// TOTAL, which moves both when prices change and when cards are bought — this
// series is per card, so the home screen can say which cards actually moved.
//
// Written by the daily cron (/api/snapshot-collection) and refreshed here on
// load, both upserting on (item_id, snapshot_date). The client write matters
// because it keeps history accruing on days the cron is late or failing, and it
// captures cards added since the last cron run.

// How far back the home screen ever needs to look. Keeps the payload small on a
// collection that has been tracked for years.
const WINDOW_DAYS = 60;

function isoDaysAgo(days: number): string {
  const d = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function todayIso(): string {
  return isoDaysAgo(0);
}

function mapRow(row: Record<string, unknown>): ItemPricePoint {
  return {
    itemId:  row.item_id as string,
    date:    (row.snapshot_date as string).slice(0, 10),
    unitTwd: Number(row.unit_twd ?? 0),
    price:   Number(row.price ?? 0),
    currency: (row.currency as string | null) ?? 'JPY',
  };
}

// The migration in supabase/collection_schema.sql may not have been run yet.
// Postgres reports an unknown table as 42P01; treat that as "feature not enabled
// yet" rather than an error worth shouting about on every page load.
function isMissingTable(code?: string): boolean {
  return code === '42P01';
}

export function usePriceHistory() {
  const [points, setPoints] = useState<ItemPricePoint[]>([]);
  const [loading, setLoading] = useState(true);
  // false once we learn the table isn't there, so the UI can explain itself.
  const [available, setAvailable] = useState(true);
  const recordedRef = useRef(false);

  async function fetchPoints() {
    const { data, error } = await supabase
      .from('collection_price_history')
      .select('item_id, snapshot_date, unit_twd, price, currency')
      .gte('snapshot_date', isoDaysAgo(WINDOW_DAYS))
      .order('snapshot_date', { ascending: true });

    if (error) {
      if (isMissingTable(error.code)) {
        setAvailable(false);
      } else {
        console.error('Supabase price history error:', error);
      }
    } else {
      setPoints((data ?? []).map(mapRow));
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchPoints();
  }, []);

  // Record today's price for every priced card, once per session. Idempotent via
  // the (item_id, snapshot_date) primary key, so re-running just overwrites
  // today's row with the latest figure.
  const recordToday = async (items: CollectionItem[], rate: number) => {
    if (recordedRef.current || !available) return;
    const date = todayIso();
    const payload = items
      .map(i => ({ i, est: estValue(i) }))
      .filter((x): x is { i: CollectionItem; est: { amount: number; currency: 'JPY' | 'TWD' } } => x.est != null)
      .map(({ i, est }) => ({
        item_id: i.id,
        snapshot_date: date,
        price: est.amount,
        currency: est.currency,
        unit_twd: toTwd(est.amount, est.currency, rate),
        quantity: i.quantity,
        source: i.marketPrice != null ? (i.marketPriceSource ?? null) : 'estimate',
      }))
      // A zero would poison a future baseline (division by zero / fake −100%).
      .filter(r => r.unit_twd > 0);

    if (!payload.length) return;
    recordedRef.current = true;

    const { error } = await supabase
      .from('collection_price_history')
      .upsert(payload, { onConflict: 'item_id,snapshot_date' });

    if (error) {
      if (isMissingTable(error.code)) {
        setAvailable(false);
      } else {
        console.error('price history upsert failed:', error);
        recordedRef.current = false; // allow a retry on the next mount
      }
      return;
    }
    fetchPoints();
  };

  return { points, loading, available, recordToday };
}
