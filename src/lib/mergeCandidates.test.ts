import { describe, it, expect } from 'vitest';
import { findMergeCandidates, collectorKey, type IncomingItem } from './mergeCandidates';
import type { CollectionItem } from '../types';

const row = (over: Partial<CollectionItem> = {}): CollectionItem => ({
  id: 'id-1',
  name: '深淵之瞳',
  setName: 'アビスアイ',
  series: '',
  itemType: 'box',
  quantity: 3,
  edition: 'ja',
  createdAt: '2026-08-01T00:00:00Z',
  ...over,
});

const incoming = (over: Partial<IncomingItem> = {}): IncomingItem => {
  const { id: _id, createdAt: _createdAt, ...rest } = row();
  return { ...rest, quantity: 2, ...over };
};

describe('collectorKey', () => {
  it('reads the printed number however it was stored', () => {
    expect(collectorKey('114/083')).toBe('114');
    expect(collectorKey('J m5 117')).toBe('117');
    expect(collectorKey('016')).toBe('16');
    expect(collectorKey(undefined)).toBe('');
  });
});

describe('findMergeCandidates', () => {
  it('finds the box already in the collection', () => {
    const found = findMergeCandidates([row()], incoming());
    expect(found.map(f => f.id)).toEqual(['id-1']);
  });

  it('ignores whitespace differences in the name and set', () => {
    expect(findMergeCandidates([row({ name: '深淵之瞳 ' })], incoming({ name: '深淵之瞳' }))).toHaveLength(1);
  });

  // The user's case: two rows of the same box already exist (×2 and ×3) with
  // different acquisition dates. Both are valid merge targets — the caller lets
  // the user pick, so neither may be silently dropped here.
  it('returns every matching row, so the caller can offer a choice', () => {
    const rows = [row({ id: 'a', quantity: 2, acquiredDate: '2026-08-08' }),
                  row({ id: 'b', quantity: 3, acquiredDate: '2026-07-28' })];
    expect(findMergeCandidates(rows, incoming()).map(r => r.id)).toEqual(['a', 'b']);
  });

  it('treats a legacy "pack" row as the box it is displayed as', () => {
    expect(findMergeCandidates([row({ itemType: 'pack' as CollectionItem['itemType'] })], incoming())).toHaveLength(1);
  });

  it('matches a single on its collector number, zero-padding aside', () => {
    const card = row({ itemType: 'single', name: 'カイオーガ', cardNumber: '080/076' });
    expect(findMergeCandidates([card], incoming({ itemType: 'single', name: 'カイオーガ', cardNumber: '80' }))).toHaveLength(1);
  });

  it('does not merge two different cards from the same set', () => {
    const card = row({ itemType: 'single', name: 'カイオーガ', cardNumber: '080/076' });
    expect(findMergeCandidates([card], incoming({ itemType: 'single', name: 'ライコウex', cardNumber: '108/076' }))).toEqual([]);
  });

  // A 日文版 box and a 繁中版 box are different products at different prices.
  it('does not merge across editions', () => {
    expect(findMergeCandidates([row({ edition: 'ja' })], incoming({ edition: 'zh-tw' }))).toEqual([]);
  });

  it('does not merge across sets or item types', () => {
    expect(findMergeCandidates([row({ setName: 'メガブレイブ' })], incoming())).toEqual([]);
    expect(findMergeCandidates([row()], incoming({ itemType: 'single' }))).toEqual([]);
  });

  it('does not merge cards recorded in different conditions', () => {
    const a = row({ itemType: 'single', condition: 'mint', cardNumber: '1' });
    expect(findMergeCandidates([a], incoming({ itemType: 'single', condition: 'lp', cardNumber: '1' }))).toEqual([]);
  });

  // A slab is one physical object carrying its own cert number; two PSA 10s are
  // two rows, and folding them together would leave one cert describing both.
  it('never merges graded slabs', () => {
    const slab = row({ itemType: 'single', isGraded: true, grade: '10', gradingCert: '134848377' });
    expect(findMergeCandidates([slab], incoming({ itemType: 'single', isGraded: true, grade: '10' }))).toEqual([]);
    expect(findMergeCandidates([slab], incoming({ itemType: 'single' }))).toEqual([]);
    expect(findMergeCandidates([row({ itemType: 'single' })], incoming({ itemType: 'single', isGraded: true }))).toEqual([]);
  });

  it('ignores rows already in the deleted graveyard', () => {
    expect(findMergeCandidates([row({ deletedAt: '2026-08-01T00:00:00Z' })], incoming())).toEqual([]);
  });

  it('suggests nothing when the incoming item has no name to match on', () => {
    expect(findMergeCandidates([row()], incoming({ name: '' }))).toEqual([]);
  });
});
