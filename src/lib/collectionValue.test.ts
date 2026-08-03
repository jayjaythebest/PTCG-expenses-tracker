import { describe, it, expect } from 'vitest';
import {
  toTwd, estValue, totalCurrentTwd, totalPnlTwd,
  topMoversTwd, topMoversByHistory, moverBaselineDate,
} from './collectionValue';
import { CollectionItem, ItemPricePoint } from '../types';

// Build a minimal CollectionItem for tests, overriding only what matters.
function item(overrides: Partial<CollectionItem>): CollectionItem {
  return {
    id: 'x',
    name: 'card',
    setName: '',
    series: '',
    itemType: 'single',
    quantity: 1,
    createdAt: '2026-01-01',
    ...overrides,
  };
}

describe('toTwd', () => {
  it('multiplies JPY by the rate', () => {
    expect(toTwd(1000, 'JPY', 0.2)).toBe(200);
  });
  it('keeps TWD amounts as-is (rounded)', () => {
    expect(toTwd(150.4, 'TWD', 0.2)).toBe(150);
  });
});

describe('estValue', () => {
  it('prefers market price in its own currency', () => {
    expect(estValue(item({ marketPrice: 500, marketPriceCurrency: 'JPY', currentValue: 999 })))
      .toEqual({ amount: 500, currency: 'JPY' });
  });
  it('honours a TWD market currency', () => {
    expect(estValue(item({ marketPrice: 500, marketPriceCurrency: 'TWD' })))
      .toEqual({ amount: 500, currency: 'TWD' });
  });
  it('falls back to the manual estimate (JPY)', () => {
    expect(estValue(item({ currentValue: 999 }))).toEqual({ amount: 999, currency: 'JPY' });
  });
  it('returns null when neither is present', () => {
    expect(estValue(item({}))).toBeNull();
  });
});

describe('totalCurrentTwd', () => {
  it('sums quantity-aware values across currencies', () => {
    const items = [
      item({ marketPrice: 1000, marketPriceCurrency: 'JPY', quantity: 2 }), // 200 * 2 = 400
      item({ marketPrice: 300, marketPriceCurrency: 'TWD', quantity: 1 }),   // 300
      item({ currentValue: 500, quantity: 1 }),                              // 100
    ];
    expect(totalCurrentTwd(items, 0.2)).toBe(800);
  });
});

describe('totalPnlTwd', () => {
  it('measures market vs. manual estimate over items with both', () => {
    const items = [
      item({ marketPrice: 1500, marketPriceCurrency: 'JPY', currentValue: 1000 }), // market 300, base 200 → diff 100
      item({ marketPrice: 800, marketPriceCurrency: 'JPY' }),                        // skipped (no base)
    ];
    const r = totalPnlTwd(items, 0.2);
    expect(r.diff).toBe(100);
    expect(r.base).toBe(200);
    expect(r.pct).toBeCloseTo(50);
  });
});

describe('topMoversTwd', () => {
  it('ranks by the size of the swing, biggest first, gains and losses mixed', () => {
    const items = [
      item({ id: 'a', marketPrice: 1100, marketPriceCurrency: 'JPY', currentValue: 1000 }), // +10%
      item({ id: 'b', marketPrice: 300, marketPriceCurrency: 'JPY', currentValue: 1000 }),  // −70%
      item({ id: 'c', marketPrice: 1500, marketPriceCurrency: 'JPY', currentValue: 1000 }), // +50%
    ];
    expect(topMoversTwd(items, 0.2, 3).map(m => m.id)).toEqual(['b', 'c', 'a']);
  });

  it('honours the limit', () => {
    const items = [
      item({ id: 'a', marketPrice: 2000, marketPriceCurrency: 'JPY', currentValue: 1000 }),
      item({ id: 'b', marketPrice: 1500, marketPriceCurrency: 'JPY', currentValue: 1000 }),
      item({ id: 'c', marketPrice: 1200, marketPriceCurrency: 'JPY', currentValue: 1000 }),
    ];
    expect(topMoversTwd(items, 0.2, 2).map(m => m.id)).toEqual(['a', 'b']);
  });

  it('reports quantity-aware money but quantity-independent percent', () => {
    // 1500 JPY market vs 1000 JPY base → 300 vs 200 TWD per card, ×3 cards.
    const [m] = topMoversTwd(
      [item({ marketPrice: 1500, marketPriceCurrency: 'JPY', currentValue: 1000, quantity: 3 })],
      0.2,
    );
    expect(m.diff).toBe(300);
    expect(m.base).toBe(600);
    expect(m.pct).toBeCloseTo(50);
  });

  it('breaks percentage ties on the money involved', () => {
    const items = [
      item({ id: 'cheap', marketPrice: 110, marketPriceCurrency: 'JPY', currentValue: 100 }),
      item({ id: 'pricey', marketPrice: 11000, marketPriceCurrency: 'JPY', currentValue: 10000 }),
    ];
    expect(topMoversTwd(items, 0.2, 2).map(m => m.id)).toEqual(['pricey', 'cheap']);
  });

  it('skips cards without a baseline, and ones that have not moved', () => {
    const items = [
      item({ id: 'no-base', marketPrice: 900, marketPriceCurrency: 'JPY' }),
      item({ id: 'no-market', currentValue: 900 }),
      item({ id: 'zero-base', marketPrice: 900, marketPriceCurrency: 'JPY', currentValue: 0 }),
      item({ id: 'flat', marketPrice: 1000, marketPriceCurrency: 'JPY', currentValue: 1000 }),
    ];
    expect(topMoversTwd(items, 0.2, 3)).toEqual([]);
  });

  it('compares a TWD-priced card against the JPY estimate correctly', () => {
    // 300 TWD market vs 1000 JPY (= 200 TWD) base → +50%.
    const [m] = topMoversTwd(
      [item({ marketPrice: 300, marketPriceCurrency: 'TWD', currentValue: 1000 })],
      0.2,
    );
    expect(m.diff).toBe(100);
    expect(m.pct).toBeCloseTo(50);
  });
});

// A fixed "now" keeps these deterministic; helpers below express dates relative
// to it the way the real data does.
const NOW = new Date('2026-08-10T12:00:00');

function daysBefore(n: number): string {
  const d = new Date(NOW.getTime() - n * 86_400_000);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function point(itemId: string, daysAgo: number, unitTwd: number): ItemPricePoint {
  return { itemId, date: daysBefore(daysAgo), unitTwd, price: unitTwd * 5, currency: 'JPY' };
}

describe('moverBaselineDate', () => {
  it('picks the newest day at least `days` back', () => {
    const pts = [point('a', 20, 100), point('a', 9, 100), point('a', 3, 100)];
    expect(moverBaselineDate(pts, 7, NOW)).toBe(daysBefore(9));
  });

  it('falls back to the oldest day when history is younger than the window', () => {
    const pts = [point('a', 3, 100), point('a', 1, 100)];
    expect(moverBaselineDate(pts, 7, NOW)).toBe(daysBefore(3));
  });

  it('returns null when only today has been recorded', () => {
    expect(moverBaselineDate([point('a', 0, 100)], 7, NOW)).toBeNull();
  });

  it('returns null with no history at all', () => {
    expect(moverBaselineDate([], 7, NOW)).toBeNull();
  });
});

describe('topMoversByHistory', () => {
  it('measures each card against its recorded value on one shared baseline day', () => {
    const items = [
      item({ id: 'a', marketPrice: 1500, marketPriceCurrency: 'JPY' }), // now 300 TWD
      item({ id: 'b', marketPrice: 1000, marketPriceCurrency: 'JPY' }), // now 200 TWD
    ];
    const pts = [point('a', 8, 200), point('b', 8, 500)];
    const w = topMoversByHistory(items, pts, 0.2, { now: NOW })!;

    expect(w.baselineDate).toBe(daysBefore(8));
    expect(w.days).toBe(8);
    // a: 200 → 300 = +50%; b: 500 → 200 = −60%, so b leads on swing size.
    expect(w.movers.map(m => m.id)).toEqual(['b', 'a']);
    expect(w.movers[0].pct).toBeCloseTo(-60);
    expect(w.movers[1].diff).toBe(100);
  });

  it('ignores cards with no row on the baseline day (bought after we started watching)', () => {
    const items = [
      item({ id: 'old', marketPrice: 1500, marketPriceCurrency: 'JPY' }),
      item({ id: 'new', marketPrice: 5000, marketPriceCurrency: 'JPY' }),
    ];
    const pts = [point('old', 8, 200), point('new', 0, 1000)];
    const w = topMoversByHistory(items, pts, 0.2, { now: NOW })!;
    expect(w.movers.map(m => m.id)).toEqual(['old']);
  });

  it('scales money by quantity but leaves the percentage per-card', () => {
    const items = [item({ id: 'a', marketPrice: 1500, marketPriceCurrency: 'JPY', quantity: 4 })];
    const w = topMoversByHistory(items, [point('a', 8, 200)], 0.2, { now: NOW })!;
    expect(w.movers[0].diff).toBe(400); // (300 − 200) × 4
    expect(w.movers[0].pct).toBeCloseTo(50);
  });

  it('returns null when history is too young to compare', () => {
    const items = [item({ id: 'a', marketPrice: 1500, marketPriceCurrency: 'JPY' })];
    expect(topMoversByHistory(items, [point('a', 0, 200)], 0.2, { now: NOW })).toBeNull();
    expect(topMoversByHistory(items, [], 0.2, { now: NOW })).toBeNull();
  });

  it('omits cards whose price has not budged', () => {
    const items = [item({ id: 'a', marketPrice: 1000, marketPriceCurrency: 'JPY' })];
    const w = topMoversByHistory(items, [point('a', 8, 200)], 0.2, { now: NOW })!;
    expect(w.movers).toEqual([]);
  });

  it('uses the manual estimate as "now" when a card has no market price', () => {
    const items = [item({ id: 'a', currentValue: 2000 })]; // 400 TWD now
    const w = topMoversByHistory(items, [point('a', 8, 200)], 0.2, { now: NOW })!;
    expect(w.movers[0].pct).toBeCloseTo(100);
  });
});
