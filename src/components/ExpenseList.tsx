import { useState, useRef } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { format, isToday, isYesterday } from 'date-fns';
import { Camera, ImageIcon, Loader2, Trash2 } from 'lucide-react';
import { cn } from '../lib/utils';

const CATEGORY_EMOJI: Record<string, string> = {
  Card: '🃏',
  Box: '📦',
  Tournament: '🏆',
};

function catEmoji(c: string) { return CATEGORY_EMOJI[c] ?? '📌'; }

function dateLabel(dateStr: string) {
  const d = new Date(dateStr);
  if (isToday(d)) return '今天';
  if (isYesterday(d)) return '昨天';
  return format(d, 'M月d日');
}

export function ExpenseList() {
  const { expenses, loading, deleteExpense, uploadExpenseImage } = useExpenses();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
  const pendingIdRef = useRef<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handlePhotoClick = (id: string) => {
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
    } catch {
      alert('上傳失敗，請再試一次');
    } finally {
      setUploadingId(null);
      pendingIdRef.current = null;
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-40">
        <div className="h-6 w-6 rounded-full border-2 border-poke-blue border-t-transparent animate-spin" />
      </div>
    );
  }

  if (expenses.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-52 gap-1">
        <p className="text-notion-muted text-sm">尚無記錄</p>
        <p className="text-notion-border text-xs">點擊下方 + 開始新增</p>
      </div>
    );
  }

  // Group by calendar date (using expense.date)
  const grouped = expenses.reduce((acc, expense) => {
    const key = format(new Date(expense.date), 'yyyy-MM-dd');
    if (!acc[key]) acc[key] = [];
    acc[key].push(expense);
    return acc;
  }, {} as Record<string, typeof expenses>);

  const sortedKeys = Object.keys(grouped).sort((a, b) => b.localeCompare(a));

  return (
    <div className="pb-4">
      {/* Hidden shared file input */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      {/* Page title */}
      <div className="px-4 pt-6 pb-4">
        <h1 className="text-[28px] font-bold text-notion-text leading-tight">支出記錄</h1>
        <p className="text-sm text-notion-muted mt-1">共 {expenses.length} 筆</p>
      </div>

      {sortedKeys.map(dateKey => {
        const items = grouped[dateKey];
        const dayNet = items.reduce((sum, e) => {
          const amt = Number(e.amount) || 0;
          return sum + (e.type === 'Income' ? amt : -amt);
        }, 0);

        return (
          <div key={dateKey} className="mb-1">
            {/* Date header */}
            <div className="flex items-center justify-between px-4 py-2">
              <span className="text-[11px] font-semibold text-notion-muted uppercase tracking-wide">
                {dateLabel(dateKey)}
              </span>
              <span className={cn(
                'text-[11px] font-semibold',
                dayNet >= 0 ? 'text-poke-blue' : 'text-notion-muted'
              )}>
                {dayNet >= 0 ? '+' : ''}¥{dayNet.toLocaleString()}
              </span>
            </div>

            {/* Rows */}
            <div className="border-t border-notion-border">
              {items.map((expense, idx) => {
                const isIncome = expense.type === 'Income';
                const isUploading = uploadingId === expense.id;
                const hasImage = !!expense.imageUrl;

                return (
                  <div key={expense.id}>
                    <div className={cn(
                      'flex items-center gap-3 px-4 py-3 active:bg-notion-hover transition-colors',
                      idx < items.length - 1 && 'border-b border-notion-border'
                    )}>
                      {/* Emoji */}
                      <span className="text-[22px] w-8 text-center shrink-0 leading-none">
                        {catEmoji(expense.category as string)}
                      </span>

                      {/* Title + notes */}
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-notion-text truncate leading-snug">
                          {expense.title}
                        </p>
                        {expense.notes && (
                          <p className="text-xs text-notion-muted truncate mt-0.5">
                            {expense.notes}
                          </p>
                        )}
                      </div>

                      {/* Amount */}
                      <span className={cn(
                        'text-sm font-semibold shrink-0',
                        isIncome ? 'text-poke-blue' : 'text-notion-text'
                      )}>
                        {isIncome ? '+' : '−'}¥{Number(expense.amount).toLocaleString()}
                      </span>

                      {/* Action buttons */}
                      <div className="flex items-center gap-0.5 shrink-0">
                        <button
                          onClick={() => handlePhotoClick(expense.id)}
                          disabled={isUploading}
                          className={cn(
                            'p-2 rounded-lg transition-colors',
                            hasImage
                              ? 'text-poke-blue'
                              : 'text-notion-border hover:text-notion-muted'
                          )}
                        >
                          {isUploading
                            ? <Loader2 className="w-4 h-4 animate-spin" />
                            : hasImage
                              ? <ImageIcon className="w-4 h-4" />
                              : <Camera className="w-4 h-4" />
                          }
                        </button>
                        <button
                          onClick={() => {
                            if (confirm('確定要刪除這筆記錄嗎？')) deleteExpense(expense.id);
                          }}
                          className="p-2 rounded-lg text-notion-border hover:text-red-500 transition-colors"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>

                    {/* Receipt thumbnail (below row, indented) */}
                    {hasImage && (
                      <div className="pl-[52px] pr-4 pb-2 -mt-1 border-b border-notion-border">
                        <img
                          src={expense.imageUrl}
                          alt="收據"
                          onClick={() => window.open(expense.imageUrl, '_blank')}
                          className="h-14 w-auto rounded-lg border border-notion-border cursor-pointer object-cover"
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
