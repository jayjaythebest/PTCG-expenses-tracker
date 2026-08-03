import { describe, it, expect } from 'vitest';
import { toTwd, estValue, totalCurrentTwd, totalPnlTwd, topMoversTwd } from './collectionValue';
import { CollectionItem } from '../types';

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

  it('compares a TWD-priced card against the JPY baseline correctly', () => {
    // 300 TWD market vs 1000 JPY (= 200 TWD) base → +50%.
    const [m] = topMoversTwd(
      [item({ marketPrice: 300, marketPriceCurrency: 'TWD', currentValue: 1000 })],
      0.2,
    );
    expect(m.diff).toBe(100);
    expect(m.pct).toBeCloseTo(50);
  });
});
