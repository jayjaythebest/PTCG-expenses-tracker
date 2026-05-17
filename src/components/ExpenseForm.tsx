import { useState, useRef } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { ExpenseCategory, ExpenseType } from '../types';
import { X, Camera, Loader2, Minus, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

interface Props {
  onClose: () => void;
}

export function ExpenseForm({ onClose }: Props) {
  const { addExpense } = useExpenses();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<ExpenseType>('Expense');
  const [title, setTitle] = useState('');
  const [amount, setAmount] = useState('');
  const [category, setCategory] = useState<ExpenseCategory | 'Other'>('Card');
  const [customCategory, setCustomCategory] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) {
      alert('圖片太大了，請選擇小於 5MB 的圖片');
      return;
    }
    if (image) URL.revokeObjectURL(image.preview);
    setImage({ file, preview: URL.createObjectURL(file) });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title || !amount) return;
    if (category === 'Other' && !customCategory) return;
    setLoading(true);
    try {
      await addExpense(
        {
          title,
          amount: Number(amount),
          type,
          category: category === 'Other' ? customCategory : category,
          date: new Date(date).toISOString(),
          notes,
        },
        image?.file,
      );
      if (image) URL.revokeObjectURL(image.preview);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Sheet */}
      <div className="relative bg-notion-bg rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-notion-border" />
        </div>

        {/* Sheet header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-notion-border">
          <h2 className="font-semibold text-notion-text text-base">新增記錄</h2>
          <button onClick={onClose} className="p-2 -mr-2 text-notion-muted">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Type toggle */}
        <div className="shrink-0 flex gap-2 p-3 border-b border-notion-border">
          <button
            type="button"
            onClick={() => setType('Expense')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all',
              type === 'Expense'
                ? 'bg-notion-text text-white'
                : 'bg-notion-bg2 text-notion-muted'
            )}
          >
            <Minus className="w-3.5 h-3.5" />
            支出
          </button>
          <button
            type="button"
            onClick={() => setType('Income')}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2.5 rounded-xl text-[13px] font-semibold transition-all',
              type === 'Income'
                ? 'bg-poke-blue text-white'
                : 'bg-notion-bg2 text-notion-muted'
            )}
          >
            <Plus className="w-3.5 h-3.5" />
            收入（賣出）
          </button>
        </div>

        {/* Scrollable form */}
        <form
          id="expense-form"
          onSubmit={handleSubmit}
          className="flex-1 overflow-y-auto"
        >
          {/* Big amount field */}
          <div className="px-4 pt-5 pb-4 border-b border-notion-border">
            <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1">
              金額（日圓）
            </label>
            <div className="flex items-baseline gap-1">
              <span className="text-2xl text-notion-muted font-light">¥</span>
              <input
                type="number"
                inputMode="numeric"
                className="flex-1 text-[42px] font-bold text-notion-text bg-transparent outline-none"
                placeholder="0"
                value={amount}
                onChange={e => setAmount(e.target.value)}
                required
                autoFocus
              />
            </div>
          </div>

          {/* Item name */}
          <div className="notion-field">
            <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1.5">
              項目名稱
            </label>
            <input
              type="text"
              placeholder={type === 'Expense' ? '例：VSTAR Universe 擴充包' : '例：賣出 噴火龍 VMAX'}
              value={title}
              onChange={e => setTitle(e.target.value)}
              required
            />
          </div>

          {/* Category */}
          <div className="notion-field">
            <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1.5">
              類別
            </label>
            <select
              value={['Card', 'Box', 'Tournament'].includes(category as string) ? category : 'Other'}
              onChange={e => {
                const v = e.target.value as ExpenseCategory | 'Other';
                setCategory(v);
                if (v !== 'Other') setCustomCategory('');
              }}
              className="w-full bg-transparent text-notion-text text-base outline-none appearance-none"
            >
              <option value="Card">🃏 單張卡片</option>
              <option value="Box">📦 整盒/擴充包</option>
              <option value="Tournament">🏆 賽事報名費</option>
              <option value="Other">📌 其他</option>
            </select>
          </div>

          {/* Custom category */}
          <AnimatePresence>
            {category === 'Other' && (
              <motion.div
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: 'auto', opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                className="overflow-hidden"
              >
                <div className="notion-field">
                  <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1.5">
                    自定義類別
                  </label>
                  <input
                    type="text"
                    placeholder="例：卡套、卡冊"
                    value={customCategory}
                    onChange={e => setCustomCategory(e.target.value)}
                    required
                  />
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Date */}
          <div className="notion-field">
            <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1.5">
              日期
            </label>
            <input
              type="date"
              value={date}
              onChange={e => setDate(e.target.value)}
              required
              className="w-full bg-transparent text-notion-text text-base outline-none"
            />
          </div>

          {/* Notes */}
          <div className="notion-field">
            <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-1.5">
              備註（選填）
            </label>
            <input
              type="text"
              placeholder="可不填"
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {/* Photo */}
          <div className="notion-field border-b-0">
            <label className="block text-[11px] font-semibold text-notion-muted uppercase tracking-widest mb-2">
              收據照片（選填）
            </label>
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-3 py-2 bg-notion-bg2 rounded-lg text-[13px] text-notion-muted font-medium"
              >
                <Camera className="w-4 h-4" />
                {image ? '更換照片' : '拍照或選圖'}
              </button>
              {image && (
                <div className="relative">
                  <img
                    src={image.preview}
                    alt="Preview"
                    className="w-11 h-11 object-cover rounded-lg border border-notion-border"
                  />
                  <button
                    type="button"
                    onClick={() => { URL.revokeObjectURL(image.preview); setImage(null); }}
                    className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-notion-muted text-white rounded-full flex items-center justify-center"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )}
            </div>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
          </div>
        </form>

        {/* Submit */}
        <div className="shrink-0 px-4 pt-3 border-t border-notion-border">
          <button
            type="submit"
            form="expense-form"
            disabled={loading}
            className={cn(
              'w-full py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 transition-all active:scale-[0.98]',
              type === 'Expense'
                ? 'bg-notion-text text-white'
                : 'bg-poke-blue text-white shadow-lg shadow-poke-blue/20'
            )}
          >
            {loading
              ? <Loader2 className="w-5 h-5 animate-spin" />
              : `記錄${type === 'Expense' ? '支出' : '收入'}`
            }
          </button>
          <div className="pb-safe" />
        </div>
      </div>
    </div>
  );
}
