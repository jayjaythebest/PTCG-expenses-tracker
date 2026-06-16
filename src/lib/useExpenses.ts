import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { Expense, ExpenseStatus, PaymentStatus } from '../types';

let channelCounter = 0;

function mapRow(row: Record<string, unknown>): Expense {
  return {
    id:                row.id as string,
    title:             row.title as string,
    category:          row.category as string,
    amount:            row.amount as number,
    quantity:          (row.quantity as number | null) ?? 1,
    quantityUnit:      (row.quantity_unit as string | null) ?? '盒',
    type:              row.type as Expense['type'],
    date:              row.date as string,
    status:            row.status as ExpenseStatus,
    paymentStatus:     (row.payment_status as PaymentStatus | null) ?? 'paid',
    submittedBy:       row.submitted_by as string,
    submittedByName:   row.submitted_by_name as string,
    notes:             row.notes as string | undefined,
    seriesTag:         row.series_tag as string | undefined,
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
      .order('date', { ascending: false })
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
      quantity:           expense.quantity ?? 1,
      quantity_unit:      expense.quantityUnit ?? '盒',
      type:               expense.type,
      date:               expense.date,
      payment_status:     expense.paymentStatus ?? 'paid',
      notes:              expense.notes ?? null,
      series_tag:         expense.seriesTag ?? null,
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

  const uploadExpenseImage = async (id: string, file: File) => {
    const ext = file.name.split('.').pop();
    const path = `${Date.now()}.${ext}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from('receipts')
      .upload(path, file, { upsert: false });

    if (uploadError) throw uploadError;

    const { data: urlData } = supabase.storage
      .from('receipts')
      .getPublicUrl(uploadData.path);

    const { error } = await supabase
      .from('expenses')
      .update({ image_url: urlData.publicUrl })
      .eq('id', id);

    if (error) throw error;
  };

  const updateExpense = async (id: string, updates: {
    title?: string;
    amount?: number;
    quantity?: number;
    quantityUnit?: string;
    category?: string;
    type?: Expense['type'];
    date?: string;
    notes?: string;
    seriesTag?: string | null;
    paymentStatus?: PaymentStatus;
  }) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.title !== undefined)        dbUpdates.title = updates.title;
    if (updates.amount !== undefined)       dbUpdates.amount = updates.amount;
    if (updates.quantity !== undefined)     dbUpdates.quantity = updates.quantity;
    if (updates.quantityUnit !== undefined) dbUpdates.quantity_unit = updates.quantityUnit;
    if (updates.category !== undefined)     dbUpdates.category = updates.category;
    if (updates.type !== undefined)         dbUpdates.type = updates.type;
    if (updates.date !== undefined)         dbUpdates.date = updates.date;
    if (updates.notes !== undefined)        dbUpdates.notes = updates.notes || null;
    if ('seriesTag' in updates)             dbUpdates.series_tag = updates.seriesTag ?? null;
    if (updates.paymentStatus !== undefined) dbUpdates.payment_status = updates.paymentStatus;
    const { error } = await supabase.from('expenses').update(dbUpdates).eq('id', id);
    if (error) throw error;
  };

  const deleteExpense = async (id: string) => {
    const { error } = await supabase.from('expenses').delete().eq('id', id);
    if (error) throw error;
  };

  return { expenses, loading, addExpense, updateExpense, updateExpenseStatus, uploadExpenseImage, deleteExpense };
}
