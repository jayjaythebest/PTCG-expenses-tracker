import { useState, useRef } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { ExpenseCategory, ExpenseType } from '../types';
import { PlusCircle, Loader2, Camera, X, Minus, Plus, ChevronDown } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { PTCG_PRODUCTS, PtcgProduct } from '../data/ptcg-products';

export function ExpenseForm() {
  const { addExpense } = useExpenses();
  const [loading, setLoading] = useState(false);
  const [type, setType] = useState<ExpenseType>('Expense');
  const [title, setTitle] = useState('');
  const [titleQuery, setTitleQuery] = useState('');
  const [showPicker, setShowPicker] = useState(false);
  const [amount, setAmount] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [category, setCategory] = useState<ExpenseCategory | 'Other'>('Card');
  const [customCategory, setCustomCategory] = useState('');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [notes, setNotes] = useState('');
  const [image, setImage] = useState<{ file: File; preview: string } | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const filteredProducts = PTCG_PRODUCTS.filter(p =>
    titleQuery === '' ||
    p.name.includes(titleQuery) ||
    p.code.toLowerCase().includes(titleQuery.toLowerCase()) ||
    p.series.includes(titleQuery)
  );

  const grouped = filteredProducts.reduce<Record<string, PtcgProduct[]>>((acc, p) => {
    if (!acc[p.series]) acc[p.series] = [];
    acc[p.series].push(p);
    return acc;
  }, {});

  const selectProduct = (p: PtcgProduct) => {
    setTitle(p.name);
    setTitleQuery(p.name);
    setShowPicker(false);
  };

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
          quantity: category === 'Box' ? quantity : 1,
          type,
          category: category === 'Other' ? customCategory : category,
          date: new Date(date).toISOString(),
          notes,
        },
        image?.file,
      );
      setTitle('');
      setTitleQuery('');
      setAmount('');
      setQuantity(1);
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
        {/* Title — product combobox */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1.5">商品名稱</label>
          <div className="relative">
            <input
              type="text"
              className="poke-input text-base pr-9"
              placeholder={type === 'Expense' ? "搜尋商品或自行輸入…" : "例如：賣出 噴火龍 VMAX"}
              value={titleQuery}
              onChange={e => { setTitleQuery(e.target.value); setTitle(e.target.value); }}
              onFocus={() => setShowPicker(true)}
              onBlur={() => setTimeout(() => setShowPicker(false), 150)}
              required
            />
            <ChevronDown className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />

            <AnimatePresence>
              {showPicker && filteredProducts.length > 0 && (
                <motion.div
                  initial={{ opacity: 0, y: -4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={{ duration: 0.12 }}
                  className="absolute z-30 w-full mt-1 bg-white border-2 border-slate-200 rounded-xl shadow-lg overflow-hidden max-h-64 overflow-y-auto"
                >
                  {Object.entries(grouped).map(([series, products]) => (
                    <div key={series}>
                      <div className="px-3 py-1.5 text-[10px] font-black text-slate-400 uppercase tracking-wider bg-slate-50 sticky top-0">
                        {series}
                      </div>
                      {products.map(p => (
                        <button
                          key={`${p.code}-${p.name}`}
                          type="button"
                          onPointerDown={e => e.preventDefault()}
                          onClick={() => selectProduct(p)}
                          className="w-full text-left px-3 py-2.5 hover:bg-poke-blue/5 flex items-center justify-between gap-2 border-b border-slate-50 last:border-0"
                        >
                          <span className="font-bold text-sm text-slate-800">{p.name}</span>
                          <span className="text-[10px] text-slate-400 flex-shrink-0 font-mono">{p.code}</span>
                        </button>
                      ))}
                    </div>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1.5">
            金額 (¥){category === 'Box' ? ' — 每盒單價' : ''}
          </label>
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

        {/* Category */}
        <div>
          <label className="block text-sm font-bold text-slate-700 mb-1.5">類別</label>
          <div className="grid grid-cols-2 gap-2">
            {[
              { value: 'Card', label: '單張卡片' },
              { value: 'Box', label: '整盒/擴充包' },
              { value: 'Tournament', label: '賽事報名費' },
              { value: 'Other', label: '其他' },
            ].map(({ value, label }) => {
              const selected = category === value;
              return (
                <button
                  key={value}
                  type="button"
                  onClick={() => {
                    setCategory(value as ExpenseCategory | 'Other');
                    if (value !== 'Other') setCustomCategory('');
                    if (value !== 'Box') setQuantity(1);
                  }}
                  className={cn(
                    'py-2.5 px-3 rounded-lg border-2 text-sm font-bold transition-all text-center',
                    selected
                      ? 'border-poke-blue bg-poke-blue/10 text-poke-dark-blue'
                      : 'border-slate-200 bg-white text-slate-500 hover:border-slate-300'
                  )}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>

        <AnimatePresence>
          {/* Quantity stepper — Box only */}
          {category === 'Box' && (
            <motion.div
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="overflow-hidden"
            >
              <label className="block text-sm font-bold text-slate-700 mb-1.5">數量 (盒)</label>
              <div className="flex items-center gap-3">
                <button
                  type="button"
                  onClick={() => setQuantity(q => Math.max(1, q - 1))}
                  className="w-10 h-10 rounded-lg border-2 border-slate-200 flex items-center justify-center text-slate-600 hover:border-poke-blue hover:text-poke-blue transition-colors"
                >
                  <Minus className="w-4 h-4" />
                </button>
                <span className="text-xl font-black text-slate-800 w-8 text-center">{quantity}</span>
                <button
                  type="button"
                  onClick={() => setQuantity(q => q + 1)}
                  className="w-10 h-10 rounded-lg border-2 border-slate-200 flex items-center justify-center text-slate-600 hover:border-poke-blue hover:text-poke-blue transition-colors"
                >
                  <Plus className="w-4 h-4" />
                </button>
                {amount && quantity > 1 && (
                  <span className="text-sm text-slate-500 font-bold ml-1">
                    = ¥{(Number(amount) * quantity).toLocaleString()}
                  </span>
                )}
              </div>
            </motion.div>
          )}

          {/* Custom category */}
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
