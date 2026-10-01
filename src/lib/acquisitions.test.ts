import { describe, it, expect } from 'vitest';
import { logFor, logTotal, logDrift, planFold, type AcquisitionEntry } from './acquisitions';
import type { CollectionItem } from '../types';

const item = (over: Partial<CollectionItem> = {}): CollectionItem => ({
  id: 'item-1',
  name: '綠寶石風暴',
  setName: 'ストームエメラルダ',
  series: '',
  itemType: 'box',
  quantity: 2,
  acquiredDate: '2026-08-08',
  createdAt: '2026-08-08T10:00:00Z',
  ...over,
});

const entry = (over: Partial<AcquisitionEntry> = {}): AcquisitionEntry => ({
  id: 'e1',
  itemId: 'item-1',
  date: '2026-08-08',
  quantity: 2,
  createdAt: '2026-08-08T10:00:00Z',
  ...over,
});

describe('logFor', () => {
  it('falls back to the item itself when nothing is stored', () => {
    const log = logFor(item(), []);
    expect(log.legacy).toBe(true);
    expect(log.rows).toHaveLength(1);
    expect(log.rows[0]).toMatchObject({ date: '2026-08-08', quantity: 2 });
  });

  it('uses the row-insertion day when the item has no 入手日期', () => {
    const log = logFor(item({ acquiredDate: undefined, createdAt: '2026-03-05T12:00:00' }), undefined);
    expect(log.rows[0].date).toBe('2026-03-05');
  });

  it('lists stored arrivals newest first', () => {
    const log = logFor(item({ quantity: 4 }), [
      entry({ id: 'a', date: '2026-08-08' }),
      entry({ id: 'b', date: '2026-09-20' }),
    ]);
    expect(log.legacy).toBe(false);
    expect(log.rows.map(r => r.id)).toEqual(['b', 'a']);
  });

  it('orders same-day arrivals by when they were entered', () => {
    const log = logFor(item(), [
      entry({ id: 'a', createdAt: '2026-08-08T10:00:00Z' }),
      entry({ id: 'b', createdAt: '2026-08-08T18:00:00Z' }),
    ]);
    expect(log.rows.map(r => r.id)).toEqual(['b', 'a']);
  });

  it('ignores entries belonging to another card', () => {
    const log = logFor(item(), [entry({ id: 'x', itemId: 'item-2' })]);
    expect(log.legacy).toBe(true);
  });
});

describe('logTotal / logDrift', () => {
  it('adds the arrivals up', () => {
    expect(logTotal([entry({ id: 'a', quantity: 2 }), entry({ id: 'b', quantity: 2 })])).toBe(4);
  });

  it('is silent when the ledger matches the row', () => {
    const i = item({ quantity: 4 });
    expect(logDrift(i, logFor(i, [entry({ id: 'a', quantity: 2 }), entry({ id: 'b', quantity: 2 })]))).toBe(0);
  });

  it('reports a quantity edited out from under the ledger', () => {
    const i = item({ quantity: 5 });
    expect(logDrift(i, logFor(i, [entry({ id: 'a', quantity: 2 }), entry({ id: 'b', quantity: 2 })]))).toBe(-1);
  });

  it('never reports drift against a synthesised log', () => {
    const i = item({ quantity: 9 });
    expect(logDrift(i, logFor(i, []))).toBe(0);
  });
});

describe('planFold', () => {
  const keep = item({ id: 'keep', quantity: 2, acquiredDate: '2026-08-08' });
  const drop = item({ id: 'drop', quantity: 3, acquiredDate: '2026-09-20' });

  it('hands the dropped rows\' entries to the keeper and leaves its own alone', () => {
    const plan = planFold([keep, drop], 'keep', {
      keep: [entry({ id: 'k1', itemId: 'keep' })],
      drop: [entry({ id: 'd1', itemId: 'drop' }), entry({ id: 'd2', itemId: 'drop' })],
    });
    expect(plan.move).toEqual(['d1', 'd2']);
    expect(plan.create).toEqual([]);
  });

  it('materialises the arrival of a row that has no stored history', () => {
    const plan = planFold([keep, drop], 'keep', {});
    expect(plan.move).toEqual([]);
    expect(plan.create).toEqual([
      { date: '2026-08-08', quantity: 2 },
      { date: '2026-09-20', quantity: 3 },
    ]);
  });

  it('mixes stored and legacy rows in one group', () => {
    const plan = planFold([keep, drop], 'keep', { drop: [entry({ id: 'd1', itemId: 'drop' })] });
    expect(plan.move).toEqual(['d1']);
    expect(plan.create).toEqual([{ date: '2026-08-08', quantity: 2 }]);
  });

  it('skips a row whose day cannot be read', () => {
    const broken = item({ id: 'broken', acquiredDate: undefined, createdAt: 'nope' });
    expect(planFold([keep, broken], 'keep', {}).create).toEqual([{ date: '2026-08-08', quantity: 2 }]);
  });
});
