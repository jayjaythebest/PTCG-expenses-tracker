import { useState } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { Expense, ExpenseCategory, ExpenseType, PaymentStatus } from '../types';
import { X, Loader2, Minus, Plus, Sparkles, Wallet, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { detectPtcgSeries } from '../lib/gemini';
import { PTCG_PRODUCTS } from '../data/ptcg-products';

interface Props {
  expense: Expense;
  onClose: () => void;
}

export function ExpenseEditModal({ expense, onClose }: Props) {
  const { updateExpense } = useExpenses();
  const [saving, setSaving] = useState(false);
  const [detectingSeries, setDetectingSeries] = useState(false);

  const [type, setType] = useState<ExpenseType>(expense.type ?? 'Expense');
  const [title, setTitle] = useState(expense.title);
  const [amount, setAmount] = useState(String(expense.amount));
  const [quantity, setQuantity] = useState(expense.quantity ?? 1);
  const [quantityUnit, setQuantityUnit] = useState<'盒' | '包'>(
    (expense.quantityUnit as '盒' | '包') ?? '盒'
  );
  const [category, setCategory] = useState<string>(expense.category as string);
  const [customCategory, setCustomCategory] = useState(
    ['Card', 'Box', 'Tournament'].includes(expense.category as string) ? '' : expense.category as string
  );
  const [date, setDate] = useState(expense.date.split('T')[0]);
  const [seriesTag, setSeriesTag] = useState(expense.seriesTag ?? '');
  const [paymentStatus, setPaymentStatus] = useState<PaymentStatus>(expense.paymentStatus ?? 'paid');
  const [notes, setNotes] = useState(expense.notes ?? '');

  const isCustomCategory = !['Card', 'Box', 'Tournament'].includes(category);
  const effectiveCategory = isCustomCategory ? 'Other' : category;

  const uniqueCodeProducts = Array.from(
    new Map(PTCG_PRODUCTS.map(p => [p.code, p])).values()
  );
  const codeGroups = uniqueCodeProducts.reduce<Record<string, { code: string; name: string }[]>>((acc, p) => {
    if (!acc[p.series]) acc[p.series] = [];
    acc[p.series].push({ code: p.code, name: p.name });
    return acc;
  }, {});

  const handleSave = async () => {
    if (!title || !amount) return;
    setSaving(true);
    try {
      const finalCategory = effectiveCategory === 'Other' ? customCategory : category;
      await updateExpense(expense.id, {
        type,
        title,
        amount: Number(amount),
        quantity: category === 'Box' ? quantity : 1,
        quantityUnit: category === 'Box' ? quantityUnit : '個',
        category: finalCategory,
        date: new Date(date).toISOString(),
        notes,
        seriesTag: category === 'Box' ? (seriesTag || null) : null,
        paymentStatus: type === 'Expense' ? paymentStatus : 'paid',
      });
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />

      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <h2 className="font-black text-lg text-poke-dark-blue">編輯記錄</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="p-5 space-y-5">
          {/* Type toggle */}
          <div className="flex p-1 bg-slate-100 rounded-xl">
            <button
              type="button"
              onClick={() => setType('Expense')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all',
                type === 'Expense' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'
              )}
            >
              <Minus className="w-4 h-4" /> 支出
            </button>
            <button
              type="button"
              onClick={() => setType('Income')}
              className={cn(
                'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all',
                type === 'Income' ? 'bg-white text-poke-blue shadow-sm' : 'text-slate-500'
              )}
            >
              <Plus className="w-4 h-4" /> 收入 (賣出)
            </button>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">商品名稱</label>
            <input
              type="text"
              className="poke-input text-base"
              value={title}
              onChange={e => setTitle(e.target.value)}
            />
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
              value={amount}
              onChange={e => setAmount(e.target.value)}
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
                const selected = value === 'Other' ? isCustomCategory : category === value;
                return (
                  <button
                    key={value}
                    type="button"
                    onClick={() => {
                      if (value === 'Other') {
                        setCategory(customCategory || '');
                      } else {
                        setCategory(value as ExpenseCategory);
                        if (value !== 'Box') setQuantity(1);
                      }
                    }}
                    className={cn(
                      'py-2.5 px-3 rounded-lg border-2 text-sm font-bold transition-all text-center',
                      selected
                        ? 'border-poke-blue bg-poke-blue/10 text-poke-dark-blue'
                        : 'border-slate-200 bg-white text-slate-500'
                    )}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>

          {isCustomCategory && (
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">自定義類別</label>
              <input
                type="text"
                className="poke-input text-base"
                value={customCategory}
                onChange={e => { setCustomCategory(e.target.value); setCategory(e.target.value); }}
              />
            </div>
          )}

          {/* Box: quantity + series tag */}
          {category === 'Box' && (
            <>
              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">數量</label>
                <div className="flex items-center gap-3">
                  <div className="flex p-0.5 bg-slate-100 rounded-lg">
                    {(['盒', '包'] as const).map(u => (
                      <button
                        key={u}
                        type="button"
                        onClick={() => setQuantityUnit(u)}
                        className={cn(
                          'px-3 py-1.5 rounded-md text-sm font-bold transition-all',
                          quantityUnit === u ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-400'
                        )}
                      >
                        {u}
                      </button>
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={() => setQuantity(q => Math.max(1, q - 1))}
                    className="w-10 h-10 rounded-lg border-2 border-slate-200 flex items-center justify-center text-slate-600 hover:border-poke-blue transition-colors"
                  >
                    <Minus className="w-4 h-4" />
                  </button>
                  <span className="text-xl font-black text-slate-800 w-8 text-center">{quantity}</span>
                  <button
                    type="button"
                    onClick={() => setQuantity(q => q + 1)}
                    className="w-10 h-10 rounded-lg border-2 border-slate-200 flex items-center justify-center text-slate-600 hover:border-poke-blue transition-colors"
                  >
                    <Plus className="w-4 h-4" />
                  </button>
                  {amount && quantity > 1 && (
                    <span className="text-sm text-slate-500 font-bold">
                      = ¥{(Number(amount) * quantity).toLocaleString()}
                    </span>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-sm font-bold text-slate-700 mb-1.5">系列/世代</label>
                <div className="flex gap-2">
                  <select
                    className="poke-input text-base flex-1"
                    value={seriesTag}
                    onChange={e => setSeriesTag(e.target.value)}
                  >
                    <option value="">— 請選擇 —</option>
                    {Object.entries(codeGroups).map(([series, products]) => (
                      <optgroup key={series} label={series}>
                        {products.map(p => (
                          <option key={p.code} value={p.code}>{p.code} {p.name}</option>
                        ))}
                      </optgroup>
                    ))}
                  </select>
                  <button
                    type="button"
                    disabled={!title || detectingSeries}
                    onClick={async () => {
                      setDetectingSeries(true);
                      try {
                        const result = await detectPtcgSeries(title);
                        setSeriesTag(result);
                      } catch { /* ignore */ } finally {
                        setDetectingSeries(false);
                      }
                    }}
                    className="flex-shrink-0 flex items-center gap-1.5 px-3 py-2 rounded-lg bg-poke-blue/10 text-poke-dark-blue text-sm font-bold hover:bg-poke-blue/20 transition-colors disabled:opacity-40"
                  >
                    {detectingSeries
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Sparkles className="w-4 h-4" />
                    }
                    AI 判斷
                  </button>
                </div>
              </div>
            </>
          )}

          {/* Payment status — expense only */}
          {type === 'Expense' && (
            <div>
              <label className="block text-sm font-bold text-slate-700 mb-1.5">付款狀態</label>
              <div className="flex p-1 bg-slate-100 rounded-xl">
                <button
                  type="button"
                  onClick={() => setPaymentStatus('paid')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all',
                    paymentStatus === 'paid' ? 'bg-white text-slate-700 shadow-sm' : 'text-slate-500'
                  )}
                >
                  <Wallet className="w-4 h-4" /> Jay 已付
                </button>
                <button
                  type="button"
                  onClick={() => setPaymentStatus('pending')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-2 py-2.5 rounded-lg font-bold text-sm transition-all',
                    paymentStatus === 'pending' ? 'bg-white text-amber-600 shadow-sm' : 'text-slate-500'
                  )}
                >
                  <Clock className="w-4 h-4" /> 待報銷
                </button>
              </div>
            </div>
          )}

          {/* Date */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">日期</label>
            <input
              type="date"
              className="poke-input text-base"
              value={date}
              onChange={e => setDate(e.target.value)}
            />
          </div>

          {/* Notes */}
          <div>
            <label className="block text-sm font-bold text-slate-700 mb-1.5">備註 (選填)</label>
            <textarea
              className="poke-input text-base resize-none"
              rows={2}
              placeholder="備註..."
              value={notes}
              onChange={e => setNotes(e.target.value)}
            />
          </div>

          {/* Save */}
          <button
            type="button"
            onClick={handleSave}
            disabled={saving || !title || !amount}
            className={cn(
              'w-full py-4 rounded-xl font-black text-lg shadow-lg flex items-center justify-center gap-2 transition-all active:scale-[0.98] disabled:opacity-50',
              type === 'Expense' ? 'bg-slate-700 text-white' : 'bg-poke-blue text-white'
            )}
          >
            {saving ? <Loader2 className="w-6 h-6 animate-spin" /> : '儲存變更'}
          </button>
        </div>
      </motion.div>
    </div>
  );
}
