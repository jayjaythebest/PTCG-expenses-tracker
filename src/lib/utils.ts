import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { format } from 'date-fns';
import { Expense } from '../types';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// yyyy-MM bucket for an ISO date string
export function yearMonth(dateStr: string): string {
  return format(new Date(dateStr), 'yyyy-MM');
}

export function inMonth(dateStr: string, ym: string): boolean {
  return yearMonth(dateStr) === ym;
}

// Distinct yyyy-MM values present in the data, newest first.
export function availableMonths(expenses: Expense[]): string[] {
  const set = new Set(expenses.map(e => yearMonth(e.date)));
  return Array.from(set).sort((a, b) => b.localeCompare(a));
}

// "2026-04" -> "2026年4月"
export function formatMonthLabel(ym: string): string {
  const [y, m] = ym.split('-');
  return `${y}年${Number(m)}月`;
}

// Compact zh-TW relative time ("剛剛" / "3 小時前" / "5 天前" / "2 個月前") for
// "last updated" notes — the FX rate on the home screen, the price-fetch
// timestamp in the collection. Returns null for missing or unparseable input so
// callers can simply omit the note.
export function relativeTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return `${Math.floor(days / 30)} 個月前`;
}
