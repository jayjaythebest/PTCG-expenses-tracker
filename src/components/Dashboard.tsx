import { useExpenses } from '../lib/useExpenses';
import { Wallet, TrendingUp, ArrowDownCircle, ArrowUpCircle } from 'lucide-react';

export function Dashboard() {
  const { expenses } = useExpenses();

  const totalExpense = expenses
    .filter(e => e.type === 'Expense' || !e.type) // Default to expense if type missing
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const totalIncome = expenses
    .filter(e => e.type === 'Income')
    .reduce((sum, e) => sum + (Number(e.amount) || 0), 0);

  const balance = totalIncome - totalExpense;

  // Group by category
  const categoryTotals = expenses.reduce((acc, e) => {
    const cat = e.category;
    const amount = Number(e.amount) || 0;
    const isExpense = e.type === 'Expense' || !e.type;
    
    if (!acc[cat]) acc[cat] = { expense: 0, income: 0 };
    if (isExpense) acc[cat].expense += amount;
    else acc[cat].income += amount;
    
    return acc;
  }, {} as Record<string, { expense: number, income: number }>);

  const getCategoryLabel = (cat: string) => {
    switch (cat) {
      case 'Card': return '單張卡片';
      case 'Box': return '整盒/擴充包';
      case 'Tournament': return '賽事報名費';
      default: return cat;
    }
  };

  return (
    <div className="space-y-6 mb-8">
      {/* Balance Card */}
      <div className="poke-card p-6 bg-poke-blue text-white shadow-lg shadow-poke-blue/20 flex items-center justify-between overflow-hidden relative">
        <div className="relative z-10">
          <p className="text-blue-100 font-bold text-sm mb-1 uppercase tracking-wider">目前餘額 (日圓)</p>
          <h2 className="text-4xl sm:text-5xl font-black tracking-tight">
            {balance >= 0 ? '+' : ''}¥{balance.toLocaleString()}
          </h2>
        </div>
        <div className="p-4 bg-white/10 rounded-2xl relative z-10">
          <Wallet className="w-10 h-10" />
        </div>
        {/* Decorative background circle */}
        <div className="absolute -right-10 -bottom-10 w-40 h-40 bg-white/5 rounded-full" />
      </div>

      {/* Income/Expense Summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="poke-card p-4 border-l-4 border-l-poke-blue">
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <ArrowUpCircle className="w-4 h-4 text-poke-blue" />
            <span className="text-xs font-black uppercase tracking-wider">總收入</span>
          </div>
          <p className="text-xl font-black text-poke-blue">¥{totalIncome.toLocaleString()}</p>
        </div>
        <div className="poke-card p-4 border-l-4 border-l-slate-400">
          <div className="flex items-center gap-2 text-slate-500 mb-1">
            <ArrowDownCircle className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-black uppercase tracking-wider">總支出</span>
          </div>
          <p className="text-xl font-black text-slate-700">¥{totalExpense.toLocaleString()}</p>
        </div>
      </div>

      {/* Category Breakdown */}
      <div className="space-y-3">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-1">分類統計</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(categoryTotals).map(([cat, totals]) => (
            <div key={cat} className="poke-card p-3 flex flex-col gap-1">
              <span className="text-[10px] font-black text-slate-400 uppercase truncate">{getCategoryLabel(cat)}</span>
              <div className="flex flex-col">
                {totals.income > 0 && <p className="text-xs font-bold text-poke-blue">+{totals.income.toLocaleString()}</p>}
                {totals.expense > 0 && <p className="text-xs font-bold text-slate-600">-{totals.expense.toLocaleString()}</p>}
              </div>
            </div>
          ))}
          {expenses.length === 0 && (
            <div className="col-span-full text-center py-6 text-slate-400 text-sm italic bg-white rounded-xl border-2 border-dashed border-slate-100">
              尚無數據可顯示
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
