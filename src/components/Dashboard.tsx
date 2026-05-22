import { useState } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { ArrowDownCircle, ArrowUpCircle } from 'lucide-react';
import { startOfMonth, startOfQuarter, startOfYear, isAfter } from 'date-fns';
import { cn } from '../lib/utils';
import { Expense } from '../types';

type Period = 'month' | 'quarter' | 'year' | 'all';

const PERIOD_LABELS: Record<Period, string> = {
  month: '本月',
  quarter: '本季',
  year: '今年',
  all: '全部',
};

const CATEGORY_FILTERS = [
  { value: 'all', label: '全部' },
  { value: 'Card', label: '單張' },
  { value: 'Box', label: '卡包' },
  { value: 'Tournament', label: '賽事' },
  { value: 'Other', label: '其他' },
] as const;

function filterByPeriod(expenses: Expense[], period: Period): Expense[] {
  if (period === 'all') return expenses;
  const now = new Date();
  const cutoff =
    period === 'month' ? startOfMonth(now) :
    period === 'quarter' ? startOfQuarter(now) :
    startOfYear(now);
  return expenses.filter(e => isAfter(new Date(e.date), cutoff));
}

function filterByCategory(expenses: Expense[], cat: string): Expense[] {
  if (cat === 'all') return expenses;
  if (cat === 'Other') return expenses.filter(e => !['Card', 'Box', 'Tournament'].includes(e.category as string));
  return expenses.filter(e => e.category === cat);
}

function totalAmount(expenses: Expense[], type: 'Expense' | 'Income'): number {
  return expenses
    .filter(e => type === 'Expense' ? (e.type === 'Expense' || !e.type) : e.type === 'Income')
    .reduce((sum, e) => sum + Number(e.amount) * (e.quantity ?? 1), 0);
}

const getCategoryLabel = (cat: string) => {
  switch (cat) {
    case 'Card': return '單張卡片';
    case 'Box': return '整盒/擴充包';
    case 'Tournament': return '賽事報名費';
    default: return cat;
  }
};

export function Dashboard() {
  const { expenses } = useExpenses();
  const [period, setPeriod] = useState<Period>('month');
  const [catFilter, setCatFilter] = useState('all');

  const periodFiltered = filterByPeriod(expenses, period);
  const filtered = filterByCategory(periodFiltered, catFilter);

  const totalExpense = totalAmount(filtered, 'Expense');
  const totalIncome = totalAmount(filtered, 'Income');

  const categoryTotals = periodFiltered.reduce((acc, e) => {
    const cat = e.category as string;
    const amount = Number(e.amount) * (e.quantity ?? 1);
    const isExpense = e.type === 'Expense' || !e.type;
    if (!acc[cat]) acc[cat] = { expense: 0, income: 0 };
    if (isExpense) acc[cat].expense += amount;
    else acc[cat].income += amount;
    return acc;
  }, {} as Record<string, { expense: number; income: number }>);

  return (
    <div className="space-y-4 mb-8">
      {/* Period filter */}
      <div className="flex gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => setPeriod(p)}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-bold transition-all',
              period === p
                ? 'bg-poke-blue text-white shadow-sm'
                : 'bg-white border-2 border-slate-200 text-slate-500 hover:border-poke-blue/40'
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Category filter */}
      <div className="flex gap-2 overflow-x-auto pb-0.5">
        {CATEGORY_FILTERS.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setCatFilter(value)}
            className={cn(
              'flex-shrink-0 px-3 py-1.5 rounded-lg text-xs font-bold transition-all',
              catFilter === value
                ? 'bg-poke-dark-blue text-white'
                : 'bg-white border-2 border-slate-200 text-slate-500 hover:border-slate-300'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Income / Expense summary */}
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

      {/* Category breakdown (always by period, not cat filter) */}
      <div className="space-y-3">
        <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-1">分類統計</h3>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {Object.entries(categoryTotals).map(([cat, totals]) => (
            <div key={cat} className="poke-card p-3 flex flex-col gap-1">
              <span className="text-[10px] font-black text-slate-400 uppercase truncate">{getCategoryLabel(cat)}</span>
              <div className="flex flex-col">
                {totals.income > 0 && <p className="text-xs font-bold text-poke-blue">+¥{totals.income.toLocaleString()}</p>}
                {totals.expense > 0 && <p className="text-xs font-bold text-slate-600">-¥{totals.expense.toLocaleString()}</p>}
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
