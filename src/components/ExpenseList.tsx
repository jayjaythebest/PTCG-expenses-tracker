import { useExpenses } from '../lib/useExpenses';
import { format } from 'date-fns';
import { zhTW } from 'date-fns/locale';
import { CheckCircle, XCircle, Clock, Trash2, Tag } from 'lucide-react';
import { ExpenseStatus } from '../types';
import { cn } from '../lib/utils';

export function ExpenseList() {
  const { expenses, loading, deleteExpense } = useExpenses();

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
      <h2 className="text-sm font-black text-slate-400 uppercase tracking-widest px-2">最近記錄</h2>
      <div className="grid gap-3">
        {expenses.map((expense) => {
          const isIncome = expense.type === 'Income';
          return (
            <div key={expense.id} className="poke-card p-4 flex items-center justify-between gap-3 active:bg-slate-50 transition-colors">
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

              <div className="flex items-center gap-3 flex-shrink-0">
                <div className="text-right">
                  <p className={cn(
                    "font-black text-sm sm:text-base",
                    isIncome ? "text-poke-blue" : "text-slate-700"
                  )}>
                    {isIncome ? '+' : '-'}¥{Number(expense.amount).toLocaleString()}
                  </p>
                  {expense.imageUrl && (
                    <button 
                      onClick={() => window.open(expense.imageUrl, '_blank')}
                      className="text-[10px] font-bold text-poke-blue underline"
                    >
                      查看圖片
                    </button>
                  )}
                </div>
                <button
                  onClick={() => {
                    if (confirm('確定要刪除這筆記錄嗎？')) deleteExpense(expense.id);
                  }}
                  className="p-2 text-slate-300 hover:text-red-500 transition-colors"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
