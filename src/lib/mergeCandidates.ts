import type { CollectionItem, CollectionItemType } from '../types';

// Adding something the collection already holds should raise that row's quantity
// (3 boxes + 2 more = 5), not leave two rows of the same product sitting next to
// each other — which is how 深淵之瞳 ended up listed twice, ×2 and ×3.
//
// This module only decides WHICH existing rows are the same thing as the one
// being added. Whether to merge is the user's call: the caller shows the
// candidates and the user picks "merge into this one" or "keep it separate".
// Nothing here writes anything.

export type IncomingItem = Omit<CollectionItem, 'id' | 'createdAt'>;

// Legacy rows may carry the retired 'pack' type, which the gallery shows as a
// box — so a 'pack' row and a 'box' row are the same kind of thing.
const kind = (t: CollectionItemType | string): CollectionItemType => (t === 'single' ? 'single' : 'box');

// Names are free text the user typed or a scan filled in: 「深淵之瞳」,
// 「深淵之瞳 」 and 「超級噴火龍X ex」/「超級噴火龍Xex」 are one product.
const textKey = (s?: string): string => (s ?? '').replace(/\s+/g, '').toLowerCase();

// Old rows predate the edition column; the DB defaults new ones to 'ja'.
const editionKey = (e?: string): string => e || 'ja';

// The printed collector number, however it happens to be stored.
// "114/083" → "114"; "J m5 117" → "117"; "016" → "16"; "" → "".
// Mirrors extractNumber in api/_lib/pricing.ts: the part before the slash, and
// within it the LAST run of digits, so a set-code prefix ("m5") isn't mistaken
// for the number. A stored 「J m5 117」 and a typed 「117」 are the same card.
export function collectorKey(raw?: string): string {
  const head = String(raw ?? '').split('/')[0];
  const groups = head.match(/\d+/g);
  const n = groups?.[groups.length - 1] ?? '';
  return n.replace(/^0+(?=\d)/, '');
}

// Existing rows in the collection that hold the very same item as `incoming`.
//
// Deliberately strict — the prompt it feeds says "完全相同", so a near-miss must
// come back empty rather than invite the user to fold two different things into
// one row. Beyond name/set/number it also requires the same edition (a 日文版
// and a 繁中版 box are different products) and the same condition.
//
// Graded cards never match: a slab is one specific physical object with its own
// cert number, so two of them are two rows, not a quantity of two.
export function findMergeCandidates(existing: CollectionItem[], incoming: IncomingItem): CollectionItem[] {
  if (incoming.isGraded) return [];
  const type = kind(incoming.itemType);
  const name = textKey(incoming.name);
  if (!name) return [];

  return existing.filter(row =>
    !row.deletedAt &&
    !row.isGraded &&
    kind(row.itemType) === type &&
    textKey(row.name) === name &&
    textKey(row.setName) === textKey(incoming.setName) &&
    editionKey(row.edition) === editionKey(incoming.edition) &&
    // A card is pinned down by its collector number; a sealed box has none.
    (type === 'box' || collectorKey(row.cardNumber) === collectorKey(incoming.cardNumber)) &&
    (row.condition ?? '') === (incoming.condition ?? ''));
}
