import { motion } from 'motion/react';
import { X, Pencil, Trash2, TrendingUp, TrendingDown, Loader2, RefreshCw } from 'lucide-react';
import { CollectionItem } from '../../types';
import { cn, relativeTime } from '../../lib/utils';
import {
  CONDITION_LABELS, EDITION_LABELS, GRADING_LABELS, setLabel, isGradedCondition, ItemTypeBadge,
} from './constants';
import { GalleryImage } from './GalleryImage';

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  if (value == null || value === '') return null;
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 border-b border-white/5 last:border-0">
      <span className="text-[11px] font-bold text-slate-500 shrink-0">{label}</span>
      <span className="text-[13px] font-bold text-slate-200 text-right break-all">{value}</span>
    </div>
  );
}

// Tapping a card in the gallery opens this: the artwork big enough to actually
// look at, the details that don't fit on a tile, and the per-card actions.
// 「更新價格」 here re-prices JUST this card — the bulk refresh walks every
// priceable item one request at a time, which is a long wait when you only
// care about the card you're looking at.
export function CardDetailModal({
  item,
  estTwd,
  est,
  diff,
  diffPct,
  onClose,
  onEdit,
  onDelete,
  onReprice,
  pricing,
  priceMsg,
}: {
  item: CollectionItem;
  estTwd: number | null;
  est: { amount: number; currency: 'JPY' | 'TWD' } | null;
  diff: number | null;
  diffPct: number | null;
  onClose: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onReprice: () => void;
  pricing: boolean;
  priceMsg: { ok: boolean; text: string } | null;
}) {
  const graded = item.isGraded
    ? `${item.gradingCompany ? GRADING_LABELS[item.gradingCompany] : '鑑定'}${item.grade ? ` ${item.grade}` : ''}`
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-md bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface border-b border-white/10 px-5 py-4 flex items-center justify-between gap-2 z-10">
          <h2 className="font-black text-lg text-slate-100 leading-tight line-clamp-2">{item.name}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors shrink-0">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <div className="p-5 space-y-4">
          {/* Enlarged artwork */}
          <div className="relative mx-auto w-full max-w-[260px] aspect-[3/4] rounded-xl overflow-hidden bg-white/5 border border-white/10">
            <GalleryImage item={item} />
          </div>

          <div className="flex items-center justify-center gap-1.5 flex-wrap">
            <ItemTypeBadge type={item.itemType} />
            {item.edition && (
              <span className="text-[10px] font-bold text-sky-300 bg-sky-500/15 px-1.5 py-0.5 rounded-full">
                {EDITION_LABELS[item.edition]}
              </span>
            )}
            {item.rarity && (
              <span className="text-[10px] font-bold text-violet-300 bg-violet-500/15 px-1.5 py-0.5 rounded-full">
                {item.rarity}
              </span>
            )}
            {graded && (
              <span className="text-[10px] font-black text-amber-700 bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-300 px-1.5 py-0.5 rounded-full">
                {graded}
              </span>
            )}
          </div>

          {/* Current value */}
          <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[11px] font-bold text-slate-500">目前價值</span>
              {diffPct != null && (
                <span className={cn(
                  'inline-flex items-center gap-0.5 text-[11px] font-black',
                  diffPct >= 0 ? 'text-emerald-500' : 'text-red-400',
                )}>
                  {diffPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                  {diffPct >= 0 ? '+' : ''}{diffPct.toFixed(1)}%
                  {diff != null && (
                    <span className="ml-1 font-bold">
                      ({diff >= 0 ? '+' : ''}NT${Math.round(diff).toLocaleString()})
                    </span>
                  )}
                </span>
              )}
            </div>
            <p className="mt-0.5 text-2xl font-black text-slate-100">
              {estTwd != null ? `NT$${estTwd.toLocaleString()}` : '—'}
              {estTwd != null && est?.currency === 'JPY' && (
                <span className="ml-1 text-xs font-normal text-slate-400">
                  (¥{Math.round(est.amount).toLocaleString()})
                </span>
              )}
            </p>
            {item.marketPrice != null && (
              <p className="mt-1 text-[11px] text-slate-400">
                {[
                  item.marketPriceSource === 'manual' ? '手動輸入' : item.marketPriceSource,
                  relativeTime(item.marketPriceUpdatedAt),
                  item.marketPriceCondition
                    ? (!item.isGraded && isGradedCondition(item.marketPriceCondition)
                        ? `${item.marketPriceCondition} 參考`
                        : item.marketPriceCondition)
                    : null,
                ].filter(Boolean).join(' · ')}
              </p>
            )}
            {estTwd == null && (
              <p className="mt-1 text-[11px] text-slate-500">
                還沒有價格。按「更新價格」試著抓一次，抓不到就會維持空白。
              </p>
            )}
          </div>

          {/* Details */}
          <div className="rounded-xl bg-white/5 border border-white/10 px-4 py-2">
            <DetailRow label="系列" value={item.setName ? setLabel(item.setName) : null} />
            <DetailRow label="卡號" value={item.cardNumber} />
            <DetailRow label="數量" value={item.quantity > 1 ? `×${item.quantity}` : null} />
            {!item.isGraded && (
              <DetailRow label="卡況" value={item.condition ? CONDITION_LABELS[item.condition] : null} />
            )}
            <DetailRow label="鑑定編號" value={item.gradingCert} />
            <DetailRow label="入手日" value={item.acquiredDate?.replace(/-/g, '/')} />
            <DetailRow
              label="當初估價"
              value={item.currentValue != null ? `¥${Math.round(item.currentValue).toLocaleString()}` : null}
            />
            <DetailRow label="備註" value={item.notes} />
          </div>
        </div>

        {/* Actions. Sticky: artwork + details is taller than the sheet on a
            phone, and the whole point of opening a card is to act on it — the
            buttons must not sit below the fold. */}
        <div className="sticky bottom-0 bg-surface border-t border-white/10 px-5 py-3 space-y-2">
            <button
              onClick={onReprice}
              disabled={pricing}
              className={cn(
                'w-full inline-flex items-center justify-center gap-2 py-2.5 rounded-xl font-black text-sm transition-colors',
                pricing
                  ? 'bg-poke-accent/10 text-poke-accent/70 cursor-wait'
                  : 'bg-poke-accent/20 text-poke-accent hover:bg-poke-accent/30',
              )}
            >
              {pricing
                ? <><Loader2 className="w-4 h-4 animate-spin" /> 查詢中…</>
                : <><RefreshCw className="w-4 h-4" /> 更新價格</>}
            </button>
            {priceMsg && (
              <p className={cn(
                'text-[11px] font-bold text-center',
                priceMsg.ok ? 'text-emerald-400' : 'text-amber-400',
              )}>
                {priceMsg.text}
              </p>
            )}
            <div className="grid grid-cols-2 gap-2">
              <button
                onClick={onEdit}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10 font-bold text-sm transition-colors"
              >
                <Pencil className="w-4 h-4" /> 編輯資訊
              </button>
              <button
                onClick={onDelete}
                className="inline-flex items-center justify-center gap-1.5 py-2.5 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 hover:bg-red-500/20 font-bold text-sm transition-colors"
              >
                <Trash2 className="w-4 h-4" /> 刪除卡片
              </button>
            </div>
        </div>
      </motion.div>
    </div>
  );
}
