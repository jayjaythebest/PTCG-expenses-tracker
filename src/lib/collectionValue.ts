// Shared collection-value math, so the Home summary and the Collection page (and
// the daily snapshot logic) all agree on how a card's worth is computed.
//
// A card's "current value" is the auto-fetched market price when we have one
// (in its own currency), otherwise the user's manual estimate (JPY). Everything
// is normalised to TWD for cross-currency totals using the JPY->TWD rate.
import { CollectionItem } from '../types';

// JPY -> TWD (rounded to whole TWD).
export function twdOf(jpy: number, rate: number): number {
  return Math.round(jpy * rate);
}

// Convert an amount in its native currency to TWD.
export function toTwd(amount: number, currency: 'JPY' | 'TWD', rate: number): number {
  return currency === 'TWD' ? Math.round(amount) : twdOf(amount, rate);
}

// Live current value for a card, in its native currency: the auto-fetched market
// price wins (its own currency), otherwise the user's recorded estimate (JPY).
export function estValue(i: CollectionItem): { amount: number; currency: 'JPY' | 'TWD' } | null {
  if (i.marketPrice != null) return { amount: i.marketPrice, currency: i.marketPriceCurrency === 'TWD' ? 'TWD' : 'JPY' };
  if (i.currentValue != null) return { amount: i.currentValue, currency: 'JPY' };
  return null;
}

// Total current market value of the whole collection, in TWD (quantity-aware).
export function totalCurrentTwd(items: CollectionItem[], rate: number): number {
  return items.reduce((sum, i) => {
    const e = estValue(i);
    return sum + (e ? toTwd(e.amount, e.currency, rate) : 0) * i.quantity;
  }, 0);
}

// Total number of cards held (sum of quantities).
export function totalItemCount(items: CollectionItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

// Overall unrealised P&L in TWD: live market price vs. the user's recorded
// estimate (現估價), summed only over items that have BOTH (so there's a
// baseline). Returns the absolute diff, the baseline it's measured against, and
// the percentage — so callers can render "+NT$X (+y%)".
export function totalPnlTwd(items: CollectionItem[], rate: number): { diff: number; base: number; pct: number } {
  let diff = 0;
  let base = 0;
  for (const i of items) {
    if (i.marketPrice == null || i.currentValue == null) continue;
    const market = toTwd(i.marketPrice, i.marketPriceCurrency === 'TWD' ? 'TWD' : 'JPY', rate);
    const b = toTwd(i.currentValue, 'JPY', rate);
    if (b <= 0) continue;
    base += b * i.quantity;
    diff += (market - b) * i.quantity;
  }
  return { diff, base, pct: base > 0 ? (diff / base) * 100 : 0 };
}
