import { useEffect, useMemo } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { useCollection } from '../lib/useCollection';
import { useValueSnapshots } from '../lib/useValueSnapshots';
import { useFxRate } from '../lib/useFxRate';
import { totalCurrentTwd, totalItemCount, totalPnlTwd } from '../lib/collectionValue';
import { inMonth } from '../lib/utils';
import { Expense } from '../types';
import {
  TrendingUp, TrendingDown, Wallet, Clock, Sparkles,
  ClipboardList, BarChart2, Star, ChevronRight, Layers,
} from 'lucide-react';
import { cn } from '../lib/utils';

type Tab = 'record' | 'analysis' | 'collection';

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

function greeting(h: number): string {
  if (h < 5) return '夜深了';
  if (h < 12) return '早安';
  if (h < 18) return '午安';
  return '晚安';
}

function nt(n: number): string {
  return `NT$${Math.round(n).toLocaleString()}`;
}

function yen(n: number): string {
  return `¥${Math.round(n).toLocaleString()}`;
}

// A minimal stock-ticker sparkline over the recent value snapshots.
function Sparkline({ values, up }: { values: number[]; up: boolean }) {
  if (values.length < 2) return null;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 100},${100 - ((v - min) / range) * 100}`)
    .join(' ');
  const stroke = up ? '#34d399' : '#f87171'; // emerald-400 / red-400
  return (
    <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="w-full h-12" aria-hidden>
      <polyline points={pts} fill="none" stroke={stroke} strokeWidth={3}
        vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

function isExpense(e: Expense): boolean {
  return e.type === 'Expense' || !e.type;
}

export function Home({ onNavigate }: { onNavigate: (tab: Tab) => void }) {
  const { expenses } = useExpenses();
  const { items, loading: colLoading } = useCollection();
  const { snapshots, recordToday } = useValueSnapshots();
  const fxRate = useFxRate();

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dateLabel = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 週${WEEKDAYS[now.getDay()]}`;

  // ---- Collection value (TWD) ----
  const liveTotalTwd = useMemo(() => totalCurrentTwd(items, fxRate), [items, fxRate]);
  const itemCount = useMemo(() => totalItemCount(items), [items]);
  const pnl = useMemo(() => totalPnlTwd(items, fxRate), [items, fxRate]);

  // Record/refresh today's snapshot once the live value is known, so history
  // accrues even between daily cron runs and reflects newly added cards.
  useEffect(() => {
    if (!colLoading && liveTotalTwd > 0) recordToday(liveTotalTwd, itemCount);
  }, [colLoading, liveTotalTwd, itemCount, recordToday]);

  // ---- Week-over-week change from snapshots ----
  // Baseline = the most recent snapshot dated on/before 7 days ago. When none
  // is that old yet, we're still building history — show a gentle notice.
  const weekChange = useMemo(() => {
    if (snapshots.length === 0) return null;
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const baseline = [...snapshots].reverse().find(s => s.date <= cutoff);
    if (!baseline || baseline.totalTwd <= 0) return null;
    const diff = liveTotalTwd - baseline.totalTwd;
    return { diff, pct: (diff / baseline.totalTwd) * 100 };
  }, [snapshots, liveTotalTwd, now]);

  const sparkVals = useMemo(() => snapshots.slice(-30).map(s => s.totalTwd), [snapshots]);

  // ---- This-month expenses (¥, matching the record/analysis pages) ----
  const monthExpenses = expenses.filter(e => inMonth(e.date, thisMonth));
  const monthExpenseTotal = monthExpenses
    .filter(isExpense)
    .reduce((s, e) => s + Number(e.amount) * (e.quantity ?? 1), 0);
  const monthIncomeTotal = monthExpenses
    .filter(e => e.type === 'Income')
    .reduce((s, e) => s + Number(e.amount) * (e.quantity ?? 1), 0);
  const monthPending = monthExpenses
    .filter(e => isExpense(e) && e.paymentStatus === 'pending')
    .reduce((s, e) => s + Number(e.amount) * (e.quantity ?? 1), 0);
  const monthCount = monthExpenses.length;

  const valueUp = weekChange ? weekChange.diff >= 0 : pnl.diff >= 0;

  return (
    <div className="space-y-5 mb-8 max-w-lg mx-auto">
      {/* Greeting */}
      <div className="pt-1">
        <h1 className="text-2xl font-black text-slate-100">{greeting(now.getHours())}，歡迎回來 👋</h1>
        <p className="text-sm text-slate-400 mt-0.5">{dateLabel}</p>
      </div>

      {/* Collection value hero — stock-ticker style */}
      <button
        onClick={() => onNavigate('collection')}
        className="w-full text-left rounded-2xl p-5 bg-gradient-to-br from-poke-blue to-poke-dark-blue text-white shadow-lg shadow-poke-blue/20 active:scale-[0.99] transition-transform"
      >
        <div className="flex items-center justify-between">
          <span className="text-xs font-black uppercase tracking-widest text-white/70 flex items-center gap-1.5">
            <Layers className="w-3.5 h-3.5" /> 收藏現估總值
          </span>
          <ChevronRight className="w-4 h-4 text-white/60" />
        </div>
        <p className="text-4xl font-black mt-1 tracking-tight">{nt(liveTotalTwd)}</p>

        {/* Weekly change */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {weekChange ? (
            <span className={cn(
              'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black bg-white/15',
              weekChange.diff >= 0 ? 'text-emerald-200' : 'text-red-200',
            )}>
              {weekChange.diff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
              {weekChange.diff >= 0 ? '+' : '−'}{nt(Math.abs(weekChange.diff))}
              （{weekChange.diff >= 0 ? '+' : '−'}{Math.abs(weekChange.pct).toFixed(1)}%）
            </span>
          ) : (
            <span className="text-xs font-bold text-white/60">近 7 日 · 持續記錄中，一週後即可比較</span>
          )}
          <span className="text-xs font-bold text-white/60">近 7 日變動</span>
        </div>

        {/* Sparkline */}
        {sparkVals.length >= 2 && (
          <div className="mt-3 -mx-1">
            <Sparkline values={sparkVals} up={valueUp} />
          </div>
        )}

        {/* Secondary stats */}
        <div className="mt-3 pt-3 border-t border-white/15 flex items-center gap-4 text-xs">
          <span className="text-white/70">
            收藏 <b className="text-white font-black">{itemCount}</b> 張
          </span>
          {pnl.base > 0 && (
            <span className="text-white/70">
              帳面損益{' '}
              <b className={cn('font-black', pnl.diff >= 0 ? 'text-emerald-200' : 'text-red-200')}>
                {pnl.diff >= 0 ? '+' : '−'}{nt(Math.abs(pnl.diff))}（{pnl.diff >= 0 ? '+' : '−'}{Math.abs(pnl.pct).toFixed(1)}%）
              </b>
            </span>
          )}
        </div>
      </button>

      {/* This-month expense summary */}
      <div className="poke-card p-5">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-black text-slate-100 flex items-center gap-1.5">
            <Wallet className="w-4 h-4 text-poke-accent" /> 本月支出
          </h2>
          <button
            onClick={() => onNavigate('analysis')}
            className="text-xs font-bold text-poke-accent flex items-center gap-0.5 hover:opacity-80"
          >
            看分析 <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
        <p className="text-3xl font-black text-slate-100 mt-1">{yen(monthExpenseTotal)}</p>
        <p className="text-xs text-slate-400 mt-0.5">本月共 {monthCount} 筆記錄</p>

        <div className="grid grid-cols-2 gap-3 mt-4">
          <div className="rounded-xl bg-poke-accent/10 border border-poke-accent/20 p-3">
            <div className="flex items-center gap-1.5 text-poke-accent mb-0.5">
              <TrendingUp className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black uppercase tracking-wider">本月收入</span>
            </div>
            <p className="text-lg font-black text-poke-accent">{yen(monthIncomeTotal)}</p>
          </div>
          <div className={cn(
            'rounded-xl p-3 border',
            monthPending > 0
              ? 'bg-amber-500/10 border-amber-500/20'
              : 'bg-white/5 border-white/10',
          )}>
            <div className={cn('flex items-center gap-1.5 mb-0.5', monthPending > 0 ? 'text-amber-300' : 'text-slate-400')}>
              <Clock className="w-3.5 h-3.5" />
              <span className="text-[10px] font-black uppercase tracking-wider">待報銷</span>
            </div>
            <p className={cn('text-lg font-black', monthPending > 0 ? 'text-amber-300' : 'text-slate-400')}>
              {yen(monthPending)}
            </p>
          </div>
        </div>
      </div>

      {/* Quick actions */}
      <div>
        <h3 className="text-xs font-black text-slate-400 uppercase tracking-widest px-1 mb-2">快速功能</h3>
        <div className="grid grid-cols-3 gap-3">
          <QuickAction icon={<ClipboardList className="w-5 h-5" />} label="記帳" onClick={() => onNavigate('record')} />
          <QuickAction icon={<BarChart2 className="w-5 h-5" />} label="支出分析" onClick={() => onNavigate('analysis')} />
          <QuickAction icon={<Star className="w-5 h-5" />} label="收藏庫" onClick={() => onNavigate('collection')} />
        </div>
      </div>

      {/* Empty-state nudge */}
      {items.length === 0 && expenses.length === 0 && (
        <div className="text-center py-6 text-slate-400 text-sm bg-surface rounded-xl border-2 border-dashed border-white/10">
          <Sparkles className="w-5 h-5 mx-auto mb-1.5 text-poke-accent" />
          還沒有任何記錄，點「記帳」或「收藏庫」開始吧！
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="flex flex-col items-center justify-center gap-2 py-4 rounded-2xl bg-surface border border-white/10 text-slate-300 hover:border-poke-accent/50 hover:text-poke-accent active:scale-95 transition-all"
    >
      <span className="text-poke-accent">{icon}</span>
      <span className="text-xs font-black">{label}</span>
    </button>
  );
}
