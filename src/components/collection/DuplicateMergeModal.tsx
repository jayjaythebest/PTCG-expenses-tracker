import { useState } from 'react';
import { motion } from 'motion/react';
import { X, Check } from 'lucide-react';
import { CollectionItem } from '../../types';
import { cn, relativeTime } from '../../lib/utils';
import { planMerge } from '../../lib/mergeCandidates';
import { CONDITION_LABELS, EDITION_LABELS, setLabel, displayType, ITEM_TYPE_LABELS } from './constants';

// The duplicate scan is a guess — it matches on name/set/version/condition, and
// two rows can legitimately be that similar without being the same thing (a
// re-print bought separately, a deliberate split the user wants kept). So the
// merge is offered per GROUP, not as one all-or-nothing button, and every group
// shows the rows it would fold together with their dates and prices — that is
// what the user needs in order to tell a real duplicate from a wrong call.
export function DuplicateMergeModal({
  groups,
  onMerge,
  onClose,
  submitting,
}: {
  groups: CollectionItem[][];
  onMerge: (groups: CollectionItem[][]) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  // Keyed by the surviving row's id — stable across a re-render, unlike an index.
  const keyOf = (g: CollectionItem[]) => planMerge(g)!.keep.id;
  // Pre-ticked: most of these are real, and unticking the odd wrong one is less
  // work than ticking every right one. The button says how many will be merged.
  const [picked, setPicked] = useState<Set<string>>(() => new Set(groups.map(keyOf)));

  const toggle = (key: string) => setPicked(prev => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  const chosen = groups.filter(g => picked.has(keyOf(g)));

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between shrink-0">
          <h2 className="font-black text-lg text-slate-100">合併重複的收藏</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-3 overflow-y-auto">
          <p className="text-[13px] text-slate-300 leading-relaxed">
            這幾組看起來是同一個商品被拆成好幾筆。核對一下再決定要合併哪幾組
            —— 沒勾的會維持原狀。
          </p>

          <div className="space-y-2">
            {groups.map(g => {
              const plan = planMerge(g)!;
              const key = plan.keep.id;
              const on = picked.has(key);
              const head = plan.keep;
              const meta = [
                head.edition ? EDITION_LABELS[head.edition] : null,
                ITEM_TYPE_LABELS[displayType(head.itemType)],
                head.setName ? setLabel(head.setName) : null,
                head.condition ? CONDITION_LABELS[head.condition] : null,
              ].filter(Boolean).join(' · ');

              return (
                <div
                  key={key}
                  className={cn(
                    'rounded-xl border px-3.5 py-3 transition-colors',
                    on ? 'border-poke-accent/60 bg-white/10' : 'border-white/10 bg-white/5',
                  )}
                >
                  <button
                    type="button"
                    disabled={submitting}
                    onClick={() => toggle(key)}
                    className="w-full flex items-center gap-3 text-left disabled:opacity-50"
                  >
                    <span className={cn(
                      'shrink-0 w-5 h-5 rounded-md border flex items-center justify-center transition-colors',
                      on ? 'bg-poke-accent border-poke-accent' : 'border-white/25',
                    )}>
                      {on && <Check className="w-3.5 h-3.5 text-black" strokeWidth={3} />}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-bold text-slate-100 truncate">
                        {head.name}{head.cardNumber ? ` #${head.cardNumber}` : ''}
                      </span>
                      <span className="block text-[11px] text-slate-500 truncate">{meta}</span>
                    </span>
                    <span className="shrink-0 text-[13px] font-black text-poke-accent whitespace-nowrap">
                      ×{plan.quantity}
                    </span>
                  </button>

                  {/* The rows being folded together, so a wrong match is
                      recognisable before it happens rather than after. */}
                  <div className="mt-2 pl-8 space-y-1">
                    {g.map(i => (
                      <div key={i.id} className="flex items-baseline gap-2 text-[11px]">
                        <span className={cn(
                          'font-black shrink-0',
                          i.id === plan.keep.id ? 'text-slate-300' : 'text-slate-500',
                        )}>
                          ×{i.quantity}
                        </span>
                        <span className="text-slate-500 truncate">
                          {[
                            i.acquiredDate ? `入手 ${i.acquiredDate.replace(/-/g, '/')}` : null,
                            i.marketPrice != null
                              ? `${i.marketPriceCurrency === 'TWD' ? 'NT$' : '¥'}${Math.round(i.marketPrice).toLocaleString()}`
                              : '無價格',
                            i.marketPrice != null
                              ? (i.marketPriceSource === 'manual' ? '手動' : relativeTime(i.marketPriceUpdatedAt))
                              : null,
                          ].filter(Boolean).join(' · ')}
                        </span>
                        {i.id === plan.keep.id && (
                          <span className="ml-auto shrink-0 text-[10px] font-black text-emerald-400">保留</span>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          {/* Say exactly what survives — the merge rewrites the quantity, the
              baseline and the price of the row that stays. */}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            合併後保留最早入手的那筆，數量相加，估價按數量加權平均，市價取各筆之中最新抓到的
            （手動填的優先）。其餘會移到「已刪除」，隨時可以還原。
          </p>
        </div>

        <div className="flex gap-2 px-5 py-4 border-t border-white/10 shrink-0">
          <button
            type="button"
            disabled={submitting || chosen.length === 0}
            onClick={() => onMerge(chosen)}
            className="flex-1 rounded-lg bg-poke-blue py-2.5 text-sm font-bold text-white hover:bg-poke-dark-blue transition-colors disabled:opacity-40"
          >
            {submitting ? '合併中...' : `合併 ${chosen.length} 組`}
          </button>
          <button
            type="button"
            disabled={submitting}
            onClick={onClose}
            className="px-4 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors disabled:opacity-50"
          >
            取消
          </button>
        </div>
      </motion.div>
    </div>
  );
}
