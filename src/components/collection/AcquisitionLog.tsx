import { motion } from 'motion/react';
import { X, Trash2, CalendarPlus } from 'lucide-react';
import { CollectionItem } from '../../types';
import { cn } from '../../lib/utils';
import { logTotal, logDrift, type AcquisitionLog as Log } from '../../lib/acquisitions';
import { ItemTypeBadge, unitLabel } from './constants';

const pretty = (iso: string) => (iso ? iso.replace(/-/g, '/') : '日期不詳');

// 入手紀錄 — the arrivals behind one row's quantity.
//
// A tile saying ×4 hides the thing the user actually wanted recorded: two boxes
// in August and two more in September are two purchases, not one holding of
// four. Each line here is one arrival, newest first.
export function AcquisitionLog({
  item,
  log,
  onDeleteEntry,
  busy = false,
}: {
  item: CollectionItem;
  log: Log;
  // Absent (the read-only build, or a ledger that is only synthesised) = no
  // delete affordance. Removing an arrival also takes its copies off the row,
  // so the caller owns both writes.
  onDeleteEntry?: (entryId: string, quantity: number) => void;
  busy?: boolean;
}) {
  const unit = unitLabel(item.itemType);
  const total = logTotal(log.rows);
  const drift = logDrift(item, log);

  return (
    <div className="space-y-2">
      <div className="space-y-1.5">
        {log.rows.map((r, idx) => (
          <div
            key={r.id}
            className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-3 py-2"
          >
            <span className="shrink-0 w-5 text-[10px] font-black text-slate-600 tabular-nums">
              {log.rows.length - idx}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-bold text-slate-100 tabular-nums">{pretty(r.date)}</span>
              {idx === log.rows.length - 1 && log.rows.length > 1 && (
                <span className="block text-[10px] text-slate-500">最初入手</span>
              )}
            </span>
            <span className="shrink-0 text-[13px] font-black text-poke-accent whitespace-nowrap">
              +{r.quantity} {unit}
            </span>
            {/* The last remaining arrival isn't deletable: removing it would
                leave a card whose ledger says it was never acquired. Deleting
                the card itself is the action for that. */}
            {onDeleteEntry && !log.legacy && log.rows.length > 1 && (
              <button
                type="button"
                disabled={busy}
                onClick={() => onDeleteEntry(r.id, r.quantity)}
                title="刪除這筆入手紀錄"
                className="shrink-0 p-1 rounded-lg text-slate-500 hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-baseline justify-between gap-3 px-1">
        <span className="text-[11px] font-bold text-slate-500">
          {log.legacy ? '目前數量' : `${log.rows.length} 次入手 · 合計`}
        </span>
        <span className="text-[13px] font-black text-slate-100">×{log.legacy ? item.quantity : total}</span>
      </div>

      {/* The quantity field is editable on its own, so the two CAN disagree.
          Say so rather than showing a total that contradicts the tile. */}
      {drift !== 0 && (
        <p className="text-[11px] text-amber-400 leading-relaxed">
          紀錄合計 ×{total}，與目前數量 ×{item.quantity} 不符
          （{drift > 0 ? '多' : '少'} {Math.abs(drift)} {unit}）。手動改過數量就會這樣，改紀錄或改數量都可以對回來。
        </p>
      )}

      {log.legacy && (
        <p className="text-[11px] text-slate-500 leading-relaxed">
          這筆是從卡片的入手日期推算的，還沒有逐筆紀錄。之後再新增同一個商品並選擇「合併」，
          每一次的日期和數量就會分開記在這裡。
        </p>
      )}
    </div>
  );
}

// The 入手紀錄 button on a tile opens this — the ledger on its own, without the
// detour through the full detail sheet.
export function AcquisitionLogModal({
  item,
  log,
  onDeleteEntry,
  onClose,
  busy = false,
}: {
  item: CollectionItem;
  log: Log;
  onDeleteEntry?: (entryId: string, quantity: number) => void;
  onClose: () => void;
  busy?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-[55] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-sm bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface border-b border-white/10 px-5 py-4 flex items-start justify-between gap-2 z-10">
          <div className="min-w-0">
            <h2 className="font-black text-lg text-slate-100 leading-tight flex items-center gap-1.5">
              <CalendarPlus className="w-4 h-4 text-poke-accent shrink-0" /> 入手紀錄
            </h2>
            <p className="mt-0.5 text-[12px] text-slate-400 truncate flex items-center gap-1.5">
              <ItemTypeBadge type={item.itemType} />
              <span className="truncate">{item.name}</span>
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className={cn('p-5')}>
          <AcquisitionLog item={item} log={log} onDeleteEntry={onDeleteEntry} busy={busy} />
        </div>
      </motion.div>
    </div>
  );
}
