// 入手紀錄 — when each batch of copies actually arrived.
//
// `collection_items.quantity` says a shelf holds four boxes; it cannot say that
// two came in August and two in September. Merging a repeat purchase into the
// existing row (the 「已經有這個了」 prompt) used to throw that away: the
// quantity went 2 → 4 and the row kept its original 入手日期, so the second
// purchase left no trace at all.
//
// A row in `collection_acquisitions` is one such arrival. The item's `quantity`
// stays the source of truth for every value calculation — this module is the
// history beside it, and the two are reconciled loudly (see logDrift) rather
// than silently.
import type { CollectionItem } from '../types';
import { itemDay } from './collectionDate';

export interface AcquisitionEntry {
  id: string;
  itemId: string;
  date: string;      // ISO 'YYYY-MM-DD' — the day those copies were acquired
  quantity: number;
  createdAt: string;
}

// What to write for an arrival, before the DB assigns it an id.
export type AcquisitionInput = Pick<AcquisitionEntry, 'date' | 'quantity'>;

// Every row predates this table, and so does every row added by a client that
// hasn't run the migration. Rather than show those as "no history", read the
// one arrival they DO describe off the item itself: its 入手日期 and quantity.
// `legacy` tells the UI these lines aren't stored rows — they can't be deleted,
// and the day is the item's own, not a recorded event.
export interface AcquisitionLog {
  rows: AcquisitionEntry[];
  legacy: boolean;
}

// Newest arrival first, matching the gallery's own default date order. The
// created_at tiebreak keeps two purchases made on the same day in the order they
// were entered instead of shuffling between renders.
const byNewest = (a: AcquisitionEntry, b: AcquisitionEntry): number =>
  b.date.localeCompare(a.date) || b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id);

export function logFor(item: CollectionItem, entries: AcquisitionEntry[] | undefined): AcquisitionLog {
  const rows = (entries ?? []).filter(e => e.itemId === item.id);
  if (rows.length > 0) return { rows: [...rows].sort(byNewest), legacy: false };
  return {
    legacy: true,
    rows: [{
      id: `legacy:${item.id}`,
      itemId: item.id,
      date: itemDay(item),
      quantity: item.quantity,
      createdAt: item.createdAt,
    }],
  };
}

export const logTotal = (rows: AcquisitionEntry[]): number =>
  rows.reduce((s, r) => s + r.quantity, 0);

// How far the ledger has drifted from the quantity the row actually carries.
// Editing 數量 by hand doesn't invent an arrival date, so the two CAN disagree;
// when they do the panel says so instead of quietly showing a wrong total.
// Positive = the log counts more copies than the row holds.
export const logDrift = (item: CollectionItem, log: AcquisitionLog): number =>
  log.legacy ? 0 : logTotal(log.rows) - item.quantity;

// ---- Folding a duplicate group's histories together ----

export interface FoldPlan {
  // Stored entries belonging to the rows being dropped — re-pointed at the keeper.
  move: string[];
  // Rows that never had stored entries: their one implied arrival, materialised
  // under the keeper so merging doesn't erase when those copies turned up.
  create: AcquisitionInput[];
}

// The keeper ends up holding every copy in the group, so it must end up holding
// every arrival too. Rows that already have entries hand them over; rows that
// don't (legacy, or added before the migration) contribute the single arrival
// their 入手日期 implies.
export function planFold(
  group: CollectionItem[],
  keepId: string,
  byItem: Record<string, AcquisitionEntry[] | undefined>,
): FoldPlan {
  const move: string[] = [];
  const create: AcquisitionInput[] = [];
  for (const row of group) {
    const stored = byItem[row.id] ?? [];
    if (stored.length > 0) {
      // The keeper's own entries are already where they belong.
      if (row.id !== keepId) move.push(...stored.map(e => e.id));
    } else {
      const day = itemDay(row);
      if (day) create.push({ date: day, quantity: row.quantity });
    }
  }
  return { move, create };
}
