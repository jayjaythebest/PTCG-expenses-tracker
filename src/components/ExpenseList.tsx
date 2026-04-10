import { useState, useRef } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { format } from 'date-fns';
import { Trash2, Tag, Camera, ImageIcon, Loader2 } from 'lucide-react';
import { cn } from '../lib/utils';

export function ExpenseList() {
  const { expenses, loading, deleteExpense, uploadExpenseImage } = useExpenses();
  const [uploadingId, setUploadingId] = useState<string | null>(null);
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

  const getCategoryText = (category: string) => {
    switch (category) {
      case 'Card': return '單張卡片';
      case 'Box': return '整盒/擴充包';
      case 'Tournament': return '賽事報名費';
      default: return category;
    }
  };

  const getCategoryColor = (category: string) => {
    switch (category) {
      case 'Card': return 'bg-blue-50 text-blue-600';
      case 'Box': return 'bg-slate-100 text-slate-600';
      case 'Tournament': return 'bg-blue-100 text-blue-700';
      default: return 'bg-slate-50 text-slate-500';
    }
  };

  return (
    <div className="space-y-4">
      {/* Hidden file input shared across all rows */}
      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        className="hidden"
        onChange={handleFileChange}
      />

      <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest px-2">最近記錄</h2>
      <div className="grid gap-3">
        {expenses.map((expense) => {
          const isIncome = expense.type === 'Income';
          const isUploading = uploadingId === expense.id;
          const hasImage = !!expense.imageUrl;

          return (
            <div key={expense.id} className="poke-card p-4 transition-colors">
              <div className="flex items-center justify-between gap-3">
                {/* Left: icon + title/date */}
                <div className="flex items-center gap-3 min-w-0">
                  <div className={cn(
                    "p-2.5 rounded-xl flex-shrink-0",
                    isIncome ? "bg-blue-50 text-poke-blue" : getCategoryColor(expense.category as string)
                  )}>
                    <Tag className="w-5 h-5" />
                  </div>
                  <div className="min-w-0">
                    <h3 className="font-bold text-slate-900 truncate text-sm sm:text-base">{expense.title}</h3>
                    <div className="flex items-center gap-2 text-[10px] sm:text-xs text-slate-400 font-bold">
                      <span className="uppercase">{getCategoryText(expense.category as string)}</span>
                      <span>•</span>
                      <span>{format(new Date(expense.date), 'MM/dd')}</span>
                    </div>
                  </div>
                </div>

                {/* Right: amount + actions */}
                <div className="flex items-center gap-1 flex-shrink-0">
                  <p className={cn(
                    "font-black text-sm sm:text-base mr-1",
                    isIncome ? "text-poke-blue" : "text-slate-700"
                  )}>
                    {isIncome ? '+' : '-'}¥{Number(expense.amount).toLocaleString()}
                  </p>

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
    </div>
  );
}
