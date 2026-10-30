// Collection value over time, for the Home hero: a 週 / 月 / 年 range toggle,
// the change over that range (split into new purchases vs. market movement),
// and a line with its amounts and dates labelled. Hover — or tap / arrow keys —
// reads out any day's value.
import { useMemo, useState } from 'react';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { CollectionItem, CollectionValueSnapshot } from '../types';
import { valueChange, localDay } from '../lib/collectionValue';
import { cn } from '../lib/utils';

type RangeId = 'week' | 'month' | 'year';

const RANGES: { id: RangeId; label: string; days: number; span: string }[] = [
  { id: 'week', label: '週', days: 7, span: '近 7 日' },
  { id: 'month', label: '月', days: 30, span: '近 30 日' },
  { id: 'year', label: '年', days: 365, span: '近 1 年' },
];

const RANGE_KEY = 'home.valueRange';
const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];
const DAY = 24 * 60 * 60 * 1000;

const nt = (n: number) => `NT$${Math.round(n).toLocaleString()}`;
// Axis labels: 萬 keeps them short enough to sit inside the plot.
const ntShort = (n: number) => (n >= 10000 ? `NT$${(n / 10000).toFixed(1)}萬` : nt(n));
const signed = (n: number, fmt: (x: number) => string) => `${n >= 0 ? '+' : '−'}${fmt(Math.abs(n))}`;

const dayNum = (iso: string) => {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY;
};
function dateLabel(iso: string, withYear: boolean): string {
  const [y, m, d] = iso.split('-').map(Number);
  return withYear ? `${y}/${m}/${d}` : `${m}/${d}`;
}
function weekday(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number);
  return WEEKDAYS[new Date(y, m - 1, d).getDay()];
}

function readRange(): RangeId {
  try {
    const v = localStorage.getItem(RANGE_KEY);
    if (v === 'week' || v === 'month' || v === 'year') return v;
  } catch {
    // storage unavailable (private mode etc.) — fall through to the default
  }
  return 'month';
}

interface Point { date: string; total: number; count: number }

export function ValueChart({ snapshots, items, liveTotalTwd, itemCount, fxRate }: {
  snapshots: CollectionValueSnapshot[];
  items: CollectionItem[];
  liveTotalTwd: number;
  itemCount: number;
  fxRate: number;
}) {
  const [rangeId, setRangeId] = useState<RangeId>(readRange);
  const [hover, setHover] = useState<number | null>(null);
  const range = RANGES.find(r => r.id === rangeId)!;
  const now = useMemo(() => new Date(), []);
  const today = localDay(now);

  const change = useMemo(
    () => valueChange(snapshots, items, liveTotalTwd, fxRate, now, range.days),
    [snapshots, items, liveTotalTwd, fxRate, now, range.days],
  );

  // The line runs from the baseline the change is measured against to today,
  // whose point is the live total rather than the (possibly stale) stored row.
  const points: Point[] = useMemo(() => {
    if (!change) return [];
    const past = snapshots
      .filter(s => s.date >= change.from && s.date < today)
      .sort((a, b) => a.date.localeCompare(b.date))
      .map(s => ({ date: s.date, total: s.totalTwd, count: s.itemCount }));
    return [...past, { date: today, total: liveTotalTwd, count: itemCount }];
  }, [snapshots, change, today, liveTotalTwd, itemCount]);

  const pick = (id: RangeId) => {
    setRangeId(id);
    setHover(null);
    try { localStorage.setItem(RANGE_KEY, id); } catch { /* per-viewer nicety only */ }
  };

  if (!change || points.length < 2) {
    return <p className="mt-2 text-xs font-bold text-white/60">持續記錄中，多記幾天即可比較變動</p>;
  }

  const up = change.diff >= 0;
  const market = change.diff - change.added;
  // A series younger than the range starts at its first day, and says so.
  const short = change.days < range.days;
  const crossesYear = points[0].date.slice(0, 4) !== today.slice(0, 4);

  // Geometry, in a 0–100 box: x by calendar day (gaps stay gaps), y padded so
  // the line never touches the labels.
  const x0 = dayNum(points[0].date);
  const xSpan = Math.max(1, dayNum(today) - x0);
  const totals = points.map(p => p.total);
  const lo = Math.min(...totals);
  const hi = Math.max(...totals);
  const pad = (hi - lo || hi * 0.05 || 1) * 0.15;
  const yLo = lo - pad;
  const yHi = hi + pad;
  const xs = points.map(p => ((dayNum(p.date) - x0) / xSpan) * 100);
  const ys = points.map(p => 100 - ((p.total - yLo) / (yHi - yLo)) * 100);
  const line = xs.map((x, i) => `${x},${ys[i]}`).join(' ');
  const area = `0,100 ${line} 100,100`;
  const yOf = (v: number) => 100 - ((v - yLo) / (yHi - yLo)) * 100;

  const stroke = up ? '#34d399' : '#f87171'; // emerald-400 / red-400 on the blue card
  // The axis's middle label sits at 50% width, so it names the calendar
  // midpoint, not the middle snapshot (snapshots can have gaps).
  const midDate = new Date((x0 + Math.round(xSpan / 2)) * DAY).toISOString().slice(0, 10);

  const hoverAt = (clientX: number, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    const fx = Math.min(1, Math.max(0, (clientX - r.left) / r.width)) * 100;
    let best = 0;
    xs.forEach((x, i) => { if (Math.abs(x - fx) < Math.abs(xs[best] - fx)) best = i; });
    setHover(best);
  };
  const h = hover != null ? points[hover] : null;

  return (
    <div className="mt-2">
      {/* Change over the selected range */}
      <div className="flex items-center gap-2 flex-wrap">
        <span className={cn(
          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-black bg-white/15',
          up ? 'text-emerald-200' : 'text-red-200',
        )}>
          {up ? <TrendingUp className="w-3.5 h-3.5" /> : <TrendingDown className="w-3.5 h-3.5" />}
          {signed(change.diff, nt)}（{signed(change.pct, x => `${x.toFixed(1)}%`)}）
        </span>
        <span className="text-xs font-bold text-white/60">
          {short ? `自 ${dateLabel(change.from, crossesYear)} 起（最早的紀錄）` : range.span}
        </span>
      </div>
      <p className="mt-1 text-xs font-bold text-white/60">
        {dateLabel(change.from, crossesYear)} {nt(points[0].total)} → 今天 {nt(liveTotalTwd)}
      </p>
      {change.added > 0 && (
        <p className="mt-0.5 text-xs font-bold text-white/60">
          新增收藏 <span className="text-white/90">+{nt(change.added)}</span>
          {' · '}市價變動 <span className="text-white/90">{signed(market, nt)}</span>
        </p>
      )}

      {/* Range toggle */}
      <div role="tablist" aria-label="圖表期間" className="mt-3 inline-flex rounded-lg bg-white/10 p-0.5">
        {RANGES.map(r => (
          <button
            key={r.id}
            role="tab"
            aria-selected={r.id === rangeId}
            onClick={() => pick(r.id)}
            className={cn(
              'px-3 py-1 rounded-md text-xs font-black transition-colors',
              r.id === rangeId ? 'bg-white text-poke-dark-blue' : 'text-white/70 hover:text-white',
            )}
          >
            {r.label}
          </button>
        ))}
      </div>

      {/* Plot */}
      <div
        className="relative mt-2 h-32 select-none touch-pan-y outline-none focus-visible:ring-2 focus-visible:ring-white/60 rounded"
        tabIndex={0}
        role="img"
        aria-label={`收藏總值 ${range.span}：${dateLabel(change.from, crossesYear)} ${nt(points[0].total)}，今天 ${nt(liveTotalTwd)}`}
        onPointerMove={e => hoverAt(e.clientX, e.currentTarget)}
        onPointerDown={e => hoverAt(e.clientX, e.currentTarget)}
        onPointerLeave={() => setHover(null)}
        onKeyDown={e => {
          if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
          e.preventDefault();
          const cur = hover ?? points.length - 1;
          setHover(Math.min(points.length - 1, Math.max(0, cur + (e.key === 'ArrowRight' ? 1 : -1))));
        }}
        onBlur={() => setHover(null)}
      >
        {/* High / low reference lines with their amounts. Each label goes on the
            side away from its own extreme, so it never sits on the line. */}
        {[hi, lo].map((v, i) => {
          const at = xs[totals.indexOf(v)];
          return (
            <div key={i} className="absolute inset-x-0 pointer-events-none" style={{ top: `${yOf(v)}%` }}>
              <div className="border-t border-dashed border-white/20" />
              <span className={cn(
                'absolute pb-0.5 text-[10px] font-bold text-white/60 tabular-nums',
                at < 50 ? 'right-0' : 'left-0',
                i === 0 ? '-translate-y-full' : '',
              )}>
                {i === 0 ? '高 ' : '低 '}{ntShort(v)}
              </span>
            </div>
          );
        })}

        <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="absolute inset-0 w-full h-full overflow-visible" aria-hidden>
          <defs>
            <linearGradient id="value-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={stroke} stopOpacity={0.25} />
              <stop offset="100%" stopColor={stroke} stopOpacity={0} />
            </linearGradient>
          </defs>
          <polygon points={area} fill="url(#value-fill)" />
          <polyline points={line} fill="none" stroke={stroke} strokeWidth={2}
            vectorEffect="non-scaling-stroke" strokeLinejoin="round" strokeLinecap="round" />
        </svg>

        {/* Today's end point */}
        <div className="absolute w-2 h-2 -ml-1 -mt-1 rounded-full ring-2 ring-poke-dark-blue pointer-events-none"
          style={{ left: '100%', top: `${ys[ys.length - 1]}%`, background: stroke }} />

        {/* Crosshair + readout */}
        {h && hover != null && (
          <>
            <div className="absolute inset-y-0 w-px bg-white/40 pointer-events-none" style={{ left: `${xs[hover]}%` }} />
            <div className="absolute w-2.5 h-2.5 -ml-[5px] -mt-[5px] rounded-full bg-white ring-2 ring-poke-dark-blue pointer-events-none"
              style={{ left: `${xs[hover]}%`, top: `${ys[hover]}%` }} />
            <div
              className="absolute top-0 z-10 rounded-lg bg-slate-900/95 px-2.5 py-1.5 text-[11px] leading-tight shadow-lg pointer-events-none whitespace-nowrap"
              style={{
                left: `${xs[hover]}%`,
                transform: `translateX(${xs[hover] > 65 ? '-100%' : xs[hover] < 35 ? '0' : '-50%'})`,
              }}
            >
              <div className="font-bold text-white/70">
                {h.date === today ? '今天' : `${dateLabel(h.date, crossesYear)}（${weekday(h.date)}）`}
              </div>
              <div className="font-black text-white tabular-nums">{nt(h.total)}</div>
              <div className="text-white/60">{h.count} 張</div>
            </div>
          </>
        )}
      </div>

      {/* Date axis */}
      <div className="mt-1 flex justify-between text-[10px] font-bold text-white/60 tabular-nums">
        <span>{dateLabel(points[0].date, crossesYear)}</span>
        {xSpan >= 2 && <span>{dateLabel(midDate, crossesYear)}</span>}
        <span>今天</span>
      </div>
    </div>
  );
}
