import { useState, useEffect } from 'react';
import { collection, query, where, orderBy, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp } from 'firebase/firestore';
import { db } from './firebase';
import { Expense, ExpenseCategory, ExpenseStatus } from '../types';
import { useAuth } from './AuthContext';

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // No auth check needed, fetch all expenses
    const q = query(collection(db, 'expenses'), orderBy('createdAt', 'desc'));

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Expense[];
      setExpenses(data);
      setLoading(false);
    }, (error) => {
      console.error("Firestore Error: ", error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const addExpense = async (expense: Omit<Expense, 'id' | 'status' | 'submittedBy' | 'submittedByName' | 'createdAt'>) => {
    const newExpense = {
      ...expense,
      status: 'Approved' as ExpenseStatus,
      submittedBy: 'public-user',
      submittedByName: '使用者',
      createdAt: new Date().toISOString(),
    };

    await addDoc(collection(db, 'expenses'), newExpense);
  };

  const updateExpenseStatus = async (id: string, status: ExpenseStatus) => {
    const docRef = doc(db, 'expenses', id);
    await updateDoc(docRef, { status });
  };

  const deleteExpense = async (id: string) => {
    await deleteDoc(doc(db, 'expenses', id));
  };

  return { expenses, loading, addExpense, updateExpenseStatus, deleteExpense };
}
