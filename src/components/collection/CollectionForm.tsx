// The add / edit form and the modal shell it lives in — the single biggest
// piece of the collection UI. Photo scan → AI read → TCGdex / TW-proxy
// resolution, plus every field the user can fill in by hand.
//
// Moved out of Collection.tsx verbatim; the container now only knows about
// CollectionModal and the FormState it hands back.
import { useState, useRef } from 'react';
import { motion } from 'motion/react';
import { CollectionItemType, CollectionCondition, CardEdition, GradingCompany } from '../../types';
import { cn } from '../../lib/utils';
import { recognizeCardFromPhoto } from '../../lib/gemini';
import { lookupCard, lookupTwCard, lookupSetImage, lookupTwCardImage, lookupJpCardImage } from '../../lib/tcgdex';
import { scanCardNumber } from '../../lib/cardNumber';
import { X, Check, Camera, Loader2, Sparkles, ImagePlus, ImageOff, RefreshCw } from 'lucide-react';
import {
  ITEM_TYPE_LABELS, CONDITION_LABELS, RARITY_OPTIONS, EDITION_LABELS, GRADING_LABELS,
  GRADE_OPTIONS, normalizeGradingCompany, SERIES_OPTIONS, SET_OPTIONS, seriesLabel, setLabel,
  SET_CODE_BY_NAME, productForScanCode, setOptionLabel, editionToLang, ItemTypeIcon, Thumb,
} from './constants';
import { type FormState } from './formState';

function CollectionForm({
  initial,
  onSubmit,
  onCancel,
  submitting,
}: {
  initial: FormState;
  onSubmit: (f: FormState) => void;
  onCancel: () => void;
  submitting: boolean;
}) {
  const [form, setForm] = useState<FormState>(initial);
  const [scanning, setScanning] = useState(false);
  const [scanResult, setScanResult] = useState<'matched' | 'fallback' | 'error' | null>(null);
  const [scanProvider, setScanProvider] = useState<string | null>(null);
  const [scanHint, setScanHint] = useState<string | null>(null);
  const [scanDebug, setScanDebug] = useState<string[] | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fetchingImg, setFetchingImg] = useState(false);
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastFileRef = useRef<File | null>(null);

  const set = (k: keyof FormState, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const filteredSets = SET_OPTIONS.filter(s => !form.series || s.series === form.series);

  const handleSeriesChange = (series: string) => {
    set('series', series);
    set('setName', '');
  };

  // Pull a representative image for the chosen set from TCGdex (logo, else a
  // card from that set). Used both by the manual button and auto for boxes/packs.
  const fetchSetImage = async (setName: string, edition: CardEdition | '') => {
    const code = SET_CODE_BY_NAME[setName];
    if (!code) {
      setImgMsg('這個系列沒有對應代號，請改用拍照或手動貼圖片網址');
      return;
    }
    setImgMsg(null);
    setFetchingImg(true);
    try {
      const result = await lookupSetImage(code, editionToLang(edition));
      if (result) {
        setForm(f => ({ ...f, imageUrl: result.imageUrl }));
        setImgMsg(result.kind === 'logo' ? '已帶入系列 logo' : '已帶入該系列代表卡圖');
      } else {
        setImgMsg('查無此系列圖片，可手動貼上圖片網址');
      }
    } catch {
      setImgMsg('取圖失敗，請稍後再試或手動貼網址');
    } finally {
      setFetchingImg(false);
    }
  };

  const handleSetNameChange = (setName: string) => {
    setForm(f => {
      const next = { ...f, setName };
      // For boxes the product name is optional — auto-fill it from the chosen set
      // (Chinese label preferred) when the user hasn't typed their own name yet.
      // "Their own" = anything other than the previously auto-filled set label,
      // so switching sets updates the name but a hand-typed name is preserved.
      if (f.itemType === 'box' && setName && setName !== '其他') {
        const prevAuto = f.setName ? setLabel(f.setName) : '';
        if (!f.name.trim() || f.name === prevAuto) next.name = setLabel(setName);
      }
      return next;
    });
    // For boxes, auto-grab a representative image when none is set yet.
    if (form.itemType === 'box' && !form.imageUrl && setName) {
      fetchSetImage(setName, form.edition);
    }
  };

  const handlePhotoScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      setScanResult('error');
      setScanHint('圖片太大，請選擇小於 10MB 的圖片');
      setScanDebug(null);
      return;
    }
    lastFileRef.current = file;
    setPhotoPreview(URL.createObjectURL(file));
    runScan(file);
  };

  const runScan = async (file: File) => {
    setScanResult(null);
    setScanProvider(null);
    setScanHint(null);
    setScanDebug(null);
    setScanning(true);
    try {
      // 1) The AI provider chain reads the reliable identifiers (language + set code + card number).
      const scan = await recognizeCardFromPhoto(file);
      setScanProvider(scan.provider ?? null);
      // 2) Resolve authoritative data (name/rarity/series/official art) from TCGdex,
      //    querying the endpoint that matches the detected language (falls back internally).
      const card = scan.setCode && scan.localId
        ? await lookupCard(scan.setCode, scan.localId, scan.language || 'ja', scan.name)
        : null;

      // Is this physically a Traditional-Chinese card? Trust the AI's language
      // read; a trailing-"F" MEGA/超級進化 code (M5F, M2aF) is itself a strong
      // zh-tw signal even if the AI misdetects the language. JP MEGA prints the
      // same code WITHOUT the F (M5, M2a), so this won't misfire on Japanese cards.
      const isZhTw = scan.language === 'zh-tw' || /^M\d+[A-Z]*F$/i.test(scan.setCode);

      // 2b) TCGdex's zh-tw catalog is incomplete (e.g. brand-new sets, the whole
      //     MEGA series). lookupCard cross-falls-back to the ja endpoint to find
      //     ANY data, which would mislabel a Chinese card as Japanese with JP
      //     name/art. When we have a confident zh-tw scan but no genuine zh-tw
      //     TCGdex hit, resolve the authoritative Chinese record (name + collector
      //     number + precise art) live from the official TW site via /api/tw-card
      //     — the always-current complete Chinese card table.
      const twCard = !scan.error && scan.setCode && scan.localId
        && isZhTw && (!card || card.edition !== 'zh-tw')
        ? await lookupTwCard(scan.setCode, scan.localId, scan.name)
        : null;

      // Map the scanned/printed set code back to a catalog product so we can
      // persist a setName even when TCGdex has no record. Without a stored
      // setName, price lookups can't resolve the pack and the row shows no price
      // (this was the zh-tw "no price" bug — the twCard/fallback branches never
      // set setName). Prefer the code the TW proxy resolved, else the AI's read.
      const prod = productForScanCode(twCard?.setCode || scan.setCode);

      if (twCard) {
        // Authoritative zh-tw record from the official TW site: Chinese name +
        // precise per-card art. The site carries no rarity letter, so keep the
        // rarity the AI read off the card. Treat as a confident match.
        setForm(f => {
          const setName = prod?.name || f.setName;
          return {
            ...f,
            name:       twCard.name    || scan.name || f.name,
            setName,
            series:     prod?.series   || f.series,
            rarity:     scan.rarity    || f.rarity,
            cardNumber: scanCardNumber(scan.localId, scan.setCode, setName) || twCard.localId || f.cardNumber,
            imageUrl:   twCard.imageUrl || f.imageUrl,
            edition:    'zh-tw',
          };
        });
        setScanResult('matched');
      } else if (card && !(isZhTw && card.edition !== 'zh-tw')) {
        // Only trust the TCGdex catalog record when it's NOT a Japanese record
        // standing in for a Chinese card. A zh-tw scan whose only TCGdex hit is
        // the ja catalog (the TW proxy failed to resolve the misread set/number)
        // must NOT adopt the Japanese name/set/art here — that produced the
        // "繁體中文版 but shows オリジンパルキアVSTAR / VMAXクライマックス" bug on
        // reflective graded slabs. Such cards fall through to the fallback branch
        // below, which keeps the AI's own Chinese read + resolves zh-tw artwork.
        const edition = (scan.language || card.edition) as CardEdition;
        // Pick artwork in the card's OWN language. For zh-tw, the official TW
        // proxy has precise per-card art (TCGdex often lacks zh-tw images). For
        // ja we must NOT use the TW proxy (it would show the Chinese version) —
        // use TCGdex's ja image, or the SNKRDUNK/Limitless proxy for brand-new
        // sets TCGdex hasn't published art for yet.
        let img = card.imageUrl;
        if (edition === 'zh-tw') {
          const tw = await lookupTwCardImage(scan.setCode, scan.localId);
          if (tw) img = tw;
        } else if (!img) {
          const jp = await lookupJpCardImage(scan.setCode, scan.localId);
          if (jp) img = jp;
        }
        setForm(f => {
          const setName = card.setName || prod?.name || f.setName;
          return {
            ...f,
            name:       card.name,
            setName,
            series:     card.series  || prod?.series || f.series,
            // TCGdex answers '其他' for any rarity name it hasn't mapped yet
            // (new MEGA marks such as MA arrive there late), so a read off the
            // card itself beats it — it is the printing, not a guess.
            rarity:     (card.rarity === '其他' ? scan.rarity : card.rarity) || scan.rarity || f.rarity,
            cardNumber: scanCardNumber(scan.localId, scan.setCode, setName) || f.cardNumber,
            imageUrl:   img || f.imageUrl,
            edition,
          };
        });
        setScanResult('matched');
      } else if (!scan.error && !isZhTw && scan.verified) {
        // A Japanese card the scan endpoint confirmed against Huca's live card
        // table. TCGdex has no record — its catalog trails a release by weeks —
        // but the set code, name and rarity are authoritative, so this is a
        // match, not a "card not found". Artwork still comes from the ja proxy.
        const img = (await lookupJpCardImage(scan.setCode, scan.localId)) || '';
        setForm(f => {
          // Prefer the catalog's set name (what verify:sets checks and what
          // pricing resolves against); Huca's own label covers a set so new the
          // catalog hasn't listed it either.
          const setName = prod?.name || scan.setName || f.setName;
          return {
            ...f,
            name:       scan.name || f.name,
            setName,
            series:     prod?.series || f.series,
            rarity:     scan.rarity || f.rarity,
            cardNumber: scanCardNumber(scan.localId, scan.setCode, setName) || f.cardNumber,
            imageUrl:   img || f.imageUrl,
            edition:    'ja',
          };
        });
        setScanResult('matched');
      } else if (scan.error) {
        // The AI chain couldn't run (quota exhausted / providers down / photo
        // unreadable) — nothing was read. Tell the user it's a service issue,
        // not that the card is unknown, so they don't assume the card is invalid.
        const provs = scan.providers ?? [];
        if (scan.reason === 'unauthorized') {
          // 401 from the JWT gate: the session token is missing/expired, so the
          // fix is re-logging in — waiting and retrying will never help.
          setScanHint('登入已過期，請重新登入後再掃描');
        } else if (scan.reason === 'auth_unconfigured') {
          // 503: the gate itself has no Supabase credentials on the server.
          setScanHint('伺服器缺少 Supabase 設定（SUPABASE_URL / KEY），請在 Vercel 補上後重新部署');
        } else if (scan.reason === 'endpoint_missing') {
          // 404: the /api/scan-card function isn't deployed on this host.
          setScanHint('找不到掃描服務（/api/scan-card 未部署）；請確認已部署最新版本到 Vercel');
        } else if (scan.reason === 'endpoint_error' || scan.reason === 'network') {
          // 5xx / crash / offline: the endpoint exists but couldn't respond.
          setScanHint('掃描服務暫時無法回應；請稍後重試，或查看 Vercel Functions 記錄');
        } else if (scan.reason === 'no_provider') {
          // 200 + explicit no_provider: the server ran but has zero AI keys.
          setScanHint('伺服器尚未設定任何 AI 金鑰，請在 Vercel 設定 GEMINI / GROQ / OPENROUTER_API_KEY');
        } else if (scan.reason === 'quota' || provs.length === 1) {
          setScanHint(`目前只有 ${provs.join('、') || 'gemini'} 可用，額度可能已用盡；建議在 Vercel 再補上 Groq / OpenRouter 免費金鑰`);
        } else {
          setScanHint('可換張更清晰、少反光的照片再試一次');
        }
        // Per-provider failure lines (gemini:error… / groq:invalid / …) so we can
        // see the real cause behind an "unreadable" instead of guessing.
        setScanDebug(scan.debug && scan.debug.length ? scan.debug : null);
        setScanResult('error');
      } else {
        // Fallback: TCGdex has no catalog entry for this card yet (common for
        // brand-new zh-tw sets — e.g. the MEGA/超級進化 "M#F" series isn't in
        // TCGdex's Chinese DB). The AI still read name/rarity/number reliably, so
        // keep those AND try to auto-fill the artwork so the row isn't blank.
        let img = '';
        if (scan.setCode && scan.localId) {
          if (isZhTw) {
            // Prefer genuine zh-tw art (official TW proxy).
            img = (await lookupTwCardImage(scan.setCode, scan.localId)) || '';
            // zh-tw MEGA sets print "M#F"; the JP equivalent is "M#" and shares
            // the identical illustration (only the text language differs), so use
            // it as a stand-in thumbnail when no TW art exists.
            if (!img && /^M\d+[A-Z]*F$/i.test(scan.setCode)) {
              const jpCode = scan.setCode.replace(/F$/i, '');
              img = (await lookupJpCardImage(jpCode, scan.localId)) || '';
            }
          } else {
            img = (await lookupJpCardImage(scan.setCode, scan.localId)) || '';
          }
        }
        setForm(f => {
          const setName = prod?.name || f.setName;
          return {
            ...f,
            name:       scan.name    || f.name,
            setName,
            series:     prod?.series || f.series,
            cardNumber: scanCardNumber(scan.localId, scan.setCode, setName) || f.cardNumber,
            rarity:     scan.rarity  || f.rarity,
            edition:    isZhTw ? 'zh-tw' : (scan.language || f.edition),
            imageUrl:   img || f.imageUrl,
          };
        });
        // Show WHAT was read, not just that the catalog missed. Secret rares are
        // the usual cause (TCGdex's zh-tw data stops at the official set total,
        // so a UR numbered past it can't match) — and without these identifiers
        // on screen there's no way to tell that apart from a genuine misread.
        setScanHint(
          `辨識為 ${scan.setCode || '?'} #${scan.localId || '?'}（${isZhTw ? '繁中' : scan.language || 'ja'}）`
          // A set the catalog knows means the code read fine and it's the card
          // table that's behind (new sets take weeks to appear) — quite different
          // from a code nothing recognises, which is usually a misread.
          + (prod
            ? '；卡片資料庫尚未收錄這個系列，已依卡面填入'
            : '；卡片資料庫查無此編號，請確認系列與卡號')
          + (img ? '' : '。找不到對應卡圖，請手動貼上圖片網址'),
        );
        setScanResult('fallback');
      }

      // Graded slab: the label carries the grading company + grade + cert. Apply
      // them on top of whichever branch resolved the card (matched/card/fallback)
      // so a scan of a PSA/BGS/… holder auto-fills the 鑑定 fields the user would
      // otherwise type by hand. A raw card leaves gradingCompany empty → no-op.
      const gc = normalizeGradingCompany(scan.gradingCompany);
      if (!scan.error && gc) {
        setForm(f => ({
          ...f,
          isGraded: true,
          gradingCompany: gc,
          grade: scan.grade || f.grade,
          gradingCert: scan.gradingCert || f.gradingCert,
        }));
      }
    } catch (err) {
      console.error(err);
      setScanResult('error');
      setScanHint('AI 讀取失敗，請手動輸入，或換張照片重試');
      setScanDebug(null);
    } finally {
      setScanning(false);
    }
  };

  return (
    <form
      className="space-y-3"
      onSubmit={e => { e.preventDefault(); onSubmit(form); }}
    >
      {/* Item type */}
      <div className="flex gap-2">
        {(['single', 'box'] as CollectionItemType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => setForm(f => ({
              ...f,
              itemType: t,
              // Default a box to the JA version (the only edition we auto-price)
              // when no version has been chosen yet.
              edition: t === 'box' && !f.edition ? 'ja' : f.edition,
            }))}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold border-2 transition-colors',
              form.itemType === t
                ? 'border-poke-accent bg-poke-accent/10 text-poke-accent'
                : 'border-white/10 text-slate-400 hover:border-white/20',
            )}
          >
            <ItemTypeIcon type={t} />
            {ITEM_TYPE_LABELS[t]}
          </button>
        ))}
      </div>

      {/* Photo scan — single only */}
      {form.itemType === 'single' && (
        <div>
          {/* No `capture` attribute: on mobile this lets the user pick from the
              photo library or files as well as taking a new photo (with
              `capture` set, iOS/Android jump straight to the camera). */}
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="hidden"
            onChange={handlePhotoScan}
          />
          <button
            type="button"
            disabled={scanning}
            onClick={() => { if (fileInputRef.current) { fileInputRef.current.value = ''; fileInputRef.current.click(); } }}
            className={cn(
              'w-full flex items-center justify-center gap-2 py-3 rounded-xl border-2 border-dashed font-bold text-sm transition-colors',
              scanning
                ? 'border-poke-accent/40 bg-poke-accent/10 text-poke-accent cursor-wait'
                : 'border-white/10 text-slate-400 hover:border-poke-accent hover:text-poke-accent hover:bg-poke-accent/10',
            )}
          >
            {scanning ? (
              <><Loader2 className="w-4 h-4 animate-spin" /><span>AI 辨識中...</span></>
            ) : (
              <><Camera className="w-4 h-4" /><Sparkles className="w-3.5 h-3.5" /><span>拍照 / 選圖，自動填入資料</span></>
            )}
          </button>
          {scanResult && !scanning && (
            <div className={cn(
              'mt-2 flex items-center gap-3 p-2 border rounded-lg',
              scanResult === 'matched'
                ? 'bg-emerald-500/10 border-emerald-500/30'
                : scanResult === 'error'
                  ? 'bg-red-500/10 border-red-500/30'
                  : 'bg-amber-500/10 border-amber-500/30',
            )}>
              <img
                src={scanResult === 'matched' && form.imageUrl ? form.imageUrl : (photoPreview ?? '')}
                alt="card"
                referrerPolicy="no-referrer"
                className="w-12 h-16 object-contain rounded-md border border-white/10 bg-white/5 flex-shrink-0"
              />
              <div className="min-w-0">
                <p className={cn(
                  'text-xs font-bold',
                  scanResult === 'matched'
                    ? 'text-emerald-300'
                    : scanResult === 'error'
                      ? 'text-red-300'
                      : 'text-amber-300',
                )}>
                  {scanResult === 'matched' && form.edition ? `（${EDITION_LABELS[form.edition]}）` : ''}
                  {scanResult === 'matched'
                    ? '已從卡片資料庫帶入正確資料，請確認後儲存'
                    : scanResult === 'error'
                      ? 'AI 暫時無法辨識（服務忙碌／額度用盡，或卡面反光太強）'
                      : '查無此卡，已填入可辨識的部分，請手動補完'}
                  {scanProvider && (
                    <span className="ml-1 font-medium text-slate-400">· {scanProvider}</span>
                  )}
                </p>
                {/* Both non-matched states need this. A "查無此卡" that shows no
                    identifiers gives the user nothing to correct and nothing to
                    report, and leaves retry unreachable even though a reflective
                    slab often reads fine on a second shot. */}
                {scanResult !== 'matched' && (
                  <>
                    {scanHint && (
                      <p className={cn(
                        'mt-0.5 text-[11px] font-medium',
                        scanResult === 'error' ? 'text-red-300/80' : 'text-amber-300/80',
                      )}>{scanHint}</p>
                    )}
                    {scanDebug && (
                      <div className="mt-1 space-y-0.5">
                        {scanDebug.map((line, i) => (
                          <p key={i} className="font-mono text-[10px] leading-tight text-red-400/70 break-all">{line}</p>
                        ))}
                      </div>
                    )}
                    <button
                      type="button"
                      onClick={() => { if (lastFileRef.current) runScan(lastFileRef.current); }}
                      className={cn(
                        'mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white/5 border transition-colors',
                        scanResult === 'error'
                          ? 'text-red-300 border-red-500/30 hover:bg-red-500/10'
                          : 'text-amber-300 border-amber-500/30 hover:bg-amber-500/10',
                      )}
                    >
                      <RefreshCw className="w-3 h-3" /> 重試
                    </button>
                  </>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Name */}
      <div>
        <label className="text-xs font-bold text-slate-400 mb-1 block">
          卡名 / 商品名稱{form.itemType === 'single' ? ' *' : '（選填，選擇系列後自動帶入）'}
        </label>
        <input
          required={form.itemType === 'single'}
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder={form.itemType === 'box' ? '選擇系列後自動帶入，也可自行修改' : 'e.g. リザードン ex SAR'}
          className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
        />
      </div>

      {/* Edition (box) — pick the version first so the Chinese labels below make
          sense; boxes come in Chinese / Japanese / English printings. */}
      {form.itemType === 'box' && (
        <div>
          <label className="text-xs font-bold text-slate-400 mb-1 block">版本</label>
          <div className="flex gap-2">
            {(['zh-tw', 'ja', 'en'] as CardEdition[]).map(ed => (
              <button
                key={ed}
                type="button"
                onClick={() => set('edition', ed)}
                className={cn(
                  'flex-1 py-2 rounded-lg text-sm font-bold border-2 transition-colors',
                  form.edition === ed
                    ? 'border-poke-accent bg-poke-accent/10 text-poke-accent'
                    : 'border-white/10 text-slate-400 hover:border-white/20',
                )}
              >
                {EDITION_LABELS[ed]}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Series + Set */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-bold text-slate-400 mb-1 block">大系列</label>
          <select
            value={form.series}
            onChange={e => handleSeriesChange(e.target.value)}
            className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
          >
            <option value="">全部</option>
            {SERIES_OPTIONS.map(s => <option key={s} value={s}>{seriesLabel(s)}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-400 mb-1 block">系列包名</label>
          <select
            value={form.setName}
            onChange={e => handleSetNameChange(e.target.value)}
            className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
          >
            <option value="">選擇...</option>
            {filteredSets.map(s => <option key={s.value} value={s.value}>{setOptionLabel(s.value)}</option>)}
            <option value="其他">其他</option>
          </select>
        </div>
      </div>

      {/* Image: preview + auto-fetch from set + manual URL */}
      <div>
        <label className="text-xs font-bold text-slate-400 mb-1 block">圖片</label>
        <div className="flex items-start gap-3">
          <Thumb src={form.imageUrl || undefined} type={form.itemType} alt={form.name} />
          <div className="flex-1 min-w-0 space-y-1.5">
            <div className="flex gap-2">
              <button
                type="button"
                disabled={fetchingImg}
                onClick={() => fetchSetImage(form.setName, form.edition)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-bold border-2 transition-colors',
                  fetchingImg
                    ? 'border-poke-accent/40 bg-poke-accent/10 text-poke-accent cursor-wait'
                    : 'border-white/10 text-slate-400 hover:border-poke-accent hover:text-poke-accent hover:bg-poke-accent/10',
                )}
              >
                {fetchingImg
                  ? <><Loader2 className="w-3.5 h-3.5 animate-spin" />取圖中...</>
                  : <><ImagePlus className="w-3.5 h-3.5" />自動取得系列圖</>}
              </button>
              {form.imageUrl && (
                <button
                  type="button"
                  onClick={() => { set('imageUrl', ''); setImgMsg(null); }}
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-bold text-slate-400 border border-white/10 hover:text-red-300 hover:border-red-500/40 transition-colors"
                >
                  <ImageOff className="w-3.5 h-3.5" />清除
                </button>
              )}
            </div>
            <input
              value={form.imageUrl}
              onChange={e => { set('imageUrl', e.target.value); setImgMsg(null); }}
              placeholder="或貼上圖片網址 https://..."
              className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-1.5 text-xs text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
            />
            {imgMsg && <p className="text-xs text-slate-400">{imgMsg}</p>}
          </div>
        </div>
      </div>

      {/* Grading toggle + Rarity + Condition/Grading (single only) */}
      {form.itemType === 'single' && (
        <>
          <label className="flex items-center gap-2 cursor-pointer select-none py-0.5">
            <input
              type="checkbox"
              checked={form.isGraded}
              onChange={e => set('isGraded', e.target.checked)}
              className="w-4 h-4 rounded border-white/20 bg-white/5 text-poke-blue focus:ring-poke-accent"
            />
            <span className="text-sm font-bold text-slate-300">鑑定卡（PSA / BGS…）</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-slate-400 mb-1 block">稀有度</label>
              <select
                value={form.rarity}
                onChange={e => set('rarity', e.target.value)}
                className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
              >
                <option value="">—</option>
                {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {form.isGraded ? (
              <div>
                <label className="text-xs font-bold text-slate-400 mb-1 block">鑑定公司</label>
                <select
                  value={form.gradingCompany}
                  onChange={e => set('gradingCompany', e.target.value as GradingCompany | '')}
                  className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
                >
                  <option value="">—</option>
                  {(['psa', 'bgs', 'other'] as GradingCompany[]).map(g => (
                    <option key={g} value={g}>{GRADING_LABELS[g]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-xs font-bold text-slate-400 mb-1 block">品相</label>
                <select
                  value={form.condition}
                  onChange={e => set('condition', e.target.value as CollectionCondition | '')}
                  className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
                >
                  <option value="">—</option>
                  {(Object.keys(CONDITION_LABELS) as CollectionCondition[]).map(c => (
                    <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {form.isGraded && (
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="text-xs font-bold text-slate-400 mb-1 block">評級分數</label>
                <select
                  value={form.grade}
                  onChange={e => set('grade', e.target.value)}
                  className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
                >
                  <option value="">—</option>
                  {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-400 mb-1 block">鑑定編號</label>
                <input
                  value={form.gradingCert}
                  onChange={e => set('gradingCert', e.target.value)}
                  placeholder="選填，例：12345678"
                  className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
                />
              </div>
            </div>
          )}
        </>
      )}

      {/* Edition + Card number (single only) */}
      {form.itemType === 'single' && (
        <div className="grid grid-cols-2 gap-2">
          <div>
            <label className="text-xs font-bold text-slate-400 mb-1 block">版本</label>
            <select
              value={form.edition}
              onChange={e => set('edition', e.target.value as CardEdition | '')}
              className="w-full border border-white/10 rounded-lg px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-poke-accent bg-surface"
            >
              <option value="">—</option>
              {(['ja', 'zh-tw'] as CardEdition[]).map(ed => (
                <option key={ed} value={ed}>{EDITION_LABELS[ed]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-400 mb-1 block">卡號</label>
            <input
              value={form.cardNumber}
              onChange={e => set('cardNumber', e.target.value)}
              placeholder="e.g. 199/165、198/SV-P"
              className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
            />
            {/* Promos have no set to pick, so the code in the card number is the
                only thing that can identify them — say so, or the user drops it
                and the card silently never gets a price. */}
            {form.setName === '其他' && (
              <p className="mt-1 text-[11px] text-slate-500 leading-snug">
                特典／促銷卡請照卡片左下角完整輸入（如 <span className="font-bold text-slate-400">198/SV-P</span>），
                斜線後的代號是查價唯一的依據。
              </p>
            )}
          </div>
        </div>
      )}

      {/* Quantity + current-value estimate */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-bold text-slate-400 mb-1 block">數量</label>
          <input
            type="number"
            min={1}
            value={form.quantity}
            onChange={e => set('quantity', Number(e.target.value))}
            className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-400 mb-1 block">現估價 (¥)</label>
          <input
            type="number"
            min={0}
            value={form.currentValue}
            onChange={e => set('currentValue', e.target.value)}
            placeholder="0"
            className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
          />
          <p className="mt-0.5 text-[10px] text-slate-400">作為損益基準；更新價格後與市場價比較</p>
        </div>
      </div>

      {/* Manual market-price override */}
      <div>
        <label className="text-xs font-bold text-slate-400 mb-1 block">手動市價 (NT$)</label>
        <input
          type="number"
          min={0}
          value={form.manualPrice}
          onChange={e => set('manualPrice', e.target.value)}
          placeholder="留空＝自動抓價"
          className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
        />
        <p className="mt-0.5 text-[10px] text-slate-400">薄市/自動價不準時，填你查到的市價（蝦皮/樂天等）；填了就以此為準且不會被自動更新覆蓋。清空則恢復自動抓價。</p>
      </div>

      {/* Acquired date */}
      <div>
        <label className="text-xs font-bold text-slate-400 mb-1 block">入手日期</label>
        <input
          type="date"
          value={form.acquiredDate}
          onChange={e => set('acquiredDate', e.target.value)}
          className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs font-bold text-slate-400 mb-1 block">備註</label>
        <input
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="例：已評級、二手、轉手來源..."
          className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
        />
      </div>

      <div className="flex gap-2 pt-1">
        <button
          type="submit"
          disabled={submitting}
          className="flex-1 flex items-center justify-center gap-2 bg-poke-blue text-white rounded-lg py-2.5 text-sm font-bold hover:bg-poke-dark-blue transition-colors disabled:opacity-50"
        >
          <Check className="w-4 h-4" />
          {submitting ? '儲存中...' : '儲存'}
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="px-4 py-2.5 text-sm font-bold text-slate-400 hover:text-slate-200 border border-white/10 rounded-lg hover:border-white/20 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

// Modal shell for the add / edit form so it floats above the gallery instead of
// pushing the grid around.
export function CollectionModal({
  title,
  initial,
  onSubmit,
  onClose,
  submitting,
}: {
  title: string;
  initial: FormState;
  onSubmit: (f: FormState) => void;
  onClose: () => void;
  submitting: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <motion.div
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: 40 }}
        transition={{ duration: 0.2 }}
        className="relative w-full sm:max-w-lg bg-surface border border-white/10 rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-surface border-b border-white/10 px-5 py-4 flex items-center justify-between z-10">
          <h2 className="font-black text-lg text-slate-100">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-white/10 transition-colors">
            <X className="w-5 h-5 text-slate-400" />
          </button>
        </div>
        <div className="p-5">
          <CollectionForm
            initial={initial}
            onSubmit={onSubmit}
            onCancel={onClose}
            submitting={submitting}
          />
        </div>
      </motion.div>
    </div>
  );
}
