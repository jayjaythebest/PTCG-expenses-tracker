import { useState } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { ArrowDownCircle, ArrowUpCircle, Clock } from 'lucide-react';
import { startOfMonth, startOfQuarter, startOfYear, isAfter, subMonths, format } from 'date-fns';
import { cn, availableMonths, inMonth, formatMonthLabel } from '../lib/utils';
import { Expense } from '../types';
import { PTCG_PRODUCTS } from '../data/ptcg-products';

const CODE_NAME_MAP: Record<string, string> = Object.fromEntries(
  Array.from(new Map(PTCG_PRODUCTS.map(p => [p.code, p.name])).entries())
);

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
  const [selectedMonth, setSelectedMonth] = useState<string | null>(null);
  const [catFilter, setCatFilter] = useState('all');

  const months = availableMonths(expenses);

  // selectedMonth (yyyy-MM) overrides the period buttons when set.
  const periodFiltered = selectedMonth
    ? expenses.filter(e => inMonth(e.date, selectedMonth))
    : filterByPeriod(expenses, period);
  const filtered = filterByCategory(periodFiltered, catFilter);

  const totalExpense = totalAmount(filtered, 'Expense');
  const totalIncome = totalAmount(filtered, 'Income');
  const totalPending = filtered
    .filter(e => (e.type === 'Expense' || !e.type) && e.paymentStatus === 'pending')
    .reduce((sum, e) => sum + Number(e.amount) * (e.quantity ?? 1), 0);

  const categoryTotals = periodFiltered.reduce((acc, e) => {
    const cat = e.category as string;
    const amount = Number(e.amount) * (e.quantity ?? 1);
    const isExpense = e.type === 'Expense' || !e.type;
    if (!acc[cat]) acc[cat] = { expense: 0, income: 0 };
    if (isExpense) acc[cat].expense += amount;
    else acc[cat].income += amount;
    return acc;
  }, {} as Record<string, { expense: number; income: number }>);

  // Monthly trend — always last 12 months, ignores period/cat filter
  const monthBuckets = Array.from({ length: 12 }, (_, i) => {
    const d = subMonths(startOfMonth(new Date()), 11 - i);
    return { label: format(d, 'M月'), yearMonth: format(d, 'yyyy-MM'), expense: 0, income: 0 };
  });
  expenses.forEach(e => {
    const ym = format(new Date(e.date), 'yyyy-MM');
    const bucket = monthBuckets.find(b => b.yearMonth === ym);
    if (!bucket) return;
    const amount = Number(e.amount) * (e.quantity ?? 1);
    if (e.type === 'Expense' || !e.type) bucket.expense += amount;
    else bucket.income += amount;
  });
  const maxMonthExpense = Math.max(...monthBuckets.map(b => b.expense), 1);
  const hasMonthData = monthBuckets.some(b => b.expense > 0 || b.income > 0);

  const seriesTotals = periodFiltered
    .filter(e => (e.category as string) === 'Box')
    .reduce((acc, e) => {
      const key = e.seriesTag || '未標記';
      const amount = Number(e.amount) * (e.quantity ?? 1);
      const isExpense = e.type === 'Expense' || !e.type;
      if (!acc[key]) acc[key] = { expense: 0, income: 0 };
      if (isExpense) acc[key].expense += amount;
      else acc[key].income += amount;
      return acc;
    }, {} as Record<string, { expense: number; income: number }>);

  const seriesRows = Object.entries(seriesTotals)
    .sort((a, b) => b[1].expense - a[1].expense);
  const maxSeriesExpense = Math.max(...seriesRows.map(([, v]) => v.expense), 1);

  return (
    <div className="space-y-4 mb-8">
      {/* Period filter */}
      <div className="flex gap-2">
        {(Object.keys(PERIOD_LABELS) as Period[]).map(p => (
          <button
            key={p}
            onClick={() => { setPeriod(p); setSelectedMonth(null); }}
            className={cn(
              'flex-1 py-2 rounded-lg text-sm font-bold transition-all',
              !selectedMonth && period === p
                ? 'bg-poke-blue text-white shadow-sm'
                : 'bg-white border-2 border-slate-200 text-slate-500 hover:border-poke-blue/40'
            )}
          >
            {PERIOD_LABELS[p]}
          </button>
        ))}
      </div>

      {/* Specific-month picker */}
      <div className="flex items-center gap-2">
        <select
          value={selectedMonth ?? ''}
          onChange={e => setSelectedMonth(e.target.value || null)}
          className={cn(
            'flex-1 py-2 px-3 rounded-lg text-sm font-bold border-2 bg-white focus:outline-none transition-all',
            selectedMonth
              ? 'border-poke-blue text-poke-dark-blue'
              : 'border-slate-200 text-slate-500'
          )}
        >
          <option value="">指定月份…</option>
          {months.map(m => (
            <option key={m} value={m}>{formatMonthLabel(m)}</option>
          ))}
        </select>
        {selectedMonth && (
          <button
            onClick={() => setSelectedMonth(null)}
            className="px-3 py-2 rounded-lg text-sm font-bold text-slate-400 border-2 border-slate-200 hover:text-slate-600 transition-colors"
          >
            清除
          </button>
        )}
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

      {/* Pending reimbursement total */}
      {totalPending > 0 && (
        <div className="poke-card p-4 border-l-4 border-l-amber-400 bg-amber-50/40">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2 text-amber-700">
              <Clock className="w-4 h-4" />
              <span className="text-xs font-black uppercase tracking-wider">
                待報銷{selectedMonth ? `（${formatMonthLabel(selectedMonth)}）` : ''}
              </span>
            </div>
            <p className="text-xl font-black text-amber-600">¥{totalPending.toLocaleString()}</p>
          </div>
        </div>
      )}

      {/* Monthly trend chart */}
      {hasMonthData && (
        <div className="space-y-3">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-1">月度花費趨勢</h3>
          <div className="poke-card px-4 pt-4 pb-3">
            <div className="flex items-end gap-1 h-28">
              {monthBuckets.map(bucket => {
                const pct = bucket.expense / maxMonthExpense;
                const abbreviated = bucket.expense >= 10000
                  ? `${(bucket.expense / 10000).toFixed(1)}万`
                  : bucket.expense >= 1000
                    ? `${(bucket.expense / 1000).toFixed(0)}k`
                    : bucket.expense > 0 ? `${bucket.expense}` : '';
                const isActive = selectedMonth === bucket.yearMonth;
                return (
                  <button
                    key={bucket.yearMonth}
                    type="button"
                    onClick={() => setSelectedMonth(isActive ? null : bucket.yearMonth)}
                    title={`查看 ${formatMonthLabel(bucket.yearMonth)}`}
                    className="flex-1 h-full flex flex-col items-center gap-0.5 min-w-0 cursor-pointer group"
                  >
                    {bucket.expense > 0 && (
                      <span className="text-[9px] font-bold text-slate-400 leading-none">{abbreviated}</span>
                    )}
                    <div className="w-full flex-1 flex flex-col justify-end">
                      <div
                        className={cn(
                          'w-full rounded-t-sm transition-all duration-500 group-hover:opacity-80',
                          isActive ? 'bg-poke-dark-blue' : bucket.expense > 0 ? 'bg-poke-blue' : 'bg-slate-100'
                        )}
                        style={{ height: bucket.expense > 0 ? `${Math.max(pct * 100, 4)}%` : '4%' }}
                      />
                    </div>
                    {bucket.income > 0 && (
                      <div className="w-full h-1 bg-blue-300 rounded-full mt-0.5" title={`+¥${bucket.income.toLocaleString()}`} />
                    )}
                    <span className={cn(
                      'text-[9px] font-bold mt-1 leading-none',
                      isActive ? 'text-poke-dark-blue' : 'text-slate-400'
                    )}>{bucket.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-slate-100">
              <span className="flex items-center gap-1 text-[10px] text-slate-400 font-bold">
                <span className="w-2.5 h-2.5 rounded-sm bg-poke-blue inline-block" /> 支出
              </span>
              <span className="flex items-center gap-1 text-[10px] text-slate-400 font-bold">
                <span className="w-2.5 h-1 rounded-full bg-blue-300 inline-block" /> 收入
              </span>
            </div>
          </div>
        </div>
      )}

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

      {/* Series breakdown — Box only */}
      {seriesRows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-1">世代卡包統計</h3>
          <div className="poke-card divide-y divide-slate-100">
            {seriesRows.map(([code, totals]) => {
              const name = code !== '未標記' ? (CODE_NAME_MAP[code] ?? '') : '';
              const barPct = Math.round((totals.expense / maxSeriesExpense) * 100);
              return (
                <div key={code} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-16 flex-shrink-0">
                    <span className="text-xs font-black text-poke-dark-blue font-mono">{code}</span>
                    {name && <p className="text-[10px] text-slate-400 truncate">{name}</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-poke-blue rounded-full transition-all duration-500"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right min-w-[5rem]">
                    {totals.expense > 0 && (
                      <p className="text-sm font-black text-slate-700">-¥{totals.expense.toLocaleString()}</p>
                    )}
                    {totals.income > 0 && (
                      <p className={cn('text-xs font-bold text-poke-blue', totals.expense > 0 && 'mt-0.5')}>
                        +¥{totals.income.toLocaleString()}
                      </p>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
