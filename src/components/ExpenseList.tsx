import { useState, useRef, useEffect } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { Expense } from '../types';
import { format } from 'date-fns';
import { Trash2, Tag, Camera, ImageIcon, Loader2, Pencil, Clock, Wallet } from 'lucide-react';
import { cn, availableMonths, inMonth, formatMonthLabel } from '../lib/utils';
import { AnimatePresence } from 'motion/react';
import { ExpenseEditModal } from './ExpenseEditModal';
import { lookupSetImage } from '../lib/tcgdex';

function getCategoryText(category: string) {
  switch (category) {
    case 'Card': return '單張卡片';
    case 'Box': return '整盒/擴充包';
    case 'Tournament': return '賽事報名費';
    default: return category;
  }
}

function getCategoryColor(category: string) {
  switch (category) {
    case 'Card': return 'bg-blue-50 text-blue-600';
    case 'Box': return 'bg-slate-100 text-slate-600';
    case 'Tournament': return 'bg-blue-100 text-blue-700';
    default: return 'bg-slate-50 text-slate-500';
  }
}

// Small representative image for a row, resolved on-the-fly from the set code
// (expense.seriesTag). Falls back to the category-coloured Tag icon whenever
// there's no code, the lookup misses, or the resolved image fails to load.
// This is display-only and never persisted — receipt images stay separate.
function SeriesThumb({
  code,
  isIncome,
  category,
}: {
  code?: string;
  isIncome: boolean;
  category: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setSrc(null);
    setBroken(false);
    if (!code) return;
    lookupSetImage(code)
      .then(res => { if (alive) setSrc(res?.imageUrl ?? null); })
      .catch(() => { if (alive) setSrc(null); });
    return () => { alive = false; };
  }, [code]);

  const fallback = (
    <div className={cn(
      'p-2.5 rounded-xl flex-shrink-0',
      isIncome ? 'bg-blue-50 text-poke-blue' : getCategoryColor(category)
    )}>
      <Tag className="w-5 h-5" />
    </div>
  );

  if (!code || broken || !src) return fallback;

  return (
    <div className="w-11 h-11 rounded-xl flex-shrink-0 overflow-hidden bg-white border border-slate-100 flex items-center justify-center">
      <img
        src={src}
        alt=""
        referrerPolicy="no-referrer"
        className="w-full h-full object-contain"
        onError={() => setBroken(true)}
      />
    </div>
  );
}

export function ExpenseList() {
  const { expenses, loading, deleteExpense, uploadExpenseImage, updateExpense } = useExpenses();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const [editingExpense, setEditingExpense] = useState<Expense | null>(null);
  const [month, setMonth] = useState<string>('all');
  const pendingIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoButtonClick = (id: string) => {
    pendingIdRef.current = id;
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    const id = pendingIdRef.current;
    if (!file || !id) return;

    if (file.size > 5 * 1024 * 1024) {
      alert('圖片太大了，請選擇小於 5MB 的圖片');
      return;
    }

    setUploadingId(id);
    try {
      await uploadExpenseImage(id, file);
    } catch (err) {
      console.error(err);
      alert('上傳失敗，請再試一次');
    } finally {
      setUploadingId(null);
      pendingIdRef.current = null;
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-poke-blue"></div>
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="text-center p-12 bg-white rounded-xl border-2 border-dashed border-slate-200">
        <p className="text-slate-500">尚無記錄。開始新增一筆吧！</p>
      </div>
    );
  }

  const months = availableMonths(expenses);
  const visible = month === 'all' ? expenses : expenses.filter(e => inMonth(e.date, month));

  const lineTotal = (e: Expense) => Number(e.amount) * (e.quantity ?? 1);
  const monthExpense = visible
    .filter(e => e.type !== 'Income')
    .reduce((s, e) => s + lineTotal(e), 0);
  const monthIncome = visible
    .filter(e => e.type === 'Income')
    .reduce((s, e) => s + lineTotal(e), 0);
  const monthPending = visible
    .filter(e => e.type !== 'Income' && e.paymentStatus === 'pending')
    .reduce((s, e) => s + lineTotal(e), 0);

  return (
    <>
    <AnimatePresence>
      {editingExpense && (
        <ExpenseEditModal
          expense={editingExpense}
          onClose={() => setEditingExpense(null)}
        />
      )}
    </AnimatePresence>
    <div className="space-y-4">
      {/* Hidden file input shared across all rows */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Header: title + month filter */}
      <div className="flex items-center justify-between gap-2 px-2">
        <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest">
          {month === 'all' ? '最近記錄' : `${formatMonthLabel(month)}記錄`}
        </h2>
        <select
          value={month}
          onChange={e => setMonth(e.target.value)}
          className="text-xs font-bold text-slate-600 border-2 border-slate-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:border-poke-blue"
        >
          <option value="all">全部月份</option>
          {months.map(m => (
            <option key={m} value={m}>{formatMonthLabel(m)}</option>
          ))}
        </select>
      </div>

      {/* Subtotal bar */}
      <div className="flex items-center gap-3 px-2 -mt-1 text-xs font-bold flex-wrap">
        <span className="text-slate-500">支出 <span className="text-slate-700">¥{monthExpense.toLocaleString()}</span></span>
        {monthIncome > 0 && (
          <span className="text-slate-500">收入 <span className="text-poke-blue">¥{monthIncome.toLocaleString()}</span></span>
        )}
        {monthPending > 0 && (
          <span className="inline-flex items-center gap-1 text-amber-600">
            <Clock className="w-3 h-3" /> 待報銷 ¥{monthPending.toLocaleString()}
          </span>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="text-center p-8 bg-white rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">{formatMonthLabel(month)}尚無記錄</p>
        </div>
      ) : (
      <div className="grid gap-3">
        {visible.map((expense) => {
          const isIncome = expense.type === 'Income';
          const isUploading = uploadingId === expense.id;
          const hasImage = !!expense.imageUrl;

          return (
            <div key={expense.id} className="poke-card p-4 transition-colors">
              <div className="flex items-center justify-between gap-3">
                {/* Left: icon + title/date */}
                <div className="flex items-center gap-3 min-w-0">
                  <SeriesThumb
                    code={expense.seriesTag}
                    isIncome={isIncome}
                    category={expense.category as string}
                  />
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 truncate text-sm sm:text-base">{expense.title}</h3>
                    <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-400 font-bold flex-wrap">
                      <span className="uppercase">{getCategoryText(expense.category as string)}</span>
                      {expense.category === 'Box' && expense.quantity > 1 && (
                        <span className="text-poke-blue">{expense.quantity}{expense.quantityUnit}</span>
                      )}
                      {expense.seriesTag && (
                        <span className="px-1.5 py-0.5 rounded bg-poke-blue/10 text-poke-dark-blue font-black text-[10px]">
                          {expense.seriesTag}
                        </span>
                      )}
                      {!isIncome && (
                        <button
                          type="button"
                          onClick={() => updateExpense(expense.id, { paymentStatus: expense.paymentStatus === 'pending' ? 'paid' : 'pending' })}
                          title="點擊切換 Jay 已付 / 待報銷"
                          className={cn(
                            'inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded font-black text-[10px] transition-colors',
                            expense.paymentStatus === 'pending'
                              ? 'bg-amber-100 text-amber-700 hover:bg-amber-200'
                              : 'bg-emerald-100 text-emerald-700 hover:bg-emerald-200'
                          )}
                        >
                          {expense.paymentStatus === 'pending'
                            ? <><Clock className="w-2.5 h-2.5" /> 待報銷</>
                            : <><Wallet className="w-2.5 h-2.5" /> 已付</>}
                        </button>
                      )}
                      <span>•</span>
                      <span>{format(new Date(expense.date), 'MM/dd')}</span>
                      {(() => {
                        const created = format(new Date(expense.createdAt), 'MM/dd');
                        const dated   = format(new Date(expense.date), 'MM/dd');
                        return created !== dated ? (
                          <span className="text-slate-300 font-normal">({created} 補記)</span>
                        ) : null;
                      })()}
                    </div>
                  </div>
                </div>

                {/* Right: amount + actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <div className="flex flex-col items-end mr-1">
                    <p className={cn(
                      "font-black text-sm sm:text-base",
                      isIncome ? "text-poke-blue" : "text-slate-700"
                    )}>
                      {isIncome ? '+' : '-'}¥{(Number(expense.amount) * expense.quantity).toLocaleString()}
                    </p>
                    {expense.category === 'Box' && expense.quantity > 1 && (
                      <p className="text-[10px] text-slate-400 font-bold">
                        ¥{Number(expense.amount).toLocaleString()} × {expense.quantity}{expense.quantityUnit}
                      </p>
                    )}
                  </div>

                  {/* Edit button */}
                  <button
                    onClick={() => setEditingExpense(expense)}
                    className="p-2 text-slate-300 hover:text-poke-blue hover:bg-blue-50 transition-colors rounded-lg"
                    title="編輯"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>

                  {/* Photo button */}
                  <button
                    onClick={() => handlePhotoButtonClick(expense.id)}
                    disabled={isUploading}
                    title={hasImage ? '更換照片' : '補加照片'}
                    className={cn(
                      "p-2 rounded-lg transition-colors",
                      hasImage
                        ? "text-poke-blue hover:bg-blue-50"
                        : "text-slate-300 hover:text-poke-blue hover:bg-blue-50"
                    )}
                  >
                    {isUploading
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : hasImage
                        ? <ImageIcon className="w-4 h-4" />
                        : <Camera className="w-4 h-4" />
                    }
                  </button>

                  {/* Delete button */}
                  <button
                    onClick={() => {
                      if (confirm('確定要刪除這筆記錄嗎？')) deleteExpense(expense.id);
                    }}
                    className="p-2 text-slate-300 hover:text-red-500 transition-colors rounded-lg"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>

              {/* Image preview row — only shown when image exists */}
              {hasImage && (
                <div className="mt-3 flex items-center gap-2">
                  <img
                    src={expense.imageUrl}
                    alt="收據"
                    className="w-14 h-14 object-cover rounded-lg border border-slate-200 cursor-pointer flex-shrink-0"
                    onClick={() => window.open(expense.imageUrl, '_blank')}
                  />
                  <div className="flex flex-col gap-1">
                    <button
                      onClick={() => window.open(expense.imageUrl, '_blank')}
                      className="text-xs font-bold text-poke-blue underline text-left"
                    >
                      查看原圖
                    </button>
                    <button
                      onClick={() => handlePhotoButtonClick(expense.id)}
                      disabled={isUploading}
                      className="text-xs font-bold text-slate-400 hover:text-poke-blue text-left transition-colors"
                    >
                      更換照片
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
      )}
    </div>
    </>
  );
}
