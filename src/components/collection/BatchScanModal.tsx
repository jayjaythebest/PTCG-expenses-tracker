// 批次掃描 — one photo of several cards, one review list, one insert.
//
// The single-card form reads a photo and fills itself in; this reads the same
// photo when it holds a whole batch of pulls and produces one row per card.
// Everything after the vision read is shared with the single scan
// (./resolveScan), so a card resolved here gets the same authoritative record,
// the same artwork and the same set name it would have got on its own.
//
// The review step is the point of the feature: six cards read at once means six
// chances to misread, so nothing is written until the user has seen each row
// next to the crop of the card it came from and ticked it.
import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { CollectionItem, CollectionCondition } from '../../types';
import { cn } from '../../lib/utils';
import { recognizeCardsFromPhoto, type ScannedCard } from '../../lib/gemini';
import { dedupeByBox, sortByPosition } from '../../lib/batchScan';
import { cropToDataUrl, loadImage } from '../../lib/imageCrop';
import { findMergeCandidates } from '../../lib/mergeCandidates';
import { X, Camera, Loader2, Sparkles, Check, RefreshCw, AlertTriangle, ImageOff } from 'lucide-react';
import { CONDITION_LABELS, EDITION_LABELS, setLabel } from './constants';
import { EMPTY_FORM, todayISO, formToItem, type FormState } from './formState';
import { resolveScan, scanErrorHint } from './resolveScan';

// What the container needs to write a row: the form, and whether the user chose
// to fold it into a card the collection already holds.
export interface BatchAddRow {
  form: FormState;
  mergeInto: CollectionItem | null;
}

interface Row {
  id: number;
  form: FormState;
  status: 'matched' | 'fallback';
  hint: string | null;
  /** Crop of this card out of the photo — the only way to match a row to a card. */
  thumb: string | null;
  include: boolean;
  /** Fold into `candidate` instead of inserting a new row. */
  merge: boolean;
  candidate: CollectionItem | null;
}

type Stage = 'pick' | 'scanning' | 'review' | 'error';

export function BatchScanModal({
  existing,
  onConfirm,
  onClose,
  submitting,
  progress,
}: {
  existing: CollectionItem[];
  onConfirm: (rows: BatchAddRow[]) => void;
  onClose: () => void;
  submitting: boolean;
  progress: { done: number; total: number } | null;
}) {
  const [stage, setStage] = useState<Stage>('pick');
  const [rows, setRows] = useState<Row[]>([]);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [provider, setProvider] = useState<string | null>(null);
  const [errorHint, setErrorHint] = useState<string | null>(null);
  const [errorDebug, setErrorDebug] = useState<string[] | null>(null);
  const [resolveProgress, setResolveProgress] = useState<{ done: number; total: number } | null>(null);
  const [acquiredDate, setAcquiredDate] = useState(todayISO());
  const [condition, setCondition] = useState<CollectionCondition | ''>('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);

  const pick = () => {
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
      fileInputRef.current.click();
    }
  };

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setStage('error');
      setErrorHint('圖片太大，請選擇小於 10MB 的圖片');
      setErrorDebug(null);
      return;
    }
    lastFileRef.current = file;
    setPhotoPreview(URL.createObjectURL(file));
    runBatch(file);
  };

  const runBatch = async (file: File) => {
    setStage('scanning');
    setRows([]);
    setErrorHint(null);
    setErrorDebug(null);
    setResolveProgress(null);
    try {
      const scan = await recognizeCardsFromPhoto(file);
      setProvider(scan.provider ?? null);
      if (scan.error) {
        setErrorHint(scanErrorHint(scan));
        setErrorDebug(scan.debug && scan.debug.length ? scan.debug : null);
        setStage('error');
        return;
      }
      const cards = sortByPosition(dedupeByBox(scan.cards));
      if (cards.length === 0) {
        setErrorHint('這張照片裡沒有讀到任何一張卡；請讓每張卡完整入鏡、不要重疊，或改用單張新增');
        setStage('error');
        return;
      }

      // Crop each card out of the photo once, up front: the review list's whole
      // job is letting the user see which card a row came from.
      let thumbs: (string | null)[] = cards.map(() => null);
      try {
        const img = await loadImage(file);
        thumbs = cards.map(c => cropToDataUrl(img, c.box));
      } catch {
        // No crops — rows fall back to the resolved artwork.
      }

      // Resolve one at a time. Each card can mean two or three lookups against
      // TCGdex / the TW site / the image proxies; firing a dozen at once at
      // scraped sources is how they start answering 429.
      setResolveProgress({ done: 0, total: cards.length });
      const out: Row[] = [];
      for (let i = 0; i < cards.length; i++) {
        out.push(await toRow(cards[i], i, thumbs[i]));
        setResolveProgress({ done: i + 1, total: cards.length });
        setRows([...out]);
      }
      setResolveProgress(null);
      setStage('review');
    } catch (err) {
      console.error(err);
      setErrorHint('AI 讀取失敗，請換張照片重試');
      setStage('error');
    }
  };

  const toRow = async (card: ScannedCard, i: number, thumb: string | null): Promise<Row> => {
    const resolved = await resolveScan(card);
    const form: FormState = {
      ...EMPTY_FORM,
      ...resolved.patch,
      acquiredDate,
      condition,
      quantity: '1',
    };
    // Same unambiguous-duplicate check the single add does, so a batch can't
    // quietly create a second row for a card already in the collection.
    const candidate = findMergeCandidates(existing, formToItem(form))[0] ?? null;
    return {
      id: i,
      form,
      status: resolved.status,
      hint: resolved.hint,
      thumb,
      include: true,
      merge: !!candidate,
      candidate,
    };
  };

  const patchRow = (id: number, patch: Partial<Row>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, ...patch } : r)));

  const patchForm = (id: number, patch: Partial<FormState>) =>
    setRows(rs => rs.map(r => (r.id === id ? { ...r, form: { ...r.form, ...patch } } : r)));

  // The shared date / condition apply to every row — they're the fields that are
  // the same for a whole batch of pulls, which is the point of adding them once.
  const applyDate = (v: string) => {
    setAcquiredDate(v);
    setRows(rs => rs.map(r => ({ ...r, form: { ...r.form, acquiredDate: v } })));
  };
  const applyCondition = (v: CollectionCondition | '') => {
    setCondition(v);
    setRows(rs => rs.map(r => ({ ...r, form: { ...r.form, condition: v } })));
  };

  const chosen = rows.filter(r => r.include);

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-2xl bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col"
      >
        <div className="sticky top-0 bg-surface border-b border-white/10 px-5 py-4 flex items-center justify-between z-10 rounded-t-2xl">
          <div>
            <h2 className="font-black text-lg text-slate-100">批次掃描</h2>
            <p className="text-[11px] text-slate-400">一張照片，一次加入多張卡</p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>

        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePick}
        />

        <div className="p-5 overflow-y-auto">
          {stage === 'pick' && (
            <div className="space-y-3">
              <button
                type="button"
                onClick={pick}
                className="w-full flex flex-col items-center justify-center gap-2 py-10 rounded-xl border-2 border-dashed border-white/10 text-slate-400 hover:border-poke-accent hover:text-poke-accent hover:bg-poke-accent/10 transition-colors"
              >
                <div className="flex items-center gap-2">
                  <Camera className="w-5 h-5" />
                  <Sparkles className="w-4 h-4" />
                </div>
                <span className="font-bold text-sm">選擇／拍一張含多張卡的照片</span>
              </button>
              <ul className="text-[11px] text-slate-400 leading-relaxed list-disc pl-4 space-y-0.5">
                <li>一次最多辨識 12 張，請讓每張卡完整入鏡、盡量不要重疊</li>
                <li>卡面要正面朝上、避開強烈反光；卡號與系列代號（左下角小字）看得清楚最準</li>
                <li>辨識後會逐張讓你確認，確認前不會寫入收藏</li>
              </ul>
            </div>
          )}

          {stage === 'scanning' && (
            <div className="py-10 flex flex-col items-center gap-3 text-slate-300">
              <Loader2 className="w-6 h-6 animate-spin text-poke-accent" />
              <p className="text-sm font-bold">
                {resolveProgress
                  ? `比對卡片資料庫 ${resolveProgress.done}/${resolveProgress.total}`
                  : 'AI 辨識中，多張卡需要久一點...'}
              </p>
              {photoPreview && (
                <img src={photoPreview} alt="" className="mt-2 max-h-40 rounded-lg border border-white/10" />
              )}
            </div>
          )}

          {stage === 'error' && (
            <div className="space-y-3">
              <div className="flex gap-3 p-3 rounded-lg bg-red-500/10 border border-red-500/30">
                <AlertTriangle className="w-4 h-4 text-red-300 shrink-0 mt-0.5" />
                <div className="min-w-0">
                  <p className="text-xs font-bold text-red-300">批次辨識沒有結果</p>
                  {errorHint && <p className="mt-0.5 text-[11px] text-red-300/80">{errorHint}</p>}
                  {errorDebug && (
                    <div className="mt-1 space-y-0.5">
                      {errorDebug.map((line, i) => (
                        <p key={i} className="font-mono text-[10px] leading-tight text-red-400/70 break-all">{line}</p>
                      ))}
                    </div>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => { if (lastFileRef.current) runBatch(lastFileRef.current); }}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-slate-300 hover:border-poke-accent hover:text-poke-accent transition-colors"
                >
                  <RefreshCw className="w-3.5 h-3.5" /> 重試
                </button>
                <button
                  type="button"
                  onClick={pick}
                  className="flex-1 inline-flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold bg-white/5 border border-white/10 text-slate-300 hover:border-poke-accent hover:text-poke-accent transition-colors"
                >
                  <Camera className="w-3.5 h-3.5" /> 換一張照片
                </button>
              </div>
            </div>
          )}

          {stage === 'review' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  辨識到 <span className="font-black text-slate-200">{rows.length}</span> 張
                  {provider && <span className="ml-1 text-slate-500">· {provider}</span>}
                </p>
                <button
                  type="button"
                  onClick={pick}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/5 border border-white/10 text-slate-400 hover:text-poke-accent hover:border-poke-accent transition-colors"
                >
                  <Camera className="w-3 h-3" /> 換一張照片
                </button>
              </div>

              {/* The two fields a batch of pulls shares. Everything else is per card. */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs font-bold text-slate-400 mb-1 block">入手日期（套用全部）</label>
                  <input
                    type="date"
                    value={acquiredDate}
                    onChange={e => applyDate(e.target.value)}
                    className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent"
                  />
                </div>
                <div>
                  <label className="text-xs font-bold text-slate-400 mb-1 block">狀態（套用全部）</label>
                  <select
                    value={condition}
                    onChange={e => applyCondition(e.target.value as CollectionCondition | '')}
                    className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent"
                  >
                    <option value="">未指定</option>
                    {(Object.keys(CONDITION_LABELS) as CollectionCondition[]).map(c => (
                      <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="space-y-2">
                {rows.map(row => (
                  <div
                    key={row.id}
                    className={cn(
                      'flex gap-3 p-2.5 rounded-xl border transition-colors',
                      !row.include
                        ? 'border-white/5 bg-white/[0.02] opacity-50'
                        : row.status === 'matched'
                          ? 'border-emerald-500/30 bg-emerald-500/5'
                          : 'border-amber-500/30 bg-amber-500/5',
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={row.include}
                      onChange={e => patchRow(row.id, { include: e.target.checked })}
                      className="mt-1 w-4 h-4 accent-poke-accent shrink-0"
                    />

                    {/* Left: the card as photographed. Right: the artwork that
                        will be stored — side by side, they make a wrong read
                        obvious at a glance. */}
                    <div className="flex gap-1.5 shrink-0">
                      {row.thumb
                        ? <img src={row.thumb} alt="" className="w-12 h-16 object-cover rounded-md border border-white/10 bg-white/5" />
                        : <div className="w-12 h-16 rounded-md border border-white/10 bg-white/5 flex items-center justify-center"><ImageOff className="w-4 h-4 text-slate-600" /></div>}
                      {row.form.imageUrl
                        ? <img src={row.form.imageUrl} alt="" referrerPolicy="no-referrer" className="w-12 h-16 object-contain rounded-md border border-white/10 bg-white/5" />
                        : <div className="w-12 h-16 rounded-md border border-dashed border-white/10 bg-white/5 flex items-center justify-center text-[9px] text-slate-500 text-center leading-tight px-0.5">無卡圖</div>}
                    </div>

                    <div className="min-w-0 flex-1">
                      <input
                        value={row.form.name}
                        onChange={e => patchForm(row.id, { name: e.target.value })}
                        placeholder="卡名"
                        className="w-full bg-transparent font-black text-sm text-slate-100 border-b border-transparent hover:border-white/10 focus:border-poke-accent focus:outline-none"
                      />
                      <p className="mt-0.5 text-[11px] text-slate-400 truncate">
                        {row.form.setName ? setLabel(row.form.setName) : '未知系列'}
                        {row.form.cardNumber ? ` · ${row.form.cardNumber}` : ''}
                        {row.form.rarity ? ` · ${row.form.rarity}` : ''}
                        {row.form.edition ? ` · ${EDITION_LABELS[row.form.edition]}` : ''}
                      </p>
                      {row.status === 'fallback' && row.hint && (
                        <p className="mt-0.5 text-[10px] text-amber-300/80 leading-snug">{row.hint}</p>
                      )}
                      {row.candidate && (
                        <label className="mt-1 flex items-center gap-1.5 text-[10px] text-sky-300/90">
                          <input
                            type="checkbox"
                            checked={row.merge}
                            onChange={e => patchRow(row.id, { merge: e.target.checked })}
                            className="w-3 h-3 accent-sky-400"
                          />
                          收藏中已有這張（{row.candidate.quantity} 張）— 合併數量，不另開一筆
                        </label>
                      )}

                      <div className="mt-1.5 flex items-center gap-2">
                        <label className="text-[10px] text-slate-500">數量</label>
                        <input
                          type="text"
                          inputMode="numeric"
                          value={row.form.quantity}
                          onChange={e => patchForm(row.id, { quantity: e.target.value.replace(/\D/g, '') })}
                          placeholder="1"
                          className="w-12 border border-white/10 bg-white/5 rounded-md px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-poke-accent"
                        />
                        <label className="text-[10px] text-slate-500 ml-1">現估價 ¥</label>
                        <input
                          type="number"
                          min={0}
                          value={row.form.currentValue}
                          onChange={e => patchForm(row.id, { currentValue: e.target.value })}
                          placeholder="0"
                          className="w-20 border border-white/10 bg-white/5 rounded-md px-2 py-1 text-xs text-slate-100 focus:outline-none focus:border-poke-accent"
                        />
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <p className="text-[11px] text-slate-500 leading-relaxed">
                卡名可以直接改；系列、卡號等其他欄位加入後在卡片上「編輯」就能修。
                完全讀錯的那張先取消勾選，再用「新增」單張補上即可。
              </p>
            </div>
          )}
        </div>

        {stage === 'review' && (
          <div className="sticky bottom-0 bg-surface border-t border-white/10 px-5 py-3 flex gap-2">
            <button
              type="button"
              disabled={submitting || chosen.length === 0}
              onClick={() => onConfirm(chosen.map(r => ({ form: r.form, mergeInto: r.merge ? r.candidate : null })))}
              className="flex-1 flex items-center justify-center gap-2 bg-poke-blue text-white rounded-lg py-2.5 text-sm font-bold hover:bg-poke-dark-blue transition-colors disabled:opacity-50"
            >
              <Check className="w-4 h-4" />
              {submitting
                ? (progress ? `加入中 ${progress.done}/${progress.total}` : '加入中...')
                : `加入 ${chosen.length} 張`}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={submitting}
              className="px-4 py-2.5 text-sm font-bold text-slate-400 hover:text-slate-200 border border-white/10 rounded-lg hover:border-white/20 transition-colors disabled:opacity-50"
            >
              取消
            </button>
          </div>
        )}
      </motion.div>
    </div>
  );
}
