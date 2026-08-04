// Whose cards are these?
//
// The app is one Supabase account shared by more than one collector — a friend
// logs in with the same credentials and files their cards under their own tab.
// So `owner` is NOT an auth boundary and must never be used as one: everyone
// signed in can see and edit every tab. It exists to keep the collections, and
// the totals computed from them, from being added together.
//
// Adding a person is a one-line change here. Their id is written into
// collection_items.owner, so it must stay stable once cards exist under it —
// renaming an id orphans every card filed under the old one.

export interface CollectionOwner {
  id: string;
  label: string;
}

export const COLLECTION_OWNERS: CollectionOwner[] = [
  { id: 'jay',  label: '我' },
  { id: 'ting', label: 'Ting' },
];

// The account holder. Load-bearing in two places that must NOT mix collections:
//
//   * Home (the summary page) reports this person's cards only — their value,
//     count, P&L and movers. A friend's cards appearing there would silently
//     restate the owner's net worth.
//   * api/snapshot-collection.ts writes ONE row per day into
//     collection_value_snapshots, keyed by date alone. That row is the history
//     the value chart is drawn from, so it has to mean one specific person's
//     collection or the trend line becomes meaningless — and, because the key
//     has no owner in it, unrecoverably so.
//
// This is also the DB default for collection_items.owner, so rows written
// before the column existed already belong to this id.
export const PRIMARY_OWNER = 'jay';

export function ownerLabel(id: string | undefined): string {
  if (!id) return COLLECTION_OWNERS[0].label;
  return COLLECTION_OWNERS.find(o => o.id === id)?.label ?? id;
}

// Cards written before the owner column existed, or by a build that didn't know
// about it, come back with owner null/undefined. Treat those as the account
// holder's — that is what they were.
export function ownerOf(item: { owner?: string }): string {
  return item.owner || PRIMARY_OWNER;
}
