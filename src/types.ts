export type UserRole = 'brother' | 'sponsor';

// Card edition / print language. 'en' reserved for future use.
export type CardEdition = 'ja' | 'zh-tw' | 'en';

// Grading / certification company for graded (鑑定) cards.
export type GradingCompany = 'psa' | 'bgs' | 'other';

export type CollectionItemType = 'single' | 'box' | 'pack';
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
  purchasePrice?: number;
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
  createdAt: string;
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
