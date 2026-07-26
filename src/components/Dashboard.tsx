import { useState } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { ArrowDownCircle, ArrowUpCircle, Clock, Wallet, Sparkles, Loader2 } from 'lucide-react';
import { startOfMonth, startOfQuarter, startOfYear, isAfter, subMonths, subDays, format } from 'date-fns';
import { cn, availableMonths, inMonth, formatMonthLabel } from '../lib/utils';
import { Expense } from '../types';
import { PTCG_PRODUCTS } from '../data/ptcg-products';
import { generateWeeklySummary } from '../lib/gemini';

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
  const [weeklySummary, setWeeklySummary] = useState('');
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState(false);

  const weekExpenses = expenses.filter(e => isAfter(new Date(e.date), subDays(new Date(), 7)));

  const handleGenerateSummary = async () => {
    setSummaryLoading(true);
    setSummaryError(false);
    try {
      const text = await generateWeeklySummary(weekExpenses.map(e => ({
        title: e.title,
        category: e.category as string,
        amount: Number(e.amount),
        quantity: e.quantity ?? 1,
        type: e.type === 'Income' ? 'Income' : 'Expense',
        date: e.date,
      })));
      setWeeklySummary(text);
    } catch (error) {
      console.error(error);
      setSummaryError(true);
    } finally {
      setSummaryLoading(false);
    }
  };

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
  const totalPaid = totalExpense - totalPending;

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
                : 'bg-white/5 border border-white/10 text-slate-400 hover:border-poke-accent/50'
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
            'flex-1 py-2 px-3 rounded-lg text-sm font-bold border bg-surface text-slate-200 focus:outline-none transition-all',
            selectedMonth
              ? 'border-poke-accent text-white'
              : 'border-white/10 text-slate-400'
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
            className="px-3 py-2 rounded-lg text-sm font-bold text-slate-400 border border-white/10 hover:text-slate-200 transition-colors"
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
                : 'bg-white/5 border border-white/10 text-slate-400 hover:border-white/20'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Weekly AI summary */}
      <div className="poke-card p-4 space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-sm font-black text-slate-100 flex items-center gap-1.5">
            <Sparkles className="w-4 h-4 text-poke-accent" />
            本週 AI 摘要
          </h3>
          <button
            onClick={handleGenerateSummary}
            disabled={summaryLoading}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-poke-accent/15 text-poke-accent text-xs font-bold hover:bg-poke-accent/25 transition-colors disabled:opacity-40"
          >
            {summaryLoading
              ? <Loader2 className="w-3.5 h-3.5 animate-spin" />
              : <Sparkles className="w-3.5 h-3.5" />
            }
            {weeklySummary ? '重新產生' : '產生摘要'}
          </button>
        </div>
        {summaryError && (
          <p className="text-xs text-red-500 font-bold">產生摘要失敗，請稍後再試。</p>
        )}
        {weeklySummary && !summaryLoading && (
          <p className="text-sm text-slate-300 leading-relaxed whitespace-pre-line">{weeklySummary}</p>
        )}
        {!weeklySummary && !summaryLoading && !summaryError && (
          <p className="text-xs text-slate-500 italic">點擊「產生摘要」讓 AI 幫你總結本週的收支狀況</p>
        )}
      </div>

      {/* Income / Expense summary */}
      <div className="grid grid-cols-2 gap-4">
        <div className="poke-card p-4 border-l-4 border-l-poke-accent bg-gradient-to-br from-poke-accent/10 to-transparent">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <ArrowUpCircle className="w-4 h-4 text-poke-accent" />
            <span className="text-xs font-black uppercase tracking-wider">總收入</span>
          </div>
          <p className="text-xl font-black text-poke-accent">¥{totalIncome.toLocaleString()}</p>
        </div>
        <div className="poke-card p-4 border-l-4 border-l-slate-400">
          <div className="flex items-center gap-2 text-slate-400 mb-1">
            <ArrowDownCircle className="w-4 h-4 text-slate-400" />
            <span className="text-xs font-black uppercase tracking-wider">總支出</span>
          </div>
          <p className="text-xl font-black text-slate-100">¥{totalExpense.toLocaleString()}</p>
        </div>
      </div>

      {/* Expense split: Jay 已付 vs 待報銷 */}
      {totalExpense > 0 && (
        <div className="grid grid-cols-2 gap-4">
          <div className="poke-card p-4 border-l-4 border-l-emerald-400 bg-gradient-to-br from-emerald-500/10 to-transparent">
            <div className="flex items-center gap-2 text-emerald-300 mb-1">
              <Wallet className="w-4 h-4" />
              <span className="text-xs font-black uppercase tracking-wider">Jay 已付</span>
            </div>
            <p className="text-xl font-black text-emerald-300">¥{totalPaid.toLocaleString()}</p>
          </div>
          <div className={cn(
            'poke-card p-4 border-l-4',
            totalPending > 0 ? 'border-l-amber-400 bg-gradient-to-br from-amber-500/10 to-transparent' : 'border-l-white/10',
          )}>
            <div className={cn('flex items-center gap-2 mb-1', totalPending > 0 ? 'text-amber-300' : 'text-slate-400')}>
              <Clock className="w-4 h-4" />
              <span className="text-xs font-black uppercase tracking-wider">待報銷</span>
            </div>
            <p className={cn('text-xl font-black', totalPending > 0 ? 'text-amber-300' : 'text-slate-400')}>
              ¥{totalPending.toLocaleString()}
            </p>
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
                          isActive ? 'bg-poke-accent' : bucket.expense > 0 ? 'bg-poke-blue' : 'bg-white/10'
                        )}
                        style={{ height: bucket.expense > 0 ? `${Math.max(pct * 100, 4)}%` : '4%' }}
                      />
                    </div>
                    {bucket.income > 0 && (
                      <div className="w-full h-1 bg-blue-300 rounded-full mt-0.5" title={`+¥${bucket.income.toLocaleString()}`} />
                    )}
                    <span className={cn(
                      'text-[9px] font-bold mt-1 leading-none',
                      isActive ? 'text-poke-accent' : 'text-slate-400'
                    )}>{bucket.label}</span>
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-3 mt-2 pt-2 border-t border-white/10">
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
                {totals.expense > 0 && <p className="text-xs font-bold text-slate-300">-¥{totals.expense.toLocaleString()}</p>}
              </div>
            </div>
          ))}
          {expenses.length === 0 && (
            <div className="col-span-full text-center py-6 text-slate-400 text-sm italic bg-surface rounded-xl border-2 border-dashed border-white/10">
              尚無數據可顯示
            </div>
          )}
        </div>
      </div>

      {/* Series breakdown — Box only */}
      {seriesRows.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-sm font-black text-slate-400 uppercase tracking-widest px-1">世代卡包統計</h3>
          <div className="poke-card divide-y divide-white/10">
            {seriesRows.map(([code, totals]) => {
              const name = code !== '未標記' ? (CODE_NAME_MAP[code] ?? '') : '';
              const barPct = Math.round((totals.expense / maxSeriesExpense) * 100);
              return (
                <div key={code} className="px-4 py-3 flex items-center gap-3">
                  <div className="w-16 flex-shrink-0">
                    <span className="text-xs font-black text-poke-accent font-mono">{code}</span>
                    {name && <p className="text-[10px] text-slate-400 truncate">{name}</p>}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="h-2 bg-white/10 rounded-full overflow-hidden">
                      <div
                        className="h-full bg-poke-blue rounded-full transition-all duration-500"
                        style={{ width: `${barPct}%` }}
                      />
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right min-w-[5rem]">
                    {totals.expense > 0 && (
                      <p className="text-sm font-black text-slate-100">-¥{totals.expense.toLocaleString()}</p>
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
