import { useState, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCollection } from '../lib/useCollection';
import { CollectionItem, CollectionItemType, CollectionCondition, CardEdition, GradingCompany } from '../types';
import { PTCG_PRODUCTS } from '../data/ptcg-products';
import { cn } from '../lib/utils';
import { recognizeCardFromPhoto } from '../lib/gemini';
import { lookupCard, lookupSetImage, lookupTwCardImage, lookupJpCardImage, resolveJaSetCode, jpCardImageUrl, type ScanLanguage } from '../lib/tcgdex';
import { fetchCardPrice, fetchFxJpyToTwd } from '../lib/pricing';
import { Plus, Trash2, Pencil, X, Check, TrendingUp, TrendingDown, Package, CreditCard, Layers, Camera, Loader2, Sparkles, ImagePlus, ImageOff, RefreshCw, Search, ArrowUp, ArrowDown } from 'lucide-react';

const ITEM_TYPE_LABELS: Record<CollectionItemType, string> = {
  single: '單卡',
  box: '整盒',
  pack: '補充包',
};

const CONDITION_LABELS: Record<CollectionCondition, string> = {
  mint: 'Mint',
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
};

const RARITY_OPTIONS = ['UR', 'MUR', 'SAR', 'AR', 'SR', 'HR', 'CSR', 'SER', 'RR', 'R', 'U', 'C', 'ACE SPEC', 'Promo', '其他'];

const EDITION_LABELS: Record<CardEdition, string> = {
  'ja': '日文版',
  'zh-tw': '繁體中文版',
  'en': '英文版',
};

const GRADING_LABELS: Record<GradingCompany, string> = {
  psa: 'PSA',
  bgs: 'BGS',
  other: '其他',
};

const GRADE_OPTIONS = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4', '3', '2', '1'];

const SERIES_OPTIONS = [...new Set(PTCG_PRODUCTS.map(p => p.series))];
const SET_OPTIONS = PTCG_PRODUCTS.map(p => ({ value: p.name, series: p.series }));

// Set name (as shown in the form) → TCGdex set code, so we can auto-fetch a
// representative image for boxes / packs / manually-typed items.
const SET_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  PTCG_PRODUCTS.map(p => [p.name, p.code]),
);

const editionToLang = (e: CardEdition | ''): ScanLanguage => (e === 'zh-tw' ? 'zh-tw' : 'ja');

type FilterType = 'all' | CollectionItemType;
type SortKey = 'value' | 'pnl' | 'name' | 'date';
type SortDir = 'desc' | 'asc';
type GradedFilter = 'all' | 'graded' | 'raw';

const SORT_LABELS: Record<SortKey, string> = {
  value: '現估市值',
  pnl: '損益',
  name: '名稱',
  date: '入手日期',
};

// Local YYYY-MM-DD for date <input> defaults (avoids the UTC shift toISOString
// would introduce near midnight).
const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const EMPTY_FORM = {
  name: '',
  setName: '',
  series: '',
  cardNumber: '',
  rarity: '',
  itemType: 'single' as CollectionItemType,
  condition: '' as CollectionCondition | '',
  quantity: 1,
  acquiredDate: '',
  currentValue: '',
  notes: '',
  imageUrl: '',
  edition: '' as CardEdition | '',
  isGraded: false,
  gradingCompany: '' as GradingCompany | '',
  grade: '',
  gradingCert: '',
};

type FormState = typeof EMPTY_FORM;

function ItemTypeIcon({ type }: { type: CollectionItemType }) {
  if (type === 'single') return <CreditCard className="w-3.5 h-3.5" />;
  if (type === 'box') return <Package className="w-3.5 h-3.5" />;
  return <Layers className="w-3.5 h-3.5" />;
}

function ItemTypeBadge({ type }: { type: CollectionItemType }) {
  const colours: Record<CollectionItemType, string> = {
    single: 'bg-poke-blue/10 text-poke-dark-blue',
    box: 'bg-amber-100 text-amber-700',
    pack: 'bg-emerald-100 text-emerald-700',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold', colours[type])}>
      <ItemTypeIcon type={type} />
      {ITEM_TYPE_LABELS[type]}
    </span>
  );
}

// We display every amount in TWD (the user's home currency). Purchase prices
// and manual overrides are JPY-native (the app tracks ¥); market prices carry
// their own currency (JPY from Huca, TWD from kapaipai). `rate` is JPY -> TWD
// from /api/fx.
function twdOf(jpy: number, rate: number) {
  return Math.round(jpy * rate);
}

// Convert an amount in its native currency to TWD.
function toTwd(amount: number, currency: 'JPY' | 'TWD', rate: number) {
  return currency === 'TWD' ? Math.round(amount) : twdOf(amount, rate);
}

// Consistent image slot for a collection item. Renders the artwork when we have
// a working URL, otherwise a muted placeholder that shows the item type — so
// every row keeps the same layout whether or not it has a picture. Broken URLs
// (e.g. a logo that 404s) fall back to the placeholder automatically.
function Thumb({
  src,
  type,
  alt,
  className,
  onClick,
}: {
  src?: string;
  type: CollectionItemType;
  alt?: string;
  className?: string;
  onClick?: () => void;
}) {
  const [broken, setBroken] = useState(false);
  const box = cn(
    'w-12 h-16 rounded-md border bg-slate-50 flex-shrink-0 overflow-hidden flex items-center justify-center',
    className,
  );
  if (!src || broken) {
    return (
      <div className={cn(box, 'border-slate-100 text-slate-300')} title="無圖片">
        <ItemTypeIcon type={type} />
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={alt ?? ''}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      onClick={onClick}
      className={cn(box, 'border-slate-100 object-contain', onClick && 'cursor-pointer')}
    />
  );
}

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
    set('setName', setName);
    // For boxes / packs, auto-grab a representative image when none is set yet.
    if ((form.itemType === 'box' || form.itemType === 'pack') && !form.imageUrl && setName) {
      fetchSetImage(setName, form.edition);
    }
  };

  const handlePhotoScan = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('圖片太大，請選擇小於 10MB 的圖片');
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
        ? await lookupCard(scan.setCode, scan.localId, scan.language || 'ja')
        : null;

      if (card) {
        // Pick artwork in the card's OWN language. For zh-tw, the official TW
        // proxy has precise per-card art (TCGdex often lacks zh-tw images). For
        // ja we must NOT use the TW proxy (it would show the Chinese version) —
        // use TCGdex's ja image, or the SNKRDUNK/Limitless proxy for brand-new
        // sets TCGdex hasn't published art for yet.
        let img = card.imageUrl;
        if (card.edition === 'zh-tw') {
          const tw = await lookupTwCardImage(scan.setCode, scan.localId);
          if (tw) img = tw;
        } else if (!img) {
          const jp = await lookupJpCardImage(scan.setCode, scan.localId);
          if (jp) img = jp;
        }
        setForm(f => ({
          ...f,
          name:       card.name,
          setName:    card.setName || f.setName,
          series:     card.series  || f.series,
          rarity:     card.rarity  || scan.rarity || f.rarity,
          cardNumber: scan.localId || f.cardNumber,
          imageUrl:   img || f.imageUrl,
          edition:    card.edition,
        }));
        setScanResult('matched');
      } else if (scan.error) {
        // The AI chain couldn't run (quota exhausted / providers down / photo
        // unreadable) — nothing was read. Tell the user it's a service issue,
        // not that the card is unknown, so they don't assume the card is invalid.
        const provs = scan.providers ?? [];
        if (scan.reason === 'endpoint_missing') {
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
        // Fallback: at least pre-fill what the model could read.
        setForm(f => ({
          ...f,
          name:       scan.name    || f.name,
          cardNumber: scan.localId || f.cardNumber,
          rarity:     scan.rarity  || f.rarity,
          edition:    scan.language || f.edition,
        }));
        setScanResult('fallback');
      }
    } catch (err) {
      console.error(err);
      alert('AI 讀取失敗，請手動輸入');
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
        {(['single', 'box', 'pack'] as CollectionItemType[]).map(t => (
          <button
            key={t}
            type="button"
            onClick={() => set('itemType', t)}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-sm font-bold border-2 transition-colors',
              form.itemType === t
                ? 'border-poke-blue bg-poke-blue/5 text-poke-dark-blue'
                : 'border-slate-200 text-slate-400 hover:border-slate-300',
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
                ? 'border-poke-blue/40 bg-poke-blue/5 text-poke-blue cursor-wait'
                : 'border-slate-200 text-slate-400 hover:border-poke-blue hover:text-poke-blue hover:bg-poke-blue/5',
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
                ? 'bg-emerald-50 border-emerald-200'
                : scanResult === 'error'
                  ? 'bg-red-50 border-red-200'
                  : 'bg-amber-50 border-amber-200',
            )}>
              <img
                src={scanResult === 'matched' && form.imageUrl ? form.imageUrl : (photoPreview ?? '')}
                alt="card"
                referrerPolicy="no-referrer"
                className="w-12 h-16 object-contain rounded-md border border-slate-200 bg-white flex-shrink-0"
              />
              <div className="min-w-0">
                <p className={cn(
                  'text-xs font-bold',
                  scanResult === 'matched'
                    ? 'text-emerald-700'
                    : scanResult === 'error'
                      ? 'text-red-600'
                      : 'text-amber-700',
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
                {scanResult === 'error' && (
                  <>
                    {scanHint && <p className="mt-0.5 text-[11px] font-medium text-red-500/80">{scanHint}</p>}
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
                      className="mt-1.5 inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-bold text-red-600 bg-white border border-red-200 hover:bg-red-50 transition-colors"
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
        <label className="text-xs font-bold text-slate-500 mb-1 block">卡名 / 商品名稱 *</label>
        <input
          required
          value={form.name}
          onChange={e => set('name', e.target.value)}
          placeholder="e.g. リザードン ex SAR"
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
        />
      </div>

      {/* Series + Set */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">大系列</label>
          <select
            value={form.series}
            onChange={e => handleSeriesChange(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
          >
            <option value="">全部</option>
            {SERIES_OPTIONS.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">系列包名</label>
          <select
            value={form.setName}
            onChange={e => handleSetNameChange(e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
          >
            <option value="">選擇...</option>
            {filteredSets.map(s => <option key={s.value} value={s.value}>{s.value}</option>)}
            <option value="其他">其他</option>
          </select>
        </div>
      </div>

      {/* Image: preview + auto-fetch from set + manual URL */}
      <div>
        <label className="text-xs font-bold text-slate-500 mb-1 block">圖片</label>
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
                    ? 'border-poke-blue/40 bg-poke-blue/5 text-poke-blue cursor-wait'
                    : 'border-slate-200 text-slate-500 hover:border-poke-blue hover:text-poke-blue hover:bg-poke-blue/5',
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
                  className="flex items-center gap-1 px-2.5 py-2 rounded-lg text-xs font-bold text-slate-400 border-2 border-slate-200 hover:text-red-400 hover:border-red-200 transition-colors"
                >
                  <ImageOff className="w-3.5 h-3.5" />清除
                </button>
              )}
            </div>
            <input
              value={form.imageUrl}
              onChange={e => { set('imageUrl', e.target.value); setImgMsg(null); }}
              placeholder="或貼上圖片網址 https://..."
              className="w-full border border-slate-200 rounded-lg px-3 py-1.5 text-xs focus:outline-none focus:border-poke-blue"
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
              className="w-4 h-4 rounded border-slate-300 text-poke-blue focus:ring-poke-blue"
            />
            <span className="text-sm font-bold text-slate-600">鑑定卡（PSA / BGS…）</span>
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-bold text-slate-500 mb-1 block">稀有度</label>
              <select
                value={form.rarity}
                onChange={e => set('rarity', e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
              >
                <option value="">—</option>
                {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
              </select>
            </div>
            {form.isGraded ? (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">鑑定公司</label>
                <select
                  value={form.gradingCompany}
                  onChange={e => set('gradingCompany', e.target.value as GradingCompany | '')}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
                >
                  <option value="">—</option>
                  {(['psa', 'bgs', 'other'] as GradingCompany[]).map(g => (
                    <option key={g} value={g}>{GRADING_LABELS[g]}</option>
                  ))}
                </select>
              </div>
            ) : (
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">品相</label>
                <select
                  value={form.condition}
                  onChange={e => set('condition', e.target.value as CollectionCondition | '')}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
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
                <label className="text-xs font-bold text-slate-500 mb-1 block">評級分數</label>
                <select
                  value={form.grade}
                  onChange={e => set('grade', e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
                >
                  <option value="">—</option>
                  {GRADE_OPTIONS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </div>
              <div>
                <label className="text-xs font-bold text-slate-500 mb-1 block">鑑定編號</label>
                <input
                  value={form.gradingCert}
                  onChange={e => set('gradingCert', e.target.value)}
                  placeholder="選填，例：12345678"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
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
            <label className="text-xs font-bold text-slate-500 mb-1 block">版本</label>
            <select
              value={form.edition}
              onChange={e => set('edition', e.target.value as CardEdition | '')}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
            >
              <option value="">—</option>
              {(['ja', 'zh-tw'] as CardEdition[]).map(ed => (
                <option key={ed} value={ed}>{EDITION_LABELS[ed]}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-xs font-bold text-slate-500 mb-1 block">卡號</label>
            <input
              value={form.cardNumber}
              onChange={e => set('cardNumber', e.target.value)}
              placeholder="e.g. 199/165"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
            />
          </div>
        </div>
      )}

      {/* Quantity + current-value estimate */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">數量</label>
          <input
            type="number"
            min={1}
            value={form.quantity}
            onChange={e => set('quantity', Number(e.target.value))}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
          />
        </div>
        <div>
          <label className="text-xs font-bold text-slate-500 mb-1 block">現估價 (¥)</label>
          <input
            type="number"
            min={0}
            value={form.currentValue}
            onChange={e => set('currentValue', e.target.value)}
            placeholder="0"
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
          />
          <p className="mt-0.5 text-[10px] text-slate-400">作為損益基準；更新價格後與市場價比較</p>
        </div>
      </div>

      {/* Acquired date */}
      <div>
        <label className="text-xs font-bold text-slate-500 mb-1 block">入手日期</label>
        <input
          type="date"
          value={form.acquiredDate}
          onChange={e => set('acquiredDate', e.target.value)}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
        />
      </div>

      {/* Notes */}
      <div>
        <label className="text-xs font-bold text-slate-500 mb-1 block">備註</label>
        <input
          value={form.notes}
          onChange={e => set('notes', e.target.value)}
          placeholder="例：已評級、二手、轉手來源..."
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue"
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
          className="px-4 py-2.5 text-sm font-bold text-slate-500 hover:text-slate-700 border border-slate-200 rounded-lg hover:border-slate-300 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </form>
  );
}

function formToItem(f: FormState): Omit<CollectionItem, 'id' | 'createdAt'> {
  return {
    name:          f.name.trim(),
    setName:       f.setName,
    series:        f.series,
    cardNumber:    f.cardNumber || undefined,
    rarity:        f.rarity || undefined,
    itemType:      f.itemType,
    condition:     f.isGraded ? undefined : ((f.condition as CollectionCondition) || undefined),
    quantity:      f.quantity,
    acquiredDate:  f.acquiredDate || undefined,
    currentValue:  f.currentValue !== '' ? Number(f.currentValue) : undefined,
    notes:         f.notes || undefined,
    imageUrl:      f.imageUrl || undefined,
    edition:       (f.edition as CardEdition) || undefined,
    isGraded:      f.isGraded,
    gradingCompany: f.isGraded ? ((f.gradingCompany as GradingCompany) || undefined) : undefined,
    grade:         f.isGraded ? (f.grade || undefined) : undefined,
    gradingCert:   f.isGraded ? (f.gradingCert || undefined) : undefined,
  };
}

function itemToForm(item: CollectionItem): FormState {
  return {
    name:          item.name,
    setName:       item.setName,
    series:        item.series,
    cardNumber:    item.cardNumber ?? '',
    rarity:        item.rarity ?? '',
    itemType:      item.itemType,
    condition:     item.condition ?? '',
    quantity:      item.quantity,
    acquiredDate:  item.acquiredDate ?? '',
    currentValue:  item.currentValue != null ? String(item.currentValue) : '',
    notes:         item.notes ?? '',
    imageUrl:      item.imageUrl ?? '',
    edition:       item.edition ?? '',
    isGraded:      item.isGraded ?? false,
    gradingCompany: item.gradingCompany ?? '',
    grade:         item.grade ?? '',
    gradingCert:   item.gradingCert ?? '',
  };
}

// Gallery tile image. Every card gets a picture: use the item's own image when
// present, otherwise auto-resolve a representative set image from its set code
// (TCGdex card art / Bulbagarden logo). Falls back to a placeholder only when
// nothing at all can be resolved or the resolved URL fails to load.
// Pull the printed collector number out of possibly-messy stored text.
// "114/083" → "114"; "J m5 117/081" → "117"; "016" → "16"; "" → "".
function collectorNo(raw?: string): string {
  if (!raw) return '';
  const s = String(raw);
  const n = s.match(/(\d+)\s*\/\s*\d+/)?.[1] ?? s.match(/\d+/)?.[0] ?? '';
  return n.replace(/^0+(?=\d)/, '');
}

function GalleryImage({ item }: { item: CollectionItem }) {
  // An ordered list of candidate image URLs; the <img> advances to the next one
  // on load error, so a missing per-card scan degrades to the set logo (and
  // finally a placeholder) rather than a blank tile.
  const [candidates, setCandidates] = useState<string[]>([]);
  const [idx, setIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    setCandidates([]);
    setIdx(0);

    const code = SET_CODE_BY_NAME[item.setName];
    const stored = item.imageUrl || undefined;
    const lang = editionToLang(item.edition ?? '');
    // A ja card that stored a Traditional-Chinese image (from the TW proxy, back
    // when resolution was language-agnostic) is wrong: drop it so it re-resolves
    // in ja below. Genuine ja/other stored art is kept.
    const storedUsable =
      stored && !(lang === 'ja' && stored.includes('asia.pokemon-card.com'))
        ? stored
        : undefined;
    const num = collectorNo(item.cardNumber);

    const build = async (): Promise<string[]> => {
      const out: string[] = [];
      const push = (u?: string | null) => { if (u && !out.includes(u)) out.push(u); };

      // The setName of a brand-new set (e.g. M4) isn't in local products, so fall
      // back to TCGdex's ja set-name → code map to recover its code.
      let sc = code;
      if (!sc && lang === 'ja') sc = (await resolveJaSetCode(item.setName)) ?? undefined;

      if (item.itemType === 'single') {
        push(storedUsable); // genuine scanned/uploaded art first
        if (sc && num) {
          if (lang === 'zh-tw') {
            push(await lookupTwCardImage(sc, num)); // TW proxy is zh-tw only
          } else {
            const card = await lookupCard(sc, num, lang); // TCGdex ja official art (older sets)
            push(card?.imageUrl);
            push(await lookupJpCardImage(sc, num)); // SNKRDUNK / Limitless (newest sets)
            push(jpCardImageUrl(sc, num)); // direct Limitless URL (dev / proxy-down fallback)
          }
        }
        if (sc) push((await lookupSetImage(sc, lang))?.imageUrl); // set logo last
        return out;
      }

      // Boxes / packs: prefer official pack art, then any stored logo.
      if (sc) push((await lookupSetImage(sc, lang))?.imageUrl);
      push(storedUsable);
      return out;
    };

    build()
      .then(list => { if (alive) setCandidates(list); })
      .catch(() => { if (alive) setCandidates(storedUsable ? [storedUsable] : []); });
    return () => { alive = false; };
  }, [item.imageUrl, item.setName, item.edition, item.itemType, item.cardNumber]);

  const src = candidates[idx];
  if (!src) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-300">
        <div className="scale-[2.2]"><ItemTypeIcon type={item.itemType} /></div>
        <span className="text-[10px] font-bold mt-2">無圖片</span>
      </div>
    );
  }
  return (
    <img
      src={src}
      alt={item.name}
      referrerPolicy="no-referrer"
      onError={() => setIdx(i => i + 1)}
      className="w-full h-full object-contain p-2"
    />
  );
}

// Modal shell for the add / edit form so it floats above the gallery instead of
// pushing the grid around.
function CollectionModal({
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
        className="relative w-full sm:max-w-lg bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-slate-100 px-5 py-4 flex items-center justify-between z-10">
          <h2 className="font-black text-lg text-poke-dark-blue">{title}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 transition-colors">
            <X className="w-5 h-5 text-slate-500" />
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

export function Collection() {
  const { items, loading, addItem, updateItem, deleteItem } = useCollection();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fEdition, setFEdition] = useState<'all' | CardEdition>('all');
  const [fRarity, setFRarity] = useState<'all' | string>('all');
  const [fGraded, setFGraded] = useState<GradedFilter>('all');
  const [fCondition, setFCondition] = useState<'all' | CollectionCondition>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fxRate, setFxRate] = useState(0.2); // JPY -> TWD, refined from /api/fx
  const [refreshing, setRefreshing] = useState(false);
  const [priceProgress, setPriceProgress] = useState<{ done: number; total: number } | null>(null);

  useEffect(() => {
    fetchFxJpyToTwd().then(setFxRate).catch(() => {});
  }, []);

  const editingItem = editingId ? (items.find(i => i.id === editingId) ?? null) : null;

  // Live current value for a card, in its native currency: the auto-fetched
  // market price wins (its own currency), otherwise the estimate the user
  // recorded when adding (現估價, JPY). No purchase price is tracked any more.
  const estValue = (i: CollectionItem): { amount: number; currency: 'JPY' | 'TWD' } | null => {
    if (i.marketPrice != null) return { amount: i.marketPrice, currency: i.marketPriceCurrency === 'TWD' ? 'TWD' : 'JPY' };
    if (i.currentValue != null) return { amount: i.currentValue, currency: 'JPY' };
    return null;
  };

  // Per-item value change (損益) in TWD: live market price vs. the user's
  // recorded estimate (現估價) — only defined when we have BOTH, otherwise null
  // (no baseline to compare against). Quantity-aware.
  const pnlOf = (i: CollectionItem): { diff: number; pct: number } | null => {
    if (i.marketPrice == null || i.currentValue == null) return null;
    const market = toTwd(i.marketPrice, i.marketPriceCurrency === 'TWD' ? 'TWD' : 'JPY', fxRate);
    const base = toTwd(i.currentValue, 'JPY', fxRate);
    if (base <= 0) return null;
    return { diff: (market - base) * i.quantity, pct: (market - base) / base * 100 };
  };

  // Editions actually present in the collection, so the version chips only list
  // what the user really owns.
  const editionsPresent = useMemo(() => {
    const set = new Set<CardEdition>();
    for (const i of items) if (i.edition) set.add(i.edition);
    return [...set];
  }, [items]);

  // Filter → sort pipeline. Filters stack (type, edition, rarity, graded,
  // condition, free-text query); sort value depends on sortKey, all normalised
  // to TWD so JPY/TWD cards compare fairly. Missing values sort to 0.
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = items.filter(i => {
      if (filterType !== 'all' && i.itemType !== filterType) return false;
      if (fEdition !== 'all' && i.edition !== fEdition) return false;
      if (fRarity !== 'all' && i.rarity !== fRarity) return false;
      if (fGraded === 'graded' && !i.isGraded) return false;
      if (fGraded === 'raw' && i.isGraded) return false;
      if (fCondition !== 'all' && i.condition !== fCondition) return false;
      if (q) {
        const hay = `${i.name} ${i.setName} ${i.cardNumber ?? ''}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    const valueOf = (i: CollectionItem): number => {
      const e = estValue(i);
      return e ? toTwd(e.amount, e.currency, fxRate) : 0;
    };
    const pnlDiffOf = (i: CollectionItem) => pnlOf(i)?.diff ?? 0;
    const dateOf = (i: CollectionItem) => new Date(i.acquiredDate ?? i.createdAt).getTime();

    const cmp = (a: CollectionItem, b: CollectionItem): number => {
      switch (sortKey) {
        case 'name': return a.name.localeCompare(b.name, 'zh-Hant');
        case 'pnl': return pnlDiffOf(a) - pnlDiffOf(b);
        case 'date': return dateOf(a) - dateOf(b);
        case 'value':
        default: return valueOf(a) - valueOf(b);
      }
    };

    rows.sort((a, b) => sortDir === 'asc' ? cmp(a, b) : -cmp(a, b));
    return rows;
  }, [items, filterType, fEdition, fRarity, fGraded, fCondition, query, sortKey, sortDir, fxRate]);

  const filtersActive = filterType !== 'all' || fEdition !== 'all' || fRarity !== 'all'
    || fGraded !== 'all' || fCondition !== 'all' || query.trim() !== '';

  // Aggregates are computed in TWD (per-item, honouring each value's currency)
  // so JPY and TWD cards can be summed together.
  const totalCurrentTwd = items.reduce((s, i) => {
    const e = estValue(i);
    return s + (e ? toTwd(e.amount, e.currency, fxRate) : 0) * i.quantity;
  }, 0);
  // Value change (損益) = live market price vs. recorded estimate, summed only
  // over items that have both (so there's a baseline). totalBaseTwd is that
  // baseline sum, used for the overall percentage.
  let totalBaseTwd = 0;
  let pnlTwd = 0;
  for (const i of items) {
    const p = pnlOf(i);
    if (p && i.currentValue != null) {
      totalBaseTwd += toTwd(i.currentValue, 'JPY', fxRate) * i.quantity;
      pnlTwd += p.diff;
    }
  }
  const hasPrices = totalCurrentTwd > 0;

  // Cards we can auto-price: singles. Japanese -> Huca, zh-tw -> kapaipai.
  const priceable = items.filter(i => i.itemType === 'single');

  const handleRefreshPrices = async () => {
    if (refreshing || priceable.length === 0) return;
    setRefreshing(true);
    setPriceProgress({ done: 0, total: priceable.length });
    // Refresh the FX rate alongside prices so the display stays consistent.
    fetchFxJpyToTwd().then(setFxRate).catch(() => {});
    let done = 0;
    for (const item of priceable) {
      const edition = item.edition ?? 'ja';
      // ja: Huca resolves by set code (from our local map). zh-tw: kapaipai
      // resolves by set name (no local zh-tw set-code map).
      const setCode = SET_CODE_BY_NAME[item.setName] ?? '';
      try {
        const p = await fetchCardPrice({
          setCode,
          setName: item.setName,
          number: item.cardNumber,
          name: item.name,
          edition,
        });
        if (p && p.price != null) {
          await updateItem(item.id, {
            marketPrice: p.price,
            marketPriceCurrency: p.currency ?? (edition === 'zh-tw' ? 'TWD' : 'JPY'),
            marketPriceSource: p.source ?? (edition === 'zh-tw' ? 'kapaipai' : 'huca'),
            marketPriceUpdatedAt: p.updatedAt,
          });
        }
      } catch (err) {
        console.error('price refresh failed for', item.name, err);
      }
      done += 1;
      setPriceProgress({ done, total: priceable.length });
    }
    setRefreshing(false);
    setPriceProgress(null);
  };

  const handleAdd = async (f: FormState) => {
    setSubmitting(true);
    try {
      await addItem(formToItem(f));
      setShowAddForm(false);
    } catch (err) {
      console.error(err);
      alert('新增失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  };

  const handleUpdate = async (id: string, f: FormState) => {
    setSubmitting(true);
    try {
      await updateItem(id, formToItem(f));
      setEditingId(null);
    } catch (err) {
      console.error(err);
      alert('更新失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這筆收藏嗎？')) return;
    try {
      await deleteItem(id);
    } catch (err) {
      console.error(err);
      alert('刪除失敗');
    }
  };

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-poke-blue"></div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Portfolio hero */}
      {hasPrices && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
          className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-poke-blue to-poke-dark-blue text-white p-5 shadow-md"
        >
          {/* Decorative glow */}
          <div className="pointer-events-none absolute -top-16 -right-10 w-48 h-48 rounded-full bg-white/10 blur-2xl" />

          <div className="relative">
            <p className="text-xs font-bold uppercase tracking-wide text-white/70">
              Portfolio · 收藏現估總值
            </p>
            <div className="mt-1 flex items-end flex-wrap gap-x-3 gap-y-1">
              <span className="text-3xl sm:text-4xl font-black tracking-tight">
                NT${Math.round(totalCurrentTwd).toLocaleString()}
              </span>
              {totalBaseTwd > 0 && (
                <span className={cn(
                  'inline-flex items-center gap-1 px-2 py-1 rounded-full text-sm font-black bg-white/15',
                  pnlTwd >= 0 ? 'text-emerald-200' : 'text-red-200',
                )}>
                  {pnlTwd >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                  {pnlTwd >= 0 ? '+' : ''}NT${Math.round(pnlTwd).toLocaleString()}
                  <span className="opacity-80">
                    ({pnlTwd >= 0 ? '+' : ''}{(pnlTwd / totalBaseTwd * 100).toFixed(1)}%)
                  </span>
                </span>
              )}
            </div>

            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs font-bold text-white/70">
              <span>收藏件數 <span className="text-white/90">{items.reduce((s, i) => s + i.quantity, 0)}</span></span>
            </div>
          </div>
        </motion.div>
      )}

      {/* Toolbar: search + sort + actions */}
      {items.length > 0 && (
        <div className="space-y-2.5">
          {/* Row 1: search, sort, actions */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
              <input
                type="text"
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="搜尋名稱／系列／卡號"
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white border border-slate-200 text-sm text-slate-700 placeholder:text-slate-400 focus:outline-none focus:border-poke-blue focus:ring-1 focus:ring-poke-blue"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="px-2.5 py-2 rounded-lg bg-white border border-slate-200 text-sm font-bold text-slate-600 focus:outline-none focus:border-poke-blue"
                title="排序依據"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                title={sortDir === 'asc' ? '升序（低→高）' : '降序（高→低）'}
                className="p-2 rounded-lg bg-white border border-slate-200 text-slate-500 hover:text-poke-blue hover:border-poke-blue transition-colors"
              >
                {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              </button>
            </div>

            {priceable.length > 0 && (
              <button
                onClick={handleRefreshPrices}
                disabled={refreshing}
                title="更新市場價格（日文卡 Huca、繁中卡 卡拍拍）"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold bg-white border border-slate-200 text-slate-500 hover:text-poke-blue hover:border-poke-blue transition-colors disabled:opacity-60"
              >
                <RefreshCw className={cn('w-4 h-4', refreshing && 'animate-spin')} />
                {refreshing && priceProgress
                  ? `${priceProgress.done}/${priceProgress.total}`
                  : '更新價格'}
              </button>
            )}

            <button
              onClick={() => { setEditingId(null); setShowAddForm(true); }}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold bg-poke-blue text-white hover:bg-poke-dark-blue transition-colors"
            >
              <Plus className="w-4 h-4" />
              新增
            </button>
          </div>

          {/* Row 2: type chips + edition chips */}
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 gap-0.5">
              {(['all', 'single', 'box', 'pack'] as FilterType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                    filterType === t
                      ? 'bg-poke-blue text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-600',
                  )}
                >
                  {t === 'all' ? '全部' : ITEM_TYPE_LABELS[t]}
                  <span className="ml-1 opacity-60">
                    {t === 'all' ? items.length : items.filter(i => i.itemType === t).length}
                  </span>
                </button>
              ))}
            </div>

            {editionsPresent.length > 0 && (
              <div className="flex bg-white border border-slate-200 rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => setFEdition('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                    fEdition === 'all' ? 'bg-poke-blue text-white shadow-sm' : 'text-slate-400 hover:text-slate-600',
                  )}
                >
                  全部版本
                </button>
                {editionsPresent.map(e => (
                  <button
                    key={e}
                    onClick={() => setFEdition(e)}
                    className={cn(
                      'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                      fEdition === e ? 'bg-poke-blue text-white shadow-sm' : 'text-slate-400 hover:text-slate-600',
                    )}
                  >
                    {EDITION_LABELS[e]}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Row 3: secondary selects */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={fRarity}
              onChange={e => setFRarity(e.target.value)}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-600 focus:outline-none focus:border-poke-blue"
              title="稀有度"
            >
              <option value="all">全部稀有度</option>
              {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <select
              value={fGraded}
              onChange={e => setFGraded(e.target.value as GradedFilter)}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-600 focus:outline-none focus:border-poke-blue"
              title="鑑定狀態"
            >
              <option value="all">全部（鑑定/未鑑定）</option>
              <option value="graded">已鑑定</option>
              <option value="raw">未鑑定</option>
            </select>

            <select
              value={fCondition}
              onChange={e => setFCondition(e.target.value as 'all' | CollectionCondition)}
              className="px-2.5 py-1.5 rounded-lg bg-white border border-slate-200 font-bold text-slate-600 focus:outline-none focus:border-poke-blue"
              title="品相"
            >
              <option value="all">全部品相</option>
              {(Object.keys(CONDITION_LABELS) as CollectionCondition[]).map(c => (
                <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
              ))}
            </select>

            <span className="ml-auto text-slate-400 font-bold">{filtered.length} 筆</span>
          </div>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center p-12 bg-white rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">
            {items.length === 0
              ? '尚無收藏紀錄，點右上角「新增」開始記錄吧！'
              : filtersActive
                ? '找不到符合條件的收藏'
                : '尚無收藏紀錄'}
          </p>
        </div>
      )}

      {/* Gallery grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(item => {
            // Live current value (market price, else recorded estimate) in its
            // native currency; the value change (損益) is live market vs. the
            // recorded 現估價 estimate, in TWD.
            const est = estValue(item);
            const estTwd = est ? toTwd(est.amount, est.currency, fxRate) : null;
            const pnl = pnlOf(item);
            const diff = pnl?.diff ?? null;
            const diffPct = pnl?.pct ?? null;
            const acquired = item.acquiredDate || null;
            return (
              <motion.div
                key={item.id}
                whileHover={{ y: -4 }}
                transition={{ type: 'spring', stiffness: 300, damping: 22 }}
                className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col shadow-sm hover:shadow-lg hover:border-slate-300 transition-shadow"
              >
                {/* Image */}
                <div className="relative aspect-[3/4] bg-slate-50 border-b border-slate-100">
                  <GalleryImage item={item} />

                  {/* Bottom gradient for badge legibility */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

                  {/* Top-left badges */}
                  <div className="absolute top-1.5 left-1.5 flex flex-col items-start gap-1">
                    <ItemTypeBadge type={item.itemType} />
                    {item.isGraded && (
                      <span className="text-[10px] font-black text-amber-700 bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-300 px-1.5 py-0.5 rounded-full shadow-sm">
                        {item.gradingCompany ? GRADING_LABELS[item.gradingCompany] : '鑑定'}{item.grade ? ` ${item.grade}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Quantity */}
                  {item.quantity > 1 && (
                    <span className="absolute bottom-1.5 left-1.5 text-[10px] font-black text-white bg-slate-800/70 px-1.5 py-0.5 rounded-full">
                      ×{item.quantity}
                    </span>
                  )}

                  {/* Actions (reveal on hover) */}
                  <div className="absolute top-1.5 right-1.5 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button
                      onClick={() => { setEditingId(item.id); setShowAddForm(false); }}
                      className="p-1.5 rounded-lg bg-white/80 backdrop-blur text-slate-500 hover:text-poke-blue shadow-sm transition-colors"
                      title="編輯"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 rounded-lg bg-white/80 backdrop-blur text-slate-500 hover:text-red-500 shadow-sm transition-colors"
                      title="刪除"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>

                {/* Info */}
                <div className="p-2.5 flex flex-col gap-1 flex-1">
                  <div className="flex items-center gap-1 flex-wrap">
                    {item.edition && (
                      <span className="text-[10px] font-bold text-sky-600 bg-sky-50 px-1.5 py-0.5 rounded-full">
                        {EDITION_LABELS[item.edition]}
                      </span>
                    )}
                    {item.rarity && (
                      <span className="text-[10px] font-bold text-violet-600 bg-violet-50 px-1.5 py-0.5 rounded-full">
                        {item.rarity}
                      </span>
                    )}
                    {!item.isGraded && item.condition && (
                      <span className="text-[10px] font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded-full">
                        {CONDITION_LABELS[item.condition]}
                      </span>
                    )}
                  </div>

                  <p className="font-black text-slate-800 text-sm leading-tight line-clamp-2">{item.name}</p>

                  {(item.setName || item.cardNumber) && (
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.setName}{item.cardNumber ? ` · ${item.cardNumber}` : ''}
                    </p>
                  )}

                  <div className="mt-auto pt-1.5">
                    <div className="flex items-baseline justify-between gap-1">
                      <span
                        className="text-base font-black text-slate-800"
                        title={item.marketPriceSource ? `市場價來源：${item.marketPriceSource}` : undefined}
                      >
                        {estTwd != null ? `NT$${estTwd.toLocaleString()}` : '—'}
                        {estTwd != null && est?.currency === 'JPY' && est.amount != null && (
                          <span className="ml-0.5 text-[10px] font-normal text-slate-400">
                            (¥{Math.round(est.amount).toLocaleString()})
                          </span>
                        )}
                      </span>
                      {diffPct != null && (
                        <span className={cn(
                          'inline-flex items-center gap-0.5 text-[11px] font-black shrink-0',
                          diffPct >= 0 ? 'text-emerald-500' : 'text-red-400',
                        )}>
                          {diffPct >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                          {diffPct >= 0 ? '+' : ''}{diffPct.toFixed(1)}%
                        </span>
                      )}
                    </div>
                    {(acquired || diff != null) && (
                      <div className="mt-0.5 flex items-center justify-between text-[10px] text-slate-400 font-medium">
                        {acquired ? <span>入手 {acquired.replace(/-/g, '/')}</span> : <span />}
                        {diff != null && (
                          <span className={cn(diff >= 0 ? 'text-emerald-500/80' : 'text-red-400/80')}>
                            {diff >= 0 ? '+' : ''}NT${Math.round(diff).toLocaleString()}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* Add / edit modal */}
      <AnimatePresence>
        {showAddForm && (
          <CollectionModal
            title="新增收藏"
            initial={{ ...EMPTY_FORM, acquiredDate: todayISO() }}
            onSubmit={handleAdd}
            onClose={() => setShowAddForm(false)}
            submitting={submitting}
          />
        )}
        {editingItem && (
          <CollectionModal
            title="編輯收藏"
            initial={itemToForm(editingItem)}
            onSubmit={f => handleUpdate(editingItem.id, f)}
            onClose={() => setEditingId(null)}
            submitting={submitting}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
