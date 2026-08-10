import { motion } from 'motion/react';
import { X } from 'lucide-react';
import { cn } from '../lib/utils';

// In-app replacement for window.confirm().
//
// The native dialog is a different visual language from everything else here
// (system chrome, English buttons on some browsers, no room to explain what is
// about to happen) and on iOS Safari it can be suppressed entirely — which would
// silently turn "確認刪除" into "delete without asking". This renders in the app's
// own style, sits above any open modal, and lets the destructive action be
// coloured as destructive.
//
// Deliberately NOT a drop-in for confirm(): it can't block, so callers hold the
// pending action in state and run it from onConfirm.
export function ConfirmDialog({
  title,
  message,
  confirmLabel = '確定',
  cancelLabel = '取消',
  destructive = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  message: React.ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    // z-[70]: above the card detail sheet (z-50) and the merge prompt (z-[60]),
    // both of which can be the thing that opened this.
    <div className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/60" onClick={busy ? undefined : onCancel} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-sm bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl"
      >
        <div className="px-5 py-4 border-b border-white/10 flex items-center justify-between gap-2">
          <h2 className="font-black text-lg text-slate-100">{title}</h2>
          <button
            onClick={onCancel}
            disabled={busy}
            className="p-1.5 rounded-lg hover:bg-white/10 transition-colors disabled:opacity-40"
          >
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-[13px] text-slate-300 leading-relaxed">{message}</p>
          <div className="flex gap-2">
            <button
              type="button"
              disabled={busy}
              onClick={onConfirm}
              className={cn(
                'flex-1 rounded-lg py-2.5 text-sm font-black transition-colors disabled:opacity-50',
                destructive
                  ? 'bg-red-500/15 border border-red-500/30 text-red-300 hover:bg-red-500/25'
                  : 'bg-poke-blue text-white hover:bg-poke-dark-blue',
              )}
            >
              {busy ? '處理中...' : confirmLabel}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={onCancel}
              className="px-4 py-2.5 text-sm font-bold text-slate-400 border border-white/10 rounded-lg hover:text-slate-200 hover:border-white/25 transition-colors disabled:opacity-50"
            >
              {cancelLabel}
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  );
}
