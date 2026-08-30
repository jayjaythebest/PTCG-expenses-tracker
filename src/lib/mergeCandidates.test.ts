import { describe, it, expect } from 'vitest';
import { findMergeCandidates, findDuplicateGroups, planMerge, collectorKey, type IncomingItem } from './mergeCandidates';
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

describe('findDuplicateGroups', () => {
  // The case that prompted this: 深淵之瞳 sitting in the gallery twice, ×2 and
  // ×3, added ten days apart and each carrying its own snkrdunk price.
  const pair = [
    row({ id: 'a', quantity: 2, acquiredDate: '2026-08-08' }),
    row({ id: 'b', quantity: 3, acquiredDate: '2026-07-28' }),
  ];

  it('finds the same box listed twice', () => {
    const groups = findDuplicateGroups(pair);
    expect(groups).toHaveLength(1);
    expect(groups[0].map(i => i.id).sort()).toEqual(['a', 'b']);
  });

  it('leaves a row that is not duplicated alone', () => {
    expect(findDuplicateGroups([row({ id: 'a' }), row({ id: 'b', name: '別的東西' })])).toEqual([]);
  });

  it('does not group two different cards from the same set', () => {
    const rows = [
      row({ id: 'a', itemType: 'single', name: 'カイオーガ', cardNumber: '080/076' }),
      row({ id: 'b', itemType: 'single', name: 'カイオーガ', cardNumber: '081/076' }),
    ];
    expect(findDuplicateGroups(rows)).toEqual([]);
  });

  it('never groups graded slabs — each one is its own physical object', () => {
    const rows = [
      row({ id: 'a', isGraded: true, gradingCompany: 'psa', grade: '10', gradingCert: '111' }),
      row({ id: 'b', isGraded: true, gradingCompany: 'psa', grade: '10', gradingCert: '222' }),
    ];
    expect(findDuplicateGroups(rows)).toEqual([]);
  });

  it('keeps two collectors owning the same box apart', () => {
    const rows = [row({ id: 'a', owner: 'jay' }), row({ id: 'b', owner: 'ting' })];
    expect(findDuplicateGroups(rows)).toEqual([]);
  });

  // A row with no owner predates the column and belongs to the account holder,
  // so it duplicates that person's row — not nobody's.
  it('treats an owner-less row as the account holder\'s', () => {
    const rows = [row({ id: 'a', owner: undefined }), row({ id: 'b', owner: 'jay' })];
    expect(findDuplicateGroups(rows)).toHaveLength(1);
  });

  // Merging soft-deletes the extra rows. Counting the graveyard would put the
  // banner straight back up on the row that was just merged away.
  it('ignores soft-deleted rows', () => {
    const rows = [row({ id: 'a' }), row({ id: 'b', deletedAt: '2026-08-30T00:00:00Z' })];
    expect(findDuplicateGroups(rows)).toEqual([]);
  });
});

describe('planMerge', () => {
  const a = row({ id: 'a', quantity: 2, acquiredDate: '2026-08-08' });
  const b = row({ id: 'b', quantity: 3, acquiredDate: '2026-07-28' });

  it('keeps the earliest row and sums the quantities', () => {
    const plan = planMerge([a, b])!;
    expect(plan.keep.id).toBe('b');
    expect(plan.drop.map(i => i.id)).toEqual(['a']);
    expect(plan.quantity).toBe(5);
  });

  it('needs at least two rows', () => {
    expect(planMerge([a])).toBeNull();
  });

  // The two rows only disagree on price because they were fetched a week apart.
  it('takes the freshest price, not the keeper\'s', () => {
    const plan = planMerge([
      { ...a, marketPrice: 8498, marketPriceUpdatedAt: '2026-08-29T20:00:00Z' },
      { ...b, marketPrice: 8799, marketPriceUpdatedAt: '2026-08-22T20:00:00Z' },
    ])!;
    expect(plan.keep.id).toBe('b');
    expect(plan.price?.marketPrice).toBe(8498);
  });

  it('lets a hand-typed price outrank a newer fetch', () => {
    const plan = planMerge([
      { ...a, marketPrice: 8498, marketPriceSource: 'huca', marketPriceUpdatedAt: '2026-08-29T20:00:00Z' },
      { ...b, marketPrice: 9000, marketPriceSource: 'manual', marketPriceUpdatedAt: '2026-08-01T20:00:00Z' },
    ])!;
    expect(plan.price?.marketPrice).toBe(9000);
    expect(plan.price?.marketPriceSource).toBe('manual');
  });

  it('leaves the price alone when no row has one', () => {
    expect(planMerge([a, b])!.price).toBeUndefined();
  });

  // currentValue is the per-copy P&L baseline, so it has to be averaged over the
  // copies — (8000*2 + 8500*3) / 5.
  it('averages the estimate across the copies', () => {
    const plan = planMerge([{ ...a, currentValue: 8000 }, { ...b, currentValue: 8500 }])!;
    expect(plan.currentValue).toBe(8300);
  });

  it('ignores rows with no estimate when averaging', () => {
    const plan = planMerge([{ ...a, currentValue: 8000 }, b])!;
    expect(plan.currentValue).toBe(8000);
  });

  it('has no estimate to write when nobody recorded one', () => {
    expect(planMerge([a, b])!.currentValue).toBeUndefined();
  });
});
