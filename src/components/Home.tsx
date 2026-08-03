import { useEffect, useMemo } from 'react';
import { useExpenses } from '../lib/useExpenses';
import { useCollection } from '../lib/useCollection';
import { useValueSnapshots } from '../lib/useValueSnapshots';
import { useFxRateWithMeta } from '../lib/useFxRate';
import {
  totalCurrentTwd, totalItemCount, totalPnlTwd,
  topMoversTwd, topMoversByHistory, type ValueMover,
} from '../lib/collectionValue';
import { usePriceHistory } from '../lib/usePriceHistory';
import { inMonth } from '../lib/utils';
import { Expense } from '../types';
import {
  TrendingUp, TrendingDown, Wallet, Clock, Sparkles,
  ClipboardList, BarChart2, Star, ChevronRight, Layers, ArrowUpDown,
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

// Compact zh-TW relative time for the FX "更新於 …" note.
function relativeTime(iso: string | null): string | null {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  return `${Math.floor(hrs / 24)} 天前`;
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
  const { points: pricePoints, recordToday: recordPrices } = usePriceHistory();
  const { rate: fxRate, updatedAt: fxUpdatedAt } = useFxRateWithMeta();

  const now = new Date();
  const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dateLabel = `${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 · 週${WEEKDAYS[now.getDay()]}`;

  // ---- Collection value (TWD) ----
  const liveTotalTwd = useMemo(() => totalCurrentTwd(items, fxRate), [items, fxRate]);
  const itemCount = useMemo(() => totalItemCount(items), [items]);
  const pnl = useMemo(() => totalPnlTwd(items, fxRate), [items, fxRate]);
  // Prefer real recorded history ("這張卡近 N 日漲跌"). Until the history table
  // has a day older than today to compare against, fall back to the static
  // 現估價 baseline so the card still says something useful — the subtitle makes
  // clear which of the two is on screen.
  const moverWindow = useMemo(
    () => topMoversByHistory(items, pricePoints, fxRate, { days: 7, limit: 3 }),
    [items, pricePoints, fxRate],
  );
  const estimateMovers = useMemo(() => topMoversTwd(items, fxRate, 3), [items, fxRate]);
  const movers = moverWindow && moverWindow.movers.length > 0 ? moverWindow.movers : estimateMovers;
  const moversFromHistory = Boolean(moverWindow && moverWindow.movers.length > 0);

  // Record/refresh today's snapshot once the live value is known, so history
  // accrues even between daily cron runs and reflects newly added cards.
  useEffect(() => {
    if (!colLoading && liveTotalTwd > 0) recordToday(liveTotalTwd, itemCount);
  }, [colLoading, liveTotalTwd, itemCount, recordToday]);

  // Same idea per card, so tomorrow's comparison has a baseline even if the
  // daily cron never ran.
  useEffect(() => {
    if (!colLoading && items.length > 0) recordPrices(items, fxRate);
  }, [colLoading, items, fxRate, recordPrices]);

  // ---- Change vs. an earlier snapshot ----
  // Prefer a true 7-day baseline; when history is younger, fall back to the
  // oldest snapshot we have (labelled "近 N 日") so the hero isn't blank for a
  // week. Needs ≥2 snapshots to have any baseline to compare against.
  const weekChange = useMemo(() => {
    if (snapshots.length < 2) return null;
    const asc = [...snapshots].sort((a, b) => a.date.localeCompare(b.date));
    const cutoff = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    // Most recent snapshot on/before 7 days ago, else the oldest one we have.
    const baseline = [...asc].reverse().find(s => s.date <= cutoff) ?? asc[0];
    if (!baseline || baseline.totalTwd <= 0) return null;
    const days = Math.max(
      1,
      Math.round((now.getTime() - new Date(baseline.date).getTime()) / (24 * 60 * 60 * 1000)),
    );
    const diff = liveTotalTwd - baseline.totalTwd;
    return { diff, pct: (diff / baseline.totalTwd) * 100, days };
  }, [snapshots, liveTotalTwd, now]);

  // Label for the change window: exactly 7 → "近 7 日變動", otherwise "近 N 日變動".
  const changeLabel = weekChange ? `近 ${weekChange.days} 日變動` : '近 7 日變動';

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

        {/* Value change vs. an earlier snapshot */}
        <div className="mt-2 flex items-center gap-2 flex-wrap">
          {weekChange ? (
            <>
              <span className={cn(
                'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black bg-white/15',
                weekChange.diff >= 0 ? 'text-emerald-200' : 'text-red-200',
              )}>
                {weekChange.diff >= 0 ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
                {weekChange.diff >= 0 ? '+' : '−'}{nt(Math.abs(weekChange.diff))}
                （{weekChange.diff >= 0 ? '+' : '−'}{Math.abs(weekChange.pct).toFixed(1)}%）
              </span>
              <span className="text-xs font-bold text-white/60">{changeLabel}</span>
            </>
          ) : (
            <span className="text-xs font-bold text-white/60">持續記錄中，多記幾天即可比較變動</span>
          )}
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

        {/* FX rate used for TWD conversion + when it was fetched */}
        <p className="mt-2 text-[10px] text-white/50">
          JPY→TWD {fxRate.toFixed(4)}
          {fxUpdatedAt ? `（更新於 ${relativeTime(fxUpdatedAt)}）` : ''}
        </p>
      </button>

      {/* Biggest value movers — only worth a card once something has actually moved */}
      {movers.length > 0 && (
        <div className="poke-card p-5">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-black text-slate-100 flex items-center gap-1.5">
              <ArrowUpDown className="w-4 h-4 text-poke-accent" /> 價值變動 TOP {movers.length}
            </h2>
            <button
              onClick={() => onNavigate('collection')}
              className="text-xs font-bold text-poke-accent flex items-center gap-0.5 hover:opacity-80"
            >
              看收藏庫 <ChevronRight className="w-3.5 h-3.5" />
            </button>
          </div>
          <p className="text-xs text-slate-400 mt-0.5">
            {moversFromHistory
              ? `近 ${moverWindow?.days} 日市價漲跌幅最大的項目`
              : '市價相對你的現估價（每日價格記錄累積中）'}
          </p>

          <ol className="mt-3 space-y-2">
            {movers.map((m, idx) => (
              <MoverRow key={m.id} mover={m} rank={idx + 1} />
            ))}
          </ol>
        </div>
      )}

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

// One row of the 價值變動 TOP 3 list. Shows the percentage swing (what the list
// is ranked by) as the headline, with the money amount underneath — the percent
// alone would make a ¥50 card look as important as a ¥5,000 one.
function MoverRow({ mover, rank }: { mover: ValueMover; rank: number }) {
  const up = mover.diff >= 0;
  const sign = up ? '+' : '−';
  return (
    <li className="flex items-center gap-3 rounded-xl bg-white/5 border border-white/10 p-2.5">
      <span className="shrink-0 w-5 text-center text-xs font-black text-slate-500">{rank}</span>

      {mover.imageUrl ? (
        <img
          src={mover.imageUrl}
          alt=""
          loading="lazy"
          className="shrink-0 w-8 h-11 rounded object-cover bg-white/5"
        />
      ) : (
        <span className="shrink-0 w-8 h-11 rounded bg-white/5 border border-white/10 flex items-center justify-center">
          <Layers className="w-3.5 h-3.5 text-slate-500" />
        </span>
      )}

      <div className="min-w-0 flex-1">
        <p className="text-sm font-bold text-slate-100 truncate">{mover.name}</p>
        <p className="text-[11px] text-slate-400 truncate">
          {mover.setName || '未知系列'}
          {mover.quantity > 1 ? ` · ${mover.quantity} 張` : ''}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className={cn('text-sm font-black', up ? 'text-emerald-400' : 'text-red-400')}>
          {sign}{Math.abs(mover.pct).toFixed(1)}%
        </p>
        <p className="text-[11px] font-bold text-slate-400">
          {sign}{nt(Math.abs(mover.diff))}
        </p>
      </div>
    </li>
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
