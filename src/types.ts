export type UserRole = 'brother' | 'sponsor';

export interface UserProfile {
  uid: string;
  email: string;
  displayName: string;
  role: UserRole;
}

export type ExpenseCategory = 'Card' | 'Box' | 'Tournament' | 'Other';
export type ExpenseStatus = 'Pending' | 'Approved' | 'Rejected';

export type ExpenseType = 'Expense' | 'Income';

export interface Expense {
  id: string;
  title: string;
  category: ExpenseCategory | string;
  amount: number;
  type: ExpenseType;
  date: string;
  status: ExpenseStatus;
  submittedBy: string;
  submittedByName: string;
  notes?: string;
  imageUrl?: string;
  createdAt: string;
}
