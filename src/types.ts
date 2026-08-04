export type UserRole = 'brother' | 'sponsor';

// Card edition / print language. 'en' reserved for future use.
export type CardEdition = 'ja' | 'zh-tw' | 'en';

// Grading / certification company for graded (鑑定) cards.
export type GradingCompany = 'psa' | 'bgs' | 'other';

// Only single cards and sealed boxes are tracked. Legacy rows may still carry
// the retired 'pack' value; the UI falls back to treating those as a box.
export type CollectionItemType = 'single' | 'box';
export type CollectionCondition = 'mint' | 'nm' | 'lp' | 'mp';

export interface CollectionItem {
  id: string;
  name: string;
  setName: string;
  series: string;
  cardNumber?: string;
  rarity?: string;
  itemType: CollectionItemType;
  condition?: CollectionCondition;
  quantity: number;
  // Date the item was acquired (ISO 'YYYY-MM-DD'), editable by the user. Distinct
  // from createdAt (the auto row-insertion timestamp).
  acquiredDate?: string;
  // Kept for backwards-compat with existing rows; no longer surfaced in the UI.
  purchasePrice?: number;
  // The user's own estimate of the card's worth, set when adding (JPY). Serves as
  // the baseline that the auto-fetched marketPrice is compared against for P&L.
  currentValue?: number;
  notes?: string;
  imageUrl?: string;
  edition?: CardEdition;
  // Grading / 鑑定. When isGraded is true, the grade replaces the raw condition.
  isGraded?: boolean;
  gradingCompany?: GradingCompany;
  grade?: string;        // e.g. '10', '9.5' — text to allow BGS half-points
  gradingCert?: string;  // cert / serial number
  // Market price, auto-fetched from a price source (Huca for ja, etc.). Stored
  // in the source's native currency; the UI converts to TWD for display. This
  // is distinct from `currentValue`, which is a manual override the user types.
  marketPrice?: number;
  marketPriceCurrency?: string;  // 'JPY' | 'TWD'
  marketPriceSource?: string;    // 'huca' | 'kapaipai' | …
  marketPriceUpdatedAt?: string; // ISO timestamp of the last successful fetch
  marketPriceCondition?: string; // normalised condition of the priced row: raw 'A'/'B'/… or graded 'PSA10'
  // Soft-delete tombstone. Null/absent = active; an ISO timestamp = in the
  // "已刪除" graveyard, hidden from the gallery but restorable. Lets a user undo
  // an accidental delete instead of losing the row (and its price history).
  deletedAt?: string;
  // Whose card this is — a COLLECTION_OWNERS id (src/data/collectionOwners.ts).
  // The account is shared, so this only keeps collections and their totals
  // apart; it grants nothing and restricts nothing. Absent on rows written
  // before the column existed, which belong to PRIMARY_OWNER — read it through
  // ownerOf() rather than directly, so those rows aren't dropped.
  owner?: string;
  createdAt: string;
}

// One daily snapshot of the whole collection's market value (stock-ticker
// style), so the home screen can show week-over-week change. One row per day,
// keyed by date; written by the daily cron and refreshed client-side on load.
export interface CollectionValueSnapshot {
  date: string;      // ISO 'YYYY-MM-DD'
  totalTwd: number;  // total current market value that day, in TWD
  itemCount: number; // total quantity of cards that day
}

// One card's recorded value on one day. `unitTwd` is per copy (quantity is NOT
// baked in) so that buying a second copy of a card never reads as a price rise.
export interface ItemPricePoint {
  itemId: string;
  date: string;    // ISO 'YYYY-MM-DD'
  unitTwd: number; // that day's per-card value in TWD
  price: number;   // the untouched source figure…
  currency: string; // …in this currency ('JPY' | 'TWD')
}

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export type ExpenseCategory = 'Card' | 'Box' | 'Tournament' | 'Other';
export type ExpenseStatus = 'Pending' | 'Approved' | 'Rejected';

export type ExpenseType = 'Expense' | 'Income';

// 'paid' = Jay 已付；'pending' = 待報銷
export type PaymentStatus = 'paid' | 'pending';

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory | string;
  amount: number;
  quantity: number;
  quantityUnit: string;
  type: ExpenseType;
  date: string;
  status: ExpenseStatus;
  paymentStatus: PaymentStatus;
  submittedBy: string;
  submittedByName: string;
  notes?: string;
  seriesTag?: string;
  imageUrl?: string;
  createdAt: string;
}
