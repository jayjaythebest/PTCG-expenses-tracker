import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { CollectionValueSnapshot } from '../types';

// Reads the daily collection-value snapshot series (stock-ticker style) and
// lets the client record/refresh today's snapshot on load. Snapshots are keyed
// by date, so upserting today is idempotent — the daily cron and the client can
// both write without creating duplicates. Together they give the home screen a
// week-over-week value change plus a recent trend line.
//
// One row per day, keyed by date ALONE — there is nowhere to record whose
// collection a row describes. The account is shared by several collectors
// (src/data/collectionOwners.ts), so callers must pass PRIMARY_OWNER's totals
// only. Feeding this the combined total of every tab would silently restate the
// account holder's net worth, and because the series is history, past days
// couldn't be recomputed to fix it.

function mapRow(row: Record<string, unknown>): CollectionValueSnapshot {
  return {
    date:      (row.snapshot_date as string).slice(0, 10),
    totalTwd:  Number(row.total_twd ?? 0),
    itemCount: Number(row.item_count ?? 0),
  };
}

function todayIso(): string {
  // Local calendar day (the user's device), so "today" matches what they see.
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function useValueSnapshots() {
  const [snapshots, setSnapshots] = useState<CollectionValueSnapshot[]>([]);
  const [loading, setLoading] = useState(true);
  const recordedRef = useRef(false);

  async function fetchSnapshots() {
    const { data, error } = await supabase
      .from('collection_value_snapshots')
      .select('*')
      .order('snapshot_date', { ascending: true });
    if (error) {
      console.error('Supabase snapshots error:', error);
    } else {
      setSnapshots((data ?? []).map(mapRow));
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchSnapshots();
  }, []);

  // Upsert today's snapshot once per session, then re-read so the home screen
  // reflects the just-recorded point. Skips when the total is 0 (nothing priced
  // yet) so we don't seed a misleading zero baseline.
  const recordToday = async (totalTwd: number, itemCount: number) => {
    if (recordedRef.current) return;
    if (totalTwd <= 0) return;
    recordedRef.current = true;
    const { error } = await supabase
      .from('collection_value_snapshots')
      .upsert(
        { snapshot_date: todayIso(), total_twd: Math.round(totalTwd), item_count: itemCount },
        { onConflict: 'snapshot_date' },
      );
    if (error) {
      console.error('snapshot upsert failed:', error);
      recordedRef.current = false; // allow a retry next mount
      return;
    }
    fetchSnapshots();
  };

  return { snapshots, loading, recordToday };
}
