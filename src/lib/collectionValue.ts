// Shared collection-value math, so the Home summary and the Collection page (and
// the daily snapshot logic) all agree on how a card's worth is computed.
//
// A card's "current value" is the auto-fetched market price when we have one
// (in its own currency), otherwise the user's manual estimate (JPY). Everything
// is normalised to TWD for cross-currency totals using the JPY->TWD rate.
import { CollectionItem, ItemPricePoint } from '../types';

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

// One card's contribution to the P&L above, kept alongside enough identity to
// render a row on the home screen.
export interface ValueMover {
  id: string;
  name: string;
  setName: string;
  imageUrl?: string;
  quantity: number;
  diff: number; // TWD, quantity-aware (can be negative)
  base: number; // TWD baseline it's measured against, quantity-aware
  pct: number;  // change vs. that baseline, in percent
}

// The biggest movers in the collection — same eligibility and math as
// totalPnlTwd (market price vs. the user's 現估價), just kept per card so the
// home screen can list them. Ranked by |pct| because "變化幅度" means the size
// of the swing, not the size of the card; ties break on money so a 10% move on
// an expensive card outranks 10% on a cheap one. Gains and losses are mixed
// together — a card that dropped 40% is exactly as newsworthy as one that rose.
export function topMoversTwd(items: CollectionItem[], rate: number, limit = 3): ValueMover[] {
  const movers: ValueMover[] = [];
  for (const i of items) {
    if (i.marketPrice == null || i.currentValue == null) continue;
    const market = toTwd(i.marketPrice, i.marketPriceCurrency === 'TWD' ? 'TWD' : 'JPY', rate);
    const unitBase = toTwd(i.currentValue, 'JPY', rate);
    if (unitBase <= 0) continue;
    const unitDiff = market - unitBase;
    // An unmoved card is not a mover; listing 0% entries would push real ones out.
    if (unitDiff === 0) continue;
    movers.push({
      id: i.id,
      name: i.name,
      setName: i.setName,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      diff: unitDiff * i.quantity,
      base: unitBase * i.quantity,
      pct: (unitDiff / unitBase) * 100,
    });
  }
  return rankMovers(movers, limit);
}

// Shared ranking: biggest swing first, money breaking percentage ties.
function rankMovers(movers: ValueMover[], limit: number): ValueMover[] {
  return movers
    .sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct) || Math.abs(b.diff) - Math.abs(a.diff))
    .slice(0, limit);
}

function isoDay(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

// Picks ONE baseline day for the whole comparison: the most recent recorded day
// at least `days` back, else the oldest day on record so the feature isn't blank
// for a week after the history table starts filling. Returns null when the only
// history we have is today's — nothing has had time to move yet.
//
// A single shared baseline (rather than per-card) is what makes the headline
// honest: every card in the list is measured over the same window, and a card
// bought after that day simply doesn't appear, which is correct — it hasn't
// moved, we just started watching it.
export function moverBaselineDate(
  points: ItemPricePoint[],
  days = 7,
  now: Date = new Date(),
): string | null {
  if (!points.length) return null;
  const today = isoDay(now);
  const dates = [...new Set(points.map(p => p.date))].filter(d => d < today).sort();
  if (!dates.length) return null;
  const cutoff = isoDay(new Date(now.getTime() - days * 24 * 60 * 60 * 1000));
  return [...dates].reverse().find(d => d <= cutoff) ?? dates[0];
}

export interface MoverWindow {
  baselineDate: string;
  days: number;         // elapsed days the numbers cover
  movers: ValueMover[];
}

// The biggest movers measured against recorded history — the real "這張卡漲跌了
// 多少", as opposed to topMoversTwd's comparison against a static estimate.
// Returns null when history is too young to compare, so callers can fall back.
export function topMoversByHistory(
  items: CollectionItem[],
  points: ItemPricePoint[],
  rate: number,
  { days = 7, limit = 3, now = new Date() }: { days?: number; limit?: number; now?: Date } = {},
): MoverWindow | null {
  const baselineDate = moverBaselineDate(points, days, now);
  if (!baselineDate) return null;

  // Each card's recorded value on the baseline day.
  const baseByItem = new Map<string, number>();
  for (const p of points) {
    if (p.date === baselineDate) baseByItem.set(p.itemId, p.unitTwd);
  }

  const movers: ValueMover[] = [];
  for (const i of items) {
    const unitBase = baseByItem.get(i.id);
    if (unitBase == null || unitBase <= 0) continue; // not held / not priced then
    const est = estValue(i);
    if (!est) continue;
    const unitNow = toTwd(est.amount, est.currency, rate);
    const unitDiff = unitNow - unitBase;
    if (unitDiff === 0) continue;
    movers.push({
      id: i.id,
      name: i.name,
      setName: i.setName,
      imageUrl: i.imageUrl,
      quantity: i.quantity,
      diff: unitDiff * i.quantity,
      base: unitBase * i.quantity,
      pct: (unitDiff / unitBase) * 100,
    });
  }

  // Calendar days between the baseline day and today, NOT elapsed hours — the UI
  // renders this as "近 N 日", and a baseline 8 days ago read at noon must not
  // round up to 9.
  const elapsed = Math.max(
    1,
    Math.round(
      (new Date(`${isoDay(now)}T00:00:00`).getTime() - new Date(`${baselineDate}T00:00:00`).getTime())
        / 86_400_000,
    ),
  );
  return { baselineDate, days: elapsed, movers: rankMovers(movers, limit) };
}
