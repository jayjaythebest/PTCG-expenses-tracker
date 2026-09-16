import { describe, expect, it } from 'vitest';
import { itemDay, matchesDateFilter, monthCounts } from './collectionDate';

describe('itemDay', () => {
  it('prefers acquiredDate', () => {
    expect(itemDay({ acquiredDate: '2026-09-16', createdAt: '2025-01-01T12:00:00' })).toBe('2026-09-16');
  });
  it('falls back to the local day of createdAt', () => {
    expect(itemDay({ createdAt: '2026-03-05T12:00:00' })).toBe('2026-03-05');
  });
  it('returns empty for an unparseable createdAt', () => {
    expect(itemDay({ createdAt: 'nope' })).toBe('');
  });
});

describe('matchesDateFilter', () => {
  it('matches a month without leaking into a neighbour', () => {
    const f = { kind: 'month', month: '2026-09' } as const;
    expect(matchesDateFilter('2026-09-01', f)).toBe(true);
    expect(matchesDateFilter('2026-09-30', f)).toBe(true);
    expect(matchesDateFilter('2026-10-01', f)).toBe(false);
  });
  it('treats a range as inclusive with open ends', () => {
    expect(matchesDateFilter('2026-09-16', { kind: 'range', from: '2026-09-16', to: '2026-09-16' })).toBe(true);
    expect(matchesDateFilter('2026-09-15', { kind: 'range', from: '2026-09-16', to: '' })).toBe(false);
    expect(matchesDateFilter('2020-01-01', { kind: 'range', from: '', to: '2026-09-16' })).toBe(true);
  });
  it('excludes undated rows once a filter is on', () => {
    expect(matchesDateFilter('', { kind: 'range', from: '', to: '' })).toBe(false);
    expect(matchesDateFilter('', { kind: 'all' })).toBe(true);
  });
});

describe('monthCounts', () => {
  it('groups, counts and sorts newest first', () => {
    expect(monthCounts(['2026-08-01', '2026-09-02', '2026-09-20', ''])).toEqual([
      { month: '2026-09', count: 2 },
      { month: '2026-08', count: 1 },
    ]);
  });
});
