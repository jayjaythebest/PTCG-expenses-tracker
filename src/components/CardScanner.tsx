import { useState, useRef } from 'react';
import { X, Camera, Loader2, CheckCircle, AlertCircle, Plus, ChevronDown } from 'lucide-react';
import { scanCard, CardScanResult } from '../lib/cardScanner';
import { useExpenses } from '../lib/useExpenses';
import { cn } from '../lib/utils';

interface ScannedItem {
  id: string;
  file: File;
  previewUrl: string;
  status: 'pending' | 'scanning' | 'done' | 'error';
  result: CardScanResult | null;
  title: string;
  amount: string;
  category: string;
  included: boolean;
}

interface Props {
  onClose: () => void;
}

const CATEGORIES = [
  { value: 'Card', label: '🃏 單張' },
  { value: 'Box', label: '📦 整盒' },
  { value: 'Tournament', label: '🏆 賽事' },
  { value: 'Other', label: '📌 其他' },
];

export function CardScanner({ onClose }: Props) {
  const { addExpense } = useExpenses();
  const [items, setItems] = useState<ScannedItem[]>([]);
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const isProcessing = scanning || saving;

  const update = (id: string, patch: Partial<ScannedItem>) =>
    setItems(prev => prev.map(it => (it.id === id ? { ...it, ...patch } : it)));

  const handleFiles = async (files: FileList) => {
    const incoming: ScannedItem[] = Array.from(files).map((file, i) => ({
      id: `${Date.now()}-${i}`,
      file,
      previewUrl: URL.createObjectURL(file),
      status: 'pending',
      result: null,
      title: '',
      amount: '',
      category: 'Card',
      included: true,
    }));

    // Append immediately so user sees the queue
    setItems(prev => [...prev, ...incoming]);
    setScanning(true);

    // Process sequentially to stay within Gemini rate limits
    for (const item of incoming) {
      update(item.id, { status: 'scanning' });
      try {
        const result = await scanCard(item.file);
        update(item.id, {
          status: 'done',
          result,
          title: result.name ?? '',
        });
      } catch {
        update(item.id, { status: 'error' });
      }
    }

    setScanning(false);
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files?.length) handleFiles(e.target.files);
    e.target.value = '';
  };

  const handleSubmit = async () => {
    const toAdd = items.filter(it => it.included && it.title.trim() && it.amount);
    if (!toAdd.length) return;
    setSaving(true);
    try {
      const today = new Date().toISOString();
      // Sequential so Supabase storage uploads don't collide
      for (const item of toAdd) {
        const notes = [item.result?.setCode?.toUpperCase(), item.result?.cardNumber]
          .filter(Boolean).join(' · ');
        await addExpense(
          { title: item.title.trim(), amount: Number(item.amount), type: 'Expense', category: item.category, date: today, notes },
          item.file,
        );
      }
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setSaving(false);
    }
  };

  const hasItems = items.length > 0;
  const doneCount = items.filter(it => it.status === 'done' || it.status === 'error').length;
  const readyCount = items.filter(it => it.included && it.title.trim() && it.amount).length;

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/40 backdrop-blur-sm"
        onClick={!isProcessing ? onClose : undefined}
      />

      {/* Sheet */}
      <div className="relative bg-notion-bg rounded-t-2xl shadow-2xl flex flex-col max-h-[92dvh]">
        {/* Handle */}
        <div className="shrink-0 flex justify-center pt-3 pb-1">
          <div className="w-9 h-1 rounded-full bg-notion-border" />
        </div>

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 py-2.5 border-b border-notion-border">
          <div>
            <h2 className="font-semibold text-notion-text text-base">掃描卡片</h2>
            {hasItems && (
              <p className="text-[11px] text-notion-muted mt-0.5">
                {scanning
                  ? `辨識中… ${doneCount} / ${items.length}`
                  : `共 ${items.length} 張完成辨識`}
              </p>
            )}
          </div>
          <button onClick={!isProcessing ? onClose : undefined} className="p-2 -mr-2 text-notion-muted disabled:opacity-30">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {!hasItems ? (
            /* Empty state */
            <div className="flex flex-col items-center justify-center py-16 px-8 gap-5">
              <div className="w-20 h-20 rounded-3xl bg-notion-bg2 flex items-center justify-center">
                <Camera className="w-10 h-10 text-notion-muted" />
              </div>
              <div className="text-center">
                <p className="font-semibold text-notion-text text-base">拍照或選擇卡片圖片</p>
                <p className="text-sm text-notion-muted mt-1.5 leading-relaxed">
                  可一次選多張，Gemini 會逐張辨識卡名與系列編號
                </p>
              </div>
              <button
                onClick={() => fileInputRef.current?.click()}
                className="px-7 py-3 bg-poke-blue text-white rounded-xl font-semibold text-sm shadow-lg shadow-poke-blue/20"
              >
                選擇照片
              </button>
            </div>
          ) : (
            /* Card list */
            <div className="divide-y divide-notion-border">
              {items.map(item => (
                <ScanRow
                  key={item.id}
                  item={item}
                  onUpdate={patch => update(item.id, patch)}
                />
              ))}

              {/* Add more photos row */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={isProcessing}
                className="w-full flex items-center gap-2.5 px-4 py-3.5 text-notion-muted text-sm disabled:opacity-40 active:bg-notion-hover transition-colors"
              >
                <div className="w-6 h-6 rounded-full border-2 border-dashed border-notion-border flex items-center justify-center">
                  <Plus className="w-3 h-3" />
                </div>
                繼續新增照片
              </button>
            </div>
          )}
        </div>

        {/* Footer CTA */}
        {hasItems && (
          <div className="shrink-0 px-4 pt-3 border-t border-notion-border">
            <button
              onClick={handleSubmit}
              disabled={isProcessing || readyCount === 0}
              className="w-full py-4 rounded-2xl font-semibold text-base flex items-center justify-center gap-2 bg-poke-blue text-white shadow-lg shadow-poke-blue/20 disabled:opacity-40 active:scale-[0.98] transition-all"
            >
              {saving
                ? <Loader2 className="w-5 h-5 animate-spin" />
                : scanning
                  ? <><Loader2 className="w-4 h-4 animate-spin" />辨識中…</>
                  : `新增 ${readyCount} 筆記錄`}
            </button>
            <div className="pb-safe" />
          </div>
        )}
      </div>

      <input
        type="file"
        ref={fileInputRef}
        accept="image/*"
        multiple
        className="hidden"
        onChange={handleFileChange}
      />
    </div>
  );
}

/* ─── Individual card row ─── */

function ScanRow({ item, onUpdate }: { item: ScannedItem; onUpdate: (p: Partial<ScannedItem>) => void }) {
  const imgSrc = item.result?.cardImageUrl ?? item.previewUrl;

  return (
    <div className={cn('p-4 transition-opacity', !item.included && 'opacity-40')}>
      <div className="flex gap-3">
        {/* Thumbnail with status overlay */}
        <div className="w-[52px] h-[72px] rounded-lg overflow-hidden bg-notion-bg2 shrink-0 relative">
          <img src={imgSrc} alt="card" className="w-full h-full object-cover" />
          {item.status === 'scanning' && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <Loader2 className="w-5 h-5 text-white animate-spin" />
            </div>
          )}
          {item.status === 'error' && (
            <div className="absolute inset-0 bg-black/50 flex items-center justify-center">
              <AlertCircle className="w-5 h-5 text-red-400" />
            </div>
          )}
        </div>

        {/* Form fields */}
        <div className="flex-1 min-w-0 flex flex-col gap-2">
          {/* Status badge */}
          <div className="flex items-center gap-1.5 h-4">
            {item.status === 'scanning' && (
              <span className="text-[10px] text-notion-muted">辨識中…</span>
            )}
            {item.status === 'error' && (
              <><AlertCircle className="w-3 h-3 text-red-500" /><span className="text-[10px] text-red-500">辨識失敗，請手動輸入</span></>
            )}
            {item.status === 'done' && (
              <>
                <CheckCircle className="w-3 h-3 text-green-500 shrink-0" />
                <span className="text-[10px] text-notion-muted truncate">
                  {[item.result?.setCode?.toUpperCase(), item.result?.cardNumber].filter(Boolean).join(' · ') || '辨識完成'}
                </span>
              </>
            )}
          </div>

          {/* Card name */}
          <input
            type="text"
            placeholder="卡片名稱"
            value={item.title}
            onChange={e => onUpdate({ title: e.target.value })}
            disabled={item.status === 'scanning'}
            className="w-full text-sm font-medium text-notion-text bg-notion-bg2 rounded-lg px-2.5 py-1.5 outline-none placeholder:text-notion-border disabled:opacity-50 focus:ring-1 focus:ring-poke-blue/30"
          />

          {/* Amount + category row */}
          <div className="flex gap-2">
            <div className="flex items-center bg-notion-bg2 rounded-lg px-2.5 py-1.5 flex-1 min-w-0">
              <span className="text-xs text-notion-muted mr-0.5 shrink-0">¥</span>
              <input
                type="number"
                inputMode="numeric"
                placeholder="金額"
                value={item.amount}
                onChange={e => onUpdate({ amount: e.target.value })}
                className="flex-1 text-sm text-notion-text bg-transparent outline-none w-0 min-w-0 placeholder:text-notion-border"
              />
            </div>

            <div className="relative shrink-0">
              <select
                value={item.category}
                onChange={e => onUpdate({ category: e.target.value })}
                className="appearance-none bg-notion-bg2 rounded-lg pl-2.5 pr-6 py-1.5 text-xs text-notion-text outline-none"
              >
                {CATEGORIES.map(c => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
              <ChevronDown className="w-3 h-3 text-notion-muted absolute right-1.5 top-1/2 -translate-y-1/2 pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Include toggle */}
        <button
          onClick={() => onUpdate({ included: !item.included })}
          className="shrink-0 self-center ml-1"
          aria-label={item.included ? '排除此筆' : '加入此筆'}
        >
          <div className={cn(
            'w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all',
            item.included
              ? 'bg-poke-blue border-poke-blue'
              : 'border-notion-border bg-transparent'
          )}>
            {item.included && <div className="w-2 h-2 rounded-full bg-white" />}
          </div>
        </button>
      </div>
    </div>
  );
}
