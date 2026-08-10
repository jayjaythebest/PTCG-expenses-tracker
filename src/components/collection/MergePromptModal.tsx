import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { CollectionItem } from '../../types';
import { EDITION_LABELS, setLabel } from './constants';
import { type FormState } from './formState';

// Asked before an add that would duplicate something already in the collection:
// merge into that row (3 boxes + 2 = 5) instead of leaving two rows for the same
// product. Sits ON TOP of the still-open add form, so cancelling drops the user
// back into it with their input intact — and keeping them separate stays one tap
// away, because tracking two purchases apart is a legitimate thing to want.
export function MergePromptModal({
  incoming,
  candidates,
  onMerge,
  onKeepSeparate,
  onClose,
  submitting,
}: {
  incoming: FormState;
  candidates: CollectionItem[];
  onMerge: (target: CollectionItem) => void;
  onKeepSeparate: () => void;
  onClose: () => void;
  submitting: boolean;
}) {
  const label = incoming.name.trim() || (incoming.setName ? setLabel(incoming.setName) : '這筆收藏');
  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-md bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between">
          <h2 className="font-black text-lg text-slate-100">收藏庫已經有這個了</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="p-5 space-y-3">
          <p className="text-[13px] text-slate-300 leading-relaxed">
            <span className="font-bold text-slate-100">{label}</span> 已經在收藏庫裡了。
            要把這次新增的 <span className="font-bold text-poke-accent">×{incoming.quantity}</span> 併進現有的那筆，還是另外存成新的一筆？
          </p>
          <div className="space-y-2">
            {candidates.map(c => (
              <button
                key={c.id}
                type="button"
                disabled={submitting}
                onClick={() => onMerge(c)}
                className="w-full flex items-center justify-between gap-3 text-left rounded-xl border border-white/10 bg-white/5 px-3.5 py-3 hover:border-poke-accent/60 hover:bg-white/10 transition-colors disabled:opacity-50"
              >
                <span className="min-w-0">
                  <span className="block text-[13px] font-bold text-slate-100 truncate">
                    {c.name}{c.cardNumber ? ` #${c.cardNumber}` : ''}
                  </span>
                  <span className="block text-[11px] text-slate-500">
                    {[c.edition ? EDITION_LABELS[c.edition] : null, c.setName ? setLabel(c.setName) : null,
                      c.acquiredDate ? `入手 ${c.acquiredDate.replace(/-/g, '/')}` : null]
                      .filter(Boolean).join(' · ')}
                  </span>
                </span>
                <span className="shrink-0 text-[13px] font-black text-poke-accent whitespace-nowrap">
                  {c.quantity} → {c.quantity + incoming.quantity}
                </span>
              </button>
            ))}
          </div>
          {/* Merging only moves the quantity — say so, because the date and the
              price of the row being merged into are the ones that survive. */}
          <p className="text-[11px] text-slate-500 leading-relaxed">
            合併只會增加數量，保留現有那筆的入手日期與估價；這次填的其他欄位不會寫入。
          </p>
          <div className="flex gap-2 pt-1">
            <button
              type="button"
              disabled={submitting}
              onClick={onKeepSeparate}
              className="flex-1 rounded-lg border border-white/10 py-2.5 text-sm font-bold text-slate-300 hover:border-white/25 hover:text-slate-100 transition-colors disabled:opacity-50"
            >
              {submitting ? '處理中...' : '另存成新的一筆'}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-300 transition-colors"
            >
              取消
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
