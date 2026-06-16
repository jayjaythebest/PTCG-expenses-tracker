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
