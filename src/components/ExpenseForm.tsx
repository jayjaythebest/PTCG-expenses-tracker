import { useState, useRef } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { ExpenseCategory, ExpenseType } from '../types';
import { PlusCircle, Loader2, Camera, X, Minus, Plus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export function ExpenseForm() {
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
    if (file) {
      if (file.size > 5 * 1024 * 1024) {
        alert('圖片太大了，請選擇小於 5MB 的圖片');
        return;
      }
      const preview = URL.createObjectURL(file);
      setImage({ file, preview });
    }
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
      setTitle('');
      setAmount('');
      setCustomCategory('');
      setNotes('');
      if (image) URL.revokeObjectURL(image.preview);
      setImage(null);
    } catch (error) {
      console.error(error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="poke-card p-5 sm:p-6 shadow-md">
      <h2 className="text-xl font-bold mb-5 flex items-center gap-2 text-poke-dark-blue">
        <PlusCircle className="w-6 h-6" />
        新增記錄
      </h2>

      {/* Type Toggle */}
      <div className="flex p-1 bg-slate-100 rounded-xl mb-6">
        <button
          type="button"
          onClick={() => setType('Expense')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all",
            type === 'Expense'
              ? "bg-white text-slate-700 shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Minus className="w-4 h-4" />
          支出
        </button>
        <button
          type="button"
          onClick={() => setType('Income')}
          className={cn(
            "flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all",
            type === 'Income'
              ? "bg-white text-poke-blue shadow-sm"
              : "text-slate-500 hover:text-slate-700"
          )}
        >
          <Plus className="w-4 h-4" />
          收入 (賣出)
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-5">
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1.5">項目名稱</label>
          <input
            type="text"
            className="poke-input text-base"
            placeholder={type === 'Expense' ? "例如：VSTAR Universe 擴充包" : "例如：賣出 噴火龍 VMAX"}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">金額 (¥)</label>
            <input
              type="number"
              inputMode="numeric"
              className="poke-input text-base"
              placeholder="5500"
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">類別</label>
            <select
              className="poke-input text-base appearance-none"
              value={category === 'Card' || category === 'Box' || category === 'Tournament' ? category : 'Other'}
              onChange={(e) => {
                const val = e.target.value as any;
                setCategory(val);
                if (val !== 'Other') setCustomCategory('');
              }}
            >
              <option value="Card">單張卡片</option>
              <option value="Box">整盒/擴充包</option>
              <option value="Tournament">賽事報名費</option>
              <option value="Other">其他</option>
            </select>
          </div>
        </div>

        <AnimatePresence>
          {category === 'Other' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <label className="block text-sm font-bold text-slate-700 mb-1.5">自定義類別</label>
              <input
                type="text"
                className="poke-input text-base"
                placeholder="例如：卡套、卡冊"
                value={customCategory}
                onChange={(e) => setCustomCategory(e.target.value)}
                required
              />
            </motion.div>
          )}
        </AnimatePresence>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1.5">日期</label>
          <input
            type="date"
            className="poke-input text-base"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            required
          />
        </div>

        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1.5">上傳圖片 (選填)</label>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-slate-100 text-slate-600 rounded-xl hover:bg-slate-200 transition-colors font-bold text-sm"
            >
              <Camera className="w-5 h-5" />
              拍照或選圖
            </button>
            <input
              type="file"
              ref={fileInputRef}
              onChange={handleImageChange}
              accept="image/*"
              className="hidden"
            />
            {image && (
              <div className="relative w-12 h-12 flex-shrink-0">
                <img src={image.preview} alt="Preview" className="w-full h-full object-cover rounded-lg border-2 border-poke-blue" />
                <button
                  type="button"
                  onClick={() => { URL.revokeObjectURL(image.preview); setImage(null); }}
                  className="absolute -top-2 -right-2 bg-slate-400 text-white rounded-full p-0.5 shadow-md"
                >
                  <X className="w-3 h-3" />
                </button>
              </div>
            )}
          </div>
        </div>

        <button
          type="submit"
          disabled={loading}
          className={cn(
            "w-full py-4 rounded-xl font-black text-lg shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98]",
            type === 'Expense' ? "bg-slate-700 text-white shadow-slate-500/20" : "bg-poke-blue text-white shadow-poke-blue/20"
          )}
        >
          {loading ? <Loader2 className="w-6 h-6 animate-spin" /> : `提交${type === 'Expense' ? '支出' : '收入'}`}
        </button>
      </form>
    </div>
  );
}
