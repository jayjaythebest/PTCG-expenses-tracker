export type UserRole = 'brother' | 'sponsor';

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
