import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { Expense, ExpenseStatus } from '../types';

let channelCounter = 0;

function mapRow(row: Record<string, unknown>): Expense {
  return {
    id:                row.id as string,
    title:             row.title as string,
    category:          row.category as string,
    amount:            row.amount as number,
    type:              row.type as Expense['type'],
    date:              row.date as string,
    status:            row.status as ExpenseStatus,
    submittedBy:       row.submitted_by as string,
    submittedByName:   row.submitted_by_name as string,
    notes:             row.notes as string | undefined,
    imageUrl:          row.image_url as string | undefined,
    createdAt:         row.created_at as string,
  };
}

export function useExpenses() {
  const [expenses, setExpenses] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const channelName = useRef(`expenses-${++channelCounter}`).current;

  async function fetchExpenses() {
    const { data, error } = await supabase
      .from('expenses')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
    } else {
      setExpenses((data ?? []).map(mapRow));
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchExpenses();

    // Real-time: re-fetch on any change to the expenses table
    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, fetchExpenses)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const addExpense = async (
    expense: Omit<Expense, 'id' | 'status' | 'submittedBy' | 'submittedByName' | 'createdAt' | 'imageUrl'>,
    imageFile?: File,
  ) => {
    let imageUrl: string | undefined;

    if (imageFile) {
      const ext = imageFile.name.split('.').pop();
      const path = `${Date.now()}.${ext}`;

      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('receipts')
        .upload(path, imageFile, { upsert: false });

      if (uploadError) throw uploadError;

      const { data: urlData } = supabase.storage
        .from('receipts')
        .getPublicUrl(uploadData.path);

      imageUrl = urlData.publicUrl;
    }

    const { error } = await supabase.from('expenses').insert({
      title:              expense.title,
      category:           expense.category,
      amount:             expense.amount,
      type:               expense.type,
      date:               expense.date,
      notes:              expense.notes ?? null,
      image_url:          imageUrl ?? null,
      status:             'Approved',
      submitted_by:       'public-user',
      submitted_by_name:  '使用者',
    });

    if (error) throw error;
  };

  const updateExpenseStatus = async (id: string, status: ExpenseStatus) => {
    const { error } = await supabase.from('expenses').update({ status }).eq('id', id);
    if (error) throw error;
  };

  const deleteExpense = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
  };

  return { expenses, loading, addExpense, updateExpenseStatus, deleteExpense };
}
