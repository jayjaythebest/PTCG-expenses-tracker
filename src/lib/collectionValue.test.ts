import { describe, it, expect } from 'vitest';
import { toTwd, estValue, totalCurrentTwd, totalPnlTwd } from './collectionValue';
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
