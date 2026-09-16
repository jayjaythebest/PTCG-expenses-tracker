import type { CollectionItem } from '../types';

// The day a card counts as added: its editable 入手日期, or the day the row was
// inserted for rows that predate that field. Local calendar date, YYYY-MM-DD —
// the same basis the gallery's date sort uses.
export function itemDay(i: Pick<CollectionItem, 'acquiredDate' | 'createdAt'>): string {
  if (i.acquiredDate) return i.acquiredDate.slice(0, 10);
  const d = new Date(i.createdAt);
  if (!Number.isFinite(d.getTime())) return '';
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// 'all', a 'YYYY-MM' month, or an inclusive day range (either end may be open).
export type DateFilter =
  | { kind: 'all' }
  | { kind: 'month'; month: string }
  | { kind: 'range'; from: string; to: string };

export function matchesDateFilter(day: string, f: DateFilter): boolean {
  if (f.kind === 'all') return true;
  if (!day) return false;
  if (f.kind === 'month') return day.startsWith(`${f.month}-`);
  return (!f.from || day >= f.from) && (!f.to || day <= f.to);
}

// Months that have at least one card, newest first, with how many rows fall in each.
export function monthCounts(days: string[]): { month: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const d of days) {
    if (!d) continue;
    const m = d.slice(0, 7);
    counts.set(m, (counts.get(m) ?? 0) + 1);
  }
  return [...counts]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([month, count]) => ({ month, count }));
}
