import type { CollectionItem, CollectionItemType } from '../types';
import { ownerOf } from '../data/collectionOwners';

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

// ---- Duplicates already sitting in the collection ----
// findMergeCandidates only fires while something is being ADDED, so rows that
// were split before it existed (or by a user who chose "另存成新的一筆" and later
// changed their mind) stay split forever — 深淵之瞳 sitting in the gallery as ×2
// and ×3, each carrying its own market price fetched on a different day. The
// gallery needs to be able to find those on its own.

// The identity that makes two rows the same product. Rows sharing it are
// interchangeable copies of one thing. Null = the row can never be folded into
// another: a graded slab is one specific physical object with its own cert, and
// a row with no name isn't identifiable at all.
//
// This is findMergeCandidates' comparison expressed as a key, so the "already in
// the collection" prompt and the duplicate scan below agree by construction.
function identityKey(i: IncomingItem): string | null {
  if (i.isGraded) return null;
  const name = textKey(i.name);
  if (!name) return null;
  const type = kind(i.itemType);
  return [
    type,
    name,
    textKey(i.setName),
    editionKey(i.edition),
    i.condition ?? '',
    // A card is pinned down by its collector number; a sealed box has none.
    type === 'single' ? collectorKey(i.cardNumber) : '',
  ].join('|');
}

// Sets of rows in `items` that are all the same product. Only groups of 2+ come
// back; a lone row is a duplicate of nothing.
//
// Owner is part of the grouping: the account is shared, and two collectors each
// owning the same box own two different boxes. Soft-deleted rows are skipped —
// the graveyard is where merged-away rows land, so counting them would make the
// prompt reappear the moment it was acted on.
export function findDuplicateGroups(items: CollectionItem[]): CollectionItem[][] {
  const groups = new Map<string, CollectionItem[]>();
  for (const i of items) {
    if (i.deletedAt) continue;
    const key = identityKey(i);
    if (!key) continue;
    const full = `${ownerOf(i)}|${key}`;
    const g = groups.get(full);
    if (g) g.push(i);
    else groups.set(full, [i]);
  }
  return [...groups.values()].filter(g => g.length > 1);
}

// Which row survives a merge, and what it ends up holding.
export interface MergePlan {
  keep: CollectionItem;
  drop: CollectionItem[];
  quantity: number;
  // Quantity-weighted average of the per-copy estimates, when any row has one.
  currentValue?: number;
  // The market price the surviving row should carry, when any row has one.
  price?: Pick<CollectionItem,
    'marketPrice' | 'marketPriceCurrency' | 'marketPriceSource' | 'marketPriceUpdatedAt' | 'marketPriceCondition'>;
}

const acquiredAt = (i: CollectionItem): number => new Date(i.acquiredDate ?? i.createdAt).getTime();

// How to fold a duplicate group into one row.
//
// The keeper is the EARLIEST row: 入手日期 should say when this collection first
// got the thing, not when the last copy arrived.
//
// Two fields must not simply be inherited from the keeper:
//   * currentValue is the per-copy P&L baseline — effectively a cost basis — so
//     it is averaged over the copies, weighted by how many each row holds.
//     Keeping only the keeper's would restate the baseline for every copy that
//     came from the other rows.
//   * marketPrice is ONE product's price; the rows disagree only because they
//     were fetched on different days. Take the freshest, so merging can't leave
//     a week-old figure sitting on top of one from this morning. A price the
//     user typed by hand outranks any fetch — that one is a decision, not a
//     reading.
export function planMerge(group: CollectionItem[]): MergePlan | null {
  if (group.length < 2) return null;
  const rows = [...group].sort((a, b) => acquiredAt(a) - acquiredAt(b) || a.id.localeCompare(b.id));
  const [keep, ...drop] = rows;

  const quantity = rows.reduce((s, i) => s + i.quantity, 0);

  const valued = rows.filter(i => i.currentValue != null && i.quantity > 0);
  const valuedQty = valued.reduce((s, i) => s + i.quantity, 0);
  const currentValue = valuedQty > 0
    ? Math.round(valued.reduce((s, i) => s + i.currentValue! * i.quantity, 0) / valuedQty)
    : undefined;

  const freshest = rows
    .filter(i => i.marketPrice != null)
    .sort((a, b) => {
      const manual = Number(b.marketPriceSource === 'manual') - Number(a.marketPriceSource === 'manual');
      return manual !== 0 ? manual : (b.marketPriceUpdatedAt ?? '').localeCompare(a.marketPriceUpdatedAt ?? '');
    })[0];

  return {
    keep,
    drop,
    quantity,
    currentValue,
    price: freshest && {
      marketPrice:          freshest.marketPrice,
      marketPriceCurrency:  freshest.marketPriceCurrency,
      marketPriceSource:    freshest.marketPriceSource,
      marketPriceUpdatedAt: freshest.marketPriceUpdatedAt,
      marketPriceCondition: freshest.marketPriceCondition,
    },
  };
}
