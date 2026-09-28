import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { IS_DEMO, readOnly } from './demo';
import type { AcquisitionEntry, AcquisitionInput } from './acquisitions';

let channelCounter = 0;

// Postgres "relation does not exist" and PostgREST's "table not in the schema
// cache" — both mean the migration in supabase/collection_schema.sql hasn't been
// run against this project yet. The gallery must keep working in that state, so
// the hook reports itself unavailable and every reader falls back to the
// item-derived log (see logFor in ./acquisitions).
const MISSING_TABLE = new Set(['42P01', 'PGRST205']);
const isMissingTable = (err: { code?: string } | null): boolean => !!err?.code && MISSING_TABLE.has(err.code);

function mapRow(row: Record<string, unknown>): AcquisitionEntry {
  return {
    id:        row.id as string,
    itemId:    row.item_id as string,
    date:      (row.acquired_date as string).slice(0, 10),
    quantity:  (row.quantity as number | null) ?? 1,
    createdAt: row.created_at as string,
  };
}

// The 入手紀錄 ledger for every card, keyed by item id.
//
// Loaded in one query rather than per card: the table holds a handful of rows
// per item at most, and the gallery needs to know which tiles have history to
// show before anything is tapped.
export function useAcquisitions() {
  const [byItem, setByItem] = useState<Record<string, AcquisitionEntry[]>>({});
  // True when the table isn't there yet. Distinct from "loaded and empty".
  const [unavailable, setUnavailable] = useState(IS_DEMO);
  const channelName = useRef(`acquisitions-${++channelCounter}`).current;

  async function fetchEntries() {
    const { data, error } = await supabase
      .from('collection_acquisitions')
      .select('*')
      .order('acquired_date', { ascending: false });

    if (error) {
      if (isMissingTable(error)) {
        console.warn('collection_acquisitions is missing — run supabase/collection_schema.sql');
        setUnavailable(true);
      } else {
        console.error('Supabase error:', error);
      }
      return;
    }
    const grouped: Record<string, AcquisitionEntry[]> = {};
    for (const row of data ?? []) {
      const e = mapRow(row);
      (grouped[e.itemId] ??= []).push(e);
    }
    setUnavailable(false);
    setByItem(grouped);
  }

  useEffect(() => {
    // Anon has no grant on this table, and the demo mounts no write control that
    // would produce an arrival anyway — see supabase/public_demo.sql.
    if (IS_DEMO) return;

    fetchEntries();
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_acquisitions' }, fetchEntries)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  // Every writer refetches rather than patching local state: realtime already
  // refetches on any other client's write, so one path keeps the ledger honest.
  const addEntries = async (itemId: string, inputs: AcquisitionInput[]) => {
    if (IS_DEMO) readOnly();
    if (inputs.length === 0) return;
    const { error } = await supabase.from('collection_acquisitions').insert(
      inputs.map(i => ({ item_id: itemId, acquired_date: i.date, quantity: i.quantity })),
    );
    if (error) throw error;
    await fetchEntries();
  };

  const addEntry = (itemId: string, input: AcquisitionInput) => addEntries(itemId, [input]);

  const updateEntry = async (id: string, input: AcquisitionInput) => {
    if (IS_DEMO) readOnly();
    const { error } = await supabase
      .from('collection_acquisitions')
      .update({ acquired_date: input.date, quantity: input.quantity })
      .eq('id', id);
    if (error) throw error;
    await fetchEntries();
  };

  const deleteEntry = async (id: string) => {
    if (IS_DEMO) readOnly();
    const { error } = await supabase.from('collection_acquisitions').delete().eq('id', id);
    if (error) throw error;
    await fetchEntries();
  };

  // Re-point arrivals at the row that survives a duplicate merge. The entries
  // themselves are untouched — the copies really did turn up on those days, they
  // are just filed under one card now.
  const moveEntries = async (ids: string[], toItemId: string) => {
    if (IS_DEMO) readOnly();
    if (ids.length === 0) return;
    const { error } = await supabase
      .from('collection_acquisitions')
      .update({ item_id: toItemId })
      .in('id', ids);
    if (error) throw error;
    await fetchEntries();
  };

  return { byItem, unavailable, addEntry, addEntries, updateEntry, deleteEntry, moveEntries, refetch: fetchEntries };
}
