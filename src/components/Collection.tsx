import { useState, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCollection } from '../lib/useCollection';
import { CollectionItem, CollectionItemType, CollectionCondition, CardEdition, GradingCompany } from '../types';
import { PTCG_PRODUCTS, SERIES_ZH, type PtcgProduct } from '../data/ptcg-products';
import { boxSnkrdunkId } from '../data/ptcg-boxes';
import { cn } from '../lib/utils';
import { recognizeCardFromPhoto } from '../lib/gemini';
import { lookupCard, lookupTwCard, lookupSetImage, lookupTwCardImage, lookupJpCardImage, resolveJaSetCode, jpCardImageUrl, type ScanLanguage } from '../lib/tcgdex';
import { fetchCardPrice, fetchFxJpyToTwd } from '../lib/pricing';
import { Plus, Trash2, Pencil, X, Check, TrendingUp, TrendingDown, Package, CreditCard, Camera, Loader2, Sparkles, ImagePlus, ImageOff, RefreshCw, Search, ArrowUp, ArrowDown, RotateCcw, ChevronDown } from 'lucide-react';

const ITEM_TYPE_LABELS: Record<CollectionItemType, string> = {
  single: '單卡',
  box: '整盒',
};

// Legacy rows may still carry the retired 'pack' item type. Fold anything that
// isn't a single card into 'box' for display so old data never breaks the UI.
const displayType = (t: CollectionItemType | string): CollectionItemType =>
  t === 'single' ? 'single' : 'box';

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

// Map the AI-read slab company label (raw text like "PSA", "Beckett", "CGC") to
// this app's grading enum. Anything recognized but unsupported → 'other'.
function normalizeGradingCompany(raw?: string): GradingCompany | '' {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('psa')) return 'psa';
  if (s.includes('bgs') || s.includes('beckett')) return 'bgs';
  return 'other';
}

const SERIES_OPTIONS = [...new Set(PTCG_PRODUCTS.map(p => p.series))];
const SET_OPTIONS = PTCG_PRODUCTS.map(p => ({ value: p.name, series: p.series }));

// Japanese set name -> official Traditional-Chinese label (falls back to the
// Japanese name when a set has no TW release yet). Used to show Chinese in the
// series/set dropdowns while the stored value stays the Japanese name.
const SET_NAME_ZH: Record<string, string> = Object.fromEntries(
  PTCG_PRODUCTS.filter(p => p.nameZh).map(p => [p.name, p.nameZh as string]),
);
const seriesLabel = (s: string): string => SERIES_ZH[s] ?? s;
const setLabel = (name: string): string => SET_NAME_ZH[name] ?? name;

// Set name (as shown in the form) → TCGdex set code, so we can auto-fetch a
// representative image for boxes / packs / manually-typed items.
const SET_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
  PTCG_PRODUCTS.map(p => [p.name, p.code]),
);

// Reverse of SET_CODE_BY_NAME: a scanned/printed set code → the catalog product,
// so scan branches can persist a setName (the JP name existing rows store) even
// when TCGdex has no entry for the card. Without a stored setName, price lookups
// (kapaipai for zh-tw, Huca for ja) can't resolve which pack the card belongs to
// and the row shows no price. zh-tw MEGA prints "M#F"/"M#aF"; the base JP code
// drops the trailing F (M4F→M4), so we normalize before matching. Codes are
// matched case-insensitively. Duplicate codes (e.g. sv1 = スカーレット/バイオレット)
// resolve to the first product — fine, since both share the same code for pricing.
const productForScanCode = (rawCode: string | undefined | null): PtcgProduct | undefined => {
  const raw = (rawCode ?? '').trim();
  if (!raw) return undefined;
  const upper = raw.toUpperCase();
  const base = /^M\d+[A-Z]*F$/i.test(raw) ? upper.replace(/F$/, '') : upper;
  return (
    PTCG_PRODUCTS.find(p => p.code.toUpperCase() === upper) ??
    PTCG_PRODUCTS.find(p => p.code.toUpperCase() === base)
  );
};

// Dropdown-only label: the set name plus its expansion code in parentheses,
// e.g. "深淵之瞳 (SV6A)". Helps users match the code printed on the pack and
// pick manually when a scan fails or misreads. Kept separate from setLabel so
// stored item names stay clean (code-free). Codes are uppercased to match the
// print on the card.
const setOptionLabel = (name: string): string => {
  const code = SET_CODE_BY_NAME[name];
  return code ? `${setLabel(name)} (${code.toUpperCase()})` : setLabel(name);
};

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

// Compact zh-TW relative time ("剛剛" / "3 小時前" / "5 天前") for the last
// price-fetch timestamp. Returns null for missing/invalid input.
const relativeTime = (iso: string | null | undefined): string | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  const mins = Math.floor((Date.now() - t) / 60000);
  if (mins < 1) return '剛剛';
  if (mins < 60) return `${mins} 分鐘前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小時前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  const months = Math.floor(days / 30);
  return `${months} 個月前`;
};

// Whether a stored market-price condition is a graded slab (PSA10, BGS9.5…) as
// opposed to a raw grade (A/B/C/D). Used to label a graded reference price on an
// ungraded card as "參考" so it isn't mistaken for a raw price.
const isGradedCondition = (c: string | null | undefined): boolean =>
  !!c && /^(PSA|BGS|CGC|ARS)/i.test(c);

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
  // Manual market-price override (TWD). When set, it replaces the auto-fetched
  // price and is protected from auto-refresh (source is stamped 'manual'). Used
  // for thin-market chase cards whose auto price is unreliable — the user fills
  // in a value they trust (from 蝦皮/樂天/Snkrdunk/…).
  manualPrice: '',
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
  if (displayType(type) === 'single') return <CreditCard className="w-3.5 h-3.5" />;
  return <Package className="w-3.5 h-3.5" />;
}

function ItemTypeBadge({ type }: { type: CollectionItemType }) {
  const t = displayType(type);
  const colours: Record<CollectionItemType, string> = {
    single: 'bg-poke-accent/20 text-poke-accent',
    box: 'bg-amber-400/20 text-amber-300',
  };
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-bold', colours[t])}>
      <ItemTypeIcon type={t} />
      {ITEM_TYPE_LABELS[t]}
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
    'w-12 h-16 rounded-md border bg-white/5 flex-shrink-0 overflow-hidden flex items-center justify-center',
    className,
  );
  if (!src || broken) {
    return (
      <div className={cn(box, 'border-white/10 text-slate-500')} title="無圖片">
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
      className={cn(box, 'border-white/10 object-contain', onClick && 'cursor-pointer')}
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
        setForm(f => ({
          ...f,
          name:       twCard.name    || scan.name || f.name,
          setName:    prod?.name     || f.setName,
          series:     prod?.series   || f.series,
          rarity:     scan.rarity    || f.rarity,
          cardNumber: scan.localId   || twCard.localId || f.cardNumber,
          imageUrl:   twCard.imageUrl || f.imageUrl,
          edition:    'zh-tw',
        }));
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
        setForm(f => ({
          ...f,
          name:       card.name,
          setName:    card.setName || prod?.name   || f.setName,
          series:     card.series  || prod?.series || f.series,
          rarity:     card.rarity  || scan.rarity || f.rarity,
          cardNumber: scan.localId || f.cardNumber,
          imageUrl:   img || f.imageUrl,
          edition,
        }));
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
        setForm(f => ({
          ...f,
          name:       scan.name    || f.name,
          setName:    prod?.name   || f.setName,
          series:     prod?.series || f.series,
          cardNumber: scan.localId || f.cardNumber,
          rarity:     scan.rarity  || f.rarity,
          edition:    isZhTw ? 'zh-tw' : (scan.language || f.edition),
          imageUrl:   img || f.imageUrl,
        }));
        // Show WHAT was read, not just that the catalog missed. Secret rares are
        // the usual cause (TCGdex's zh-tw data stops at the official set total,
        // so a UR numbered past it can't match) — and without these identifiers
        // on screen there's no way to tell that apart from a genuine misread.
        setScanHint(
          `辨識為 ${scan.setCode || '?'} #${scan.localId || '?'}（${isZhTw ? '繁中' : scan.language || 'ja'}）`
          + '；卡片資料庫查無此編號，請確認系列與卡號'
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
              placeholder="e.g. 199/165"
              className="w-full border border-white/10 bg-white/5 rounded-lg px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent"
            />
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

// Market-price fields for a manual override. Stamped source 'manual' so the
// auto-refresh (client button + daily cron) leaves it alone. Stored in TWD —
// that's what the user reads off 蝦皮/樂天/local marketplaces.
function manualPriceFields(value: string): Partial<CollectionItem> {
  return {
    marketPrice: Number(value),
    marketPriceCurrency: 'TWD',
    marketPriceSource: 'manual',
    marketPriceUpdatedAt: new Date().toISOString(),
    marketPriceCondition: undefined,
  };
}

function formToItem(f: FormState): Omit<CollectionItem, 'id' | 'createdAt'> {
  // Box names are optional: if left blank, fall back to the chosen set's label
  // (Chinese preferred) so the row still has a readable name.
  const name = f.name.trim() || (f.itemType === 'box' && f.setName ? setLabel(f.setName) : '');
  return {
    name,
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
    manualPrice:   item.marketPriceSource === 'manual' && item.marketPrice != null ? String(item.marketPrice) : '',
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
  // Each candidate carries a `cover` flag: real card art fills the tile edge-to-
  // edge (object-cover) so it looks crisp and large; set-logo / box fallbacks are
  // letterboxed (object-contain) so their wide artwork isn't cropped.
  const [candidates, setCandidates] = useState<{ url: string; cover: boolean }[]>([]);
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

    const build = async (): Promise<{ url: string; cover: boolean }[]> => {
      const out: { url: string; cover: boolean }[] = [];
      // cover=true for real card art (fills the tile); cover=false for set-logo
      // fallbacks and box art (letterboxed so nothing important is cropped).
      const push = (u?: string | null, cover = true) => {
        if (u && !out.some(c => c.url === u)) out.push({ url: u, cover });
      };

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
        if (sc) push((await lookupSetImage(sc, lang))?.imageUrl, false); // set logo last (letterboxed)
        return out;
      }

      // Boxes (incl. legacy 'pack'): prefer official set art, then stored logo —
      // both letterboxed (box/logo art is wide and shouldn't be cropped).
      if (sc) push((await lookupSetImage(sc, lang))?.imageUrl, false);
      push(storedUsable, false);
      return out;
    };

    build()
      .then(list => { if (alive) setCandidates(list); })
      .catch(() => { if (alive) setCandidates(storedUsable ? [{ url: storedUsable, cover: false }] : []); });
    return () => { alive = false; };
  }, [item.imageUrl, item.setName, item.edition, item.itemType, item.cardNumber]);

  const cand = candidates[idx];
  if (!cand) {
    return (
      <div className="w-full h-full flex flex-col items-center justify-center gap-1 text-slate-600">
        <div className="scale-[2.2]"><ItemTypeIcon type={item.itemType} /></div>
        <span className="text-[10px] font-bold mt-2">無圖片</span>
      </div>
    );
  }
  return (
    <img
      src={cand.url}
      alt={item.name}
      referrerPolicy="no-referrer"
      onError={() => setIdx(i => i + 1)}
      className={cn(
        'w-full h-full',
        cand.cover ? 'object-cover' : 'object-contain p-2',
      )}
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

export function Collection() {
  const { items, deletedItems, loading, addItem, updateItem, deleteItem, restoreItem, purgeItem } = useCollection();
  const [showGraveyard, setShowGraveyard] = useState(false);
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('value');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [fEdition, setFEdition] = useState<'all' | CardEdition>('all');
  const [fRarity, setFRarity] = useState<'all' | string>('all');
  const [fGraded, setFGraded] = useState<GradedFilter>('all');
  const [fCondition, setFCondition] = useState<'all' | CollectionCondition>('all');
  const [fPrice, setFPrice] = useState<'all' | 'has' | 'none'>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [fxRate, setFxRate] = useState(0.2); // JPY -> TWD, refined from /api/fx
  const [refreshing, setRefreshing] = useState(false);
  const [priceProgress, setPriceProgress] = useState<{ done: number; total: number } | null>(null);
  const [refreshErrors, setRefreshErrors] = useState<string[]>([]); // card names that failed to price
  const [refreshDone, setRefreshDone] = useState<number | null>(null); // count priced on last refresh

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
      if (filterType !== 'all' && displayType(i.itemType) !== filterType) return false;
      if (fEdition !== 'all' && i.edition !== fEdition) return false;
      if (fRarity !== 'all' && i.rarity !== fRarity) return false;
      if (fGraded === 'graded' && !i.isGraded) return false;
      if (fGraded === 'raw' && i.isGraded) return false;
      if (fCondition !== 'all' && i.condition !== fCondition) return false;
      if (fPrice === 'has' && i.marketPrice == null) return false;
      if (fPrice === 'none' && i.marketPrice != null) return false;
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
  }, [items, filterType, fEdition, fRarity, fGraded, fCondition, fPrice, query, sortKey, sortDir, fxRate]);

  const filtersActive = filterType !== 'all' || fEdition !== 'all' || fRarity !== 'all'
    || fGraded !== 'all' || fCondition !== 'all' || fPrice !== 'all' || query.trim() !== '';

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

  // The Snkrdunk box id for an item, or undefined when it can't be auto-priced.
  // Only boxes that map to a curated JA Snkrdunk product id are priceable.
  const boxIdOf = (i: { itemType: CollectionItemType | string; setName: string; edition?: CardEdition }): number | undefined =>
    displayType(i.itemType) === 'box' ? boxSnkrdunkId(SET_CODE_BY_NAME[i.setName] ?? '', i.edition) : undefined;

  // Items we can auto-price: every single (ja -> Huca, zh-tw -> kapaipai) plus
  // boxes that have a curated Snkrdunk id (ja -> Snkrdunk). Manual overrides are
  // excluded so "更新價格" never clobbers a price the user set by hand.
  const priceable = items.filter(
    i => (i.itemType === 'single' || boxIdOf(i) != null) && i.marketPriceSource !== 'manual',
  );

  const handleRefreshPrices = async () => {
    if (refreshing || priceable.length === 0) return;
    setRefreshing(true);
    setPriceProgress({ done: 0, total: priceable.length });
    setRefreshErrors([]);
    setRefreshDone(null);
    // Refresh the FX rate alongside prices so the display stays consistent.
    fetchFxJpyToTwd().then(setFxRate).catch(() => {});
    let done = 0;
    let ok = 0;
    const failed: string[] = [];
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
          isGraded: item.isGraded,
          gradingCompany: item.gradingCompany,
          grade: item.grade,
          itemType: displayType(item.itemType),
          snkrdunkId: boxIdOf(item),
        });
        if (p && p.price != null) {
          await updateItem(item.id, {
            marketPrice: p.price,
            marketPriceCurrency: p.currency ?? (edition === 'zh-tw' ? 'TWD' : 'JPY'),
            marketPriceSource: p.source ?? (edition === 'zh-tw' ? 'kapaipai' : 'huca'),
            marketPriceUpdatedAt: p.updatedAt,
            marketPriceCondition: p.condition ?? undefined,
          });
          ok += 1;
        } else {
          failed.push(item.name);
        }
      } catch (err) {
        console.error('price refresh failed for', item.name, err);
        failed.push(item.name);
      }
      done += 1;
      setPriceProgress({ done, total: priceable.length });
    }
    setRefreshing(false);
    setPriceProgress(null);
    setRefreshErrors(failed);
    setRefreshDone(ok);
  };

  // Resolve the live market price for a single card so a newly added row shows
  // its current value immediately (previously ONLY the "更新價格" button did
  // this, so freshly added cards had a blank estimate). Non-singles and lookup
  // failures pass through unpriced. ja -> Huca (JPY), zh-tw -> kapaipai (TWD).
  const withMarketPrice = async (
    item: Omit<CollectionItem, 'id' | 'createdAt'>,
  ): Promise<Omit<CollectionItem, 'id' | 'createdAt'>> => {
    const snkrdunkId = boxIdOf(item);
    if (item.itemType !== 'single' && snkrdunkId == null) return item;
    const edition = item.edition ?? 'ja';
    const setCode = SET_CODE_BY_NAME[item.setName] ?? '';
    try {
      const p = await fetchCardPrice({
        setCode,
        setName: item.setName,
        number: item.cardNumber,
        name: item.name,
        edition,
        isGraded: item.isGraded,
        gradingCompany: item.gradingCompany,
        grade: item.grade,
        itemType: displayType(item.itemType),
        snkrdunkId,
      });
      if (p && p.price != null) {
        return {
          ...item,
          marketPrice: p.price,
          marketPriceCurrency: p.currency ?? (edition === 'zh-tw' ? 'TWD' : 'JPY'),
          marketPriceSource: p.source ?? (edition === 'zh-tw' ? 'kapaipai' : 'huca'),
          marketPriceUpdatedAt: p.updatedAt,
          marketPriceCondition: p.condition ?? undefined,
        };
      }
    } catch (err) {
      console.error('auto price lookup failed for', item.name, err);
    }
    return item;
  };

  const handleAdd = async (f: FormState) => {
    setSubmitting(true);
    try {
      // Auto-price the card on the way in so its market value populates without
      // a separate "更新價格" tap. Also refresh the FX rate so the TWD total is
      // consistent with the just-fetched price.
      fetchFxJpyToTwd().then(setFxRate).catch(() => {});
      const base = formToItem(f);
      // A manual market price wins over (and skips) the auto-fetch.
      const toAdd = f.manualPrice !== ''
        ? { ...base, ...manualPriceFields(f.manualPrice) }
        : await withMarketPrice(base);
      await addItem(toAdd);
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
      const base = formToItem(f);
      const prev = items.find(i => i.id === id);
      let updates: Omit<CollectionItem, 'id' | 'createdAt'> = base;
      if (f.manualPrice !== '') {
        // User set/kept a manual override → store it, stamped 'manual'.
        updates = { ...base, ...manualPriceFields(f.manualPrice) };
      } else if (prev?.marketPriceSource === 'manual') {
        // Manual override was cleared → revert to auto: re-fetch, or wipe the
        // stale manual price so the row re-prices on the next refresh.
        const repriced = await withMarketPrice(base);
        updates = repriced.marketPrice != null
          ? repriced
          : { ...base, marketPrice: undefined, marketPriceCurrency: undefined,
              marketPriceSource: undefined, marketPriceUpdatedAt: undefined, marketPriceCondition: undefined };
      }
      await updateItem(id, updates);
      setEditingId(null);
    } catch (err) {
      console.error(err);
      alert('更新失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  };

  // Soft delete → the card moves to the 已刪除 graveyard, where it can be
  // restored or permanently removed.
  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除這筆收藏嗎？（可到「已刪除」區域還原）')) return;
    try {
      await deleteItem(id);
    } catch (err) {
      console.error(err);
      alert('刪除失敗');
    }
  };

  const handleRestore = async (id: string) => {
    try {
      await restoreItem(id);
    } catch (err) {
      console.error(err);
      alert('還原失敗');
    }
  };

  const handlePurge = async (id: string) => {
    if (!confirm('永久刪除後無法復原，確定嗎？')) return;
    try {
      await purgeItem(id);
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
                className="w-full pl-9 pr-3 py-2 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-poke-accent focus:ring-1 focus:ring-poke-accent"
              />
            </div>

            <div className="flex items-center gap-1.5">
              <select
                value={sortKey}
                onChange={e => setSortKey(e.target.value as SortKey)}
                className="px-2.5 py-2 rounded-lg bg-surface border border-white/10 text-sm font-bold text-slate-200 focus:outline-none focus:border-poke-accent"
                title="排序依據"
              >
                {(Object.keys(SORT_LABELS) as SortKey[]).map(k => (
                  <option key={k} value={k}>{SORT_LABELS[k]}</option>
                ))}
              </select>
              <button
                onClick={() => setSortDir(d => d === 'asc' ? 'desc' : 'asc')}
                title={sortDir === 'asc' ? '升序（低→高）' : '降序（高→低）'}
                className="p-2 rounded-lg bg-white/5 border border-white/10 text-slate-400 hover:text-poke-accent hover:border-poke-accent transition-colors"
              >
                {sortDir === 'asc' ? <ArrowUp className="w-4 h-4" /> : <ArrowDown className="w-4 h-4" />}
              </button>
            </div>

            {priceable.length > 0 && (
              <button
                onClick={handleRefreshPrices}
                disabled={refreshing}
                title="更新市場價格（日文卡 Huca、繁中卡 卡拍拍）"
                className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold bg-white/5 border border-white/10 text-slate-400 hover:text-poke-accent hover:border-poke-accent transition-colors disabled:opacity-60"
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
            <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5 gap-0.5">
              {(['all', 'single', 'box'] as FilterType[]).map(t => (
                <button
                  key={t}
                  onClick={() => setFilterType(t)}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                    filterType === t
                      ? 'bg-poke-blue text-white shadow-sm'
                      : 'text-slate-400 hover:text-slate-200',
                  )}
                >
                  {t === 'all' ? '全部' : ITEM_TYPE_LABELS[t]}
                  <span className="ml-1 opacity-60">
                    {t === 'all' ? items.length : items.filter(i => displayType(i.itemType) === t).length}
                  </span>
                </button>
              ))}
            </div>

            {editionsPresent.length > 0 && (
              <div className="flex bg-white/5 border border-white/10 rounded-lg p-0.5 gap-0.5">
                <button
                  onClick={() => setFEdition('all')}
                  className={cn(
                    'px-3 py-1.5 rounded-md text-xs font-bold transition-colors',
                    fEdition === 'all' ? 'bg-poke-blue text-white shadow-sm' : 'text-slate-400 hover:text-slate-200',
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
                      fEdition === e ? 'bg-poke-blue text-white shadow-sm' : 'text-slate-400 hover:text-slate-200',
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
              className="px-2.5 py-1.5 rounded-lg bg-surface border border-white/10 font-bold text-slate-200 focus:outline-none focus:border-poke-accent"
              title="稀有度"
            >
              <option value="all">全部稀有度</option>
              {RARITY_OPTIONS.map(r => <option key={r} value={r}>{r}</option>)}
            </select>

            <select
              value={fGraded}
              onChange={e => setFGraded(e.target.value as GradedFilter)}
              className="px-2.5 py-1.5 rounded-lg bg-surface border border-white/10 font-bold text-slate-200 focus:outline-none focus:border-poke-accent"
              title="鑑定狀態"
            >
              <option value="all">全部（鑑定/未鑑定）</option>
              <option value="graded">已鑑定</option>
              <option value="raw">未鑑定</option>
            </select>

            <select
              value={fCondition}
              onChange={e => setFCondition(e.target.value as 'all' | CollectionCondition)}
              className="px-2.5 py-1.5 rounded-lg bg-surface border border-white/10 font-bold text-slate-200 focus:outline-none focus:border-poke-accent"
              title="品相"
            >
              <option value="all">全部品相</option>
              {(Object.keys(CONDITION_LABELS) as CollectionCondition[]).map(c => (
                <option key={c} value={c}>{CONDITION_LABELS[c]}</option>
              ))}
            </select>

            <select
              value={fPrice}
              onChange={e => setFPrice(e.target.value as 'all' | 'has' | 'none')}
              className="px-2.5 py-1.5 rounded-lg bg-surface border border-white/10 font-bold text-slate-200 focus:outline-none focus:border-poke-accent"
              title="價格狀態"
            >
              <option value="all">全部（有/無價格）</option>
              <option value="has">已有市場價</option>
              <option value="none">尚無市場價</option>
            </select>

            <span className="ml-auto text-slate-400 font-bold">{filtered.length} 筆</span>
          </div>
        </div>
      )}

      {/* Price refresh result: surface failures instead of only console.error */}
      {!refreshing && refreshDone != null && (
        <div className="rounded-xl border border-white/10 bg-surface px-3 py-2 text-xs">
          <span className="font-bold text-emerald-400">已更新 {refreshDone} 張價格</span>
          {refreshErrors.length > 0 && (
            <span className="text-slate-400">
              {' · '}
              <span className="font-bold text-red-400">{refreshErrors.length} 張未取得價格</span>
              ：{refreshErrors.slice(0, 8).join('、')}{refreshErrors.length > 8 ? ' …' : ''}
            </span>
          )}
          <button
            onClick={() => { setRefreshDone(null); setRefreshErrors([]); }}
            className="ml-2 text-slate-500 hover:text-slate-300 font-bold"
          >
            ×
          </button>
        </div>
      )}

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center p-12 bg-surface rounded-2xl border-2 border-dashed border-white/10">
          <p className="text-slate-400 text-sm">
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
                className="group relative bg-surface rounded-2xl border border-white/10 overflow-hidden flex flex-col shadow-lg shadow-black/20 hover:shadow-xl hover:border-white/20 transition-shadow"
              >
                {/* Image */}
                <div className="relative aspect-[3/4] bg-white/5 border-b border-white/10">
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

                  {/* Actions (always visible so they work on touch/mobile too) */}
                  <div className="absolute top-1.5 right-1.5 flex gap-1">
                    <button
                      onClick={() => { setEditingId(item.id); setShowAddForm(false); }}
                      className="p-1.5 rounded-lg bg-black/40 backdrop-blur text-slate-200 hover:text-poke-accent shadow-sm transition-colors"
                      title="編輯"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => handleDelete(item.id)}
                      className="p-1.5 rounded-lg bg-black/40 backdrop-blur text-slate-200 hover:text-red-400 shadow-sm transition-colors"
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
                      <span className="text-[10px] font-bold text-sky-300 bg-sky-500/15 px-1.5 py-0.5 rounded-full">
                        {EDITION_LABELS[item.edition]}
                      </span>
                    )}
                    {item.rarity && (
                      <span className="text-[10px] font-bold text-violet-300 bg-violet-500/15 px-1.5 py-0.5 rounded-full">
                        {item.rarity}
                      </span>
                    )}
                    {!item.isGraded && item.condition && (
                      <span className="text-[10px] font-bold text-slate-300 bg-white/10 px-1.5 py-0.5 rounded-full">
                        {CONDITION_LABELS[item.condition]}
                      </span>
                    )}
                  </div>

                  <p className="font-black text-slate-100 text-sm leading-tight line-clamp-2">{item.name}</p>

                  {(item.setName || item.cardNumber) && (
                    <p className="text-[11px] text-slate-400 truncate">
                      {item.setName}{item.cardNumber ? ` · ${item.cardNumber}` : ''}
                    </p>
                  )}

                  <div className="mt-auto pt-1.5">
                    <div className="flex items-baseline justify-between gap-1">
                      <span
                        className="text-base font-black text-slate-100"
                        title={item.marketPriceSource ? `市場價來源：${item.marketPriceSource === 'manual' ? '手動輸入' : item.marketPriceSource}` : undefined}
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
                    {/* Provenance: price source · when fetched · condition. A graded
                        reference price on an ungraded card is flagged "參考". */}
                    {item.marketPrice != null && (item.marketPriceSource || item.marketPriceUpdatedAt || item.marketPriceCondition) && (
                      <p className="mt-0.5 text-[10px] text-slate-400 truncate">
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
                  </div>
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {/* 已刪除 graveyard — soft-deleted cards, restorable or purgeable. */}
      {deletedItems.length > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setShowGraveyard(v => !v)}
            className="flex items-center gap-1.5 text-sm font-bold text-slate-400 hover:text-slate-200 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
            已刪除（{deletedItems.length}）
            <ChevronDown className={cn('w-4 h-4 transition-transform', showGraveyard && 'rotate-180')} />
          </button>

          {showGraveyard && (
            <div className="mt-3 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
              {deletedItems.map(item => (
                <div
                  key={item.id}
                  className="relative bg-surface/60 rounded-2xl border border-white/10 overflow-hidden flex flex-col opacity-75"
                >
                  <div className="relative aspect-[3/4] bg-white/5 border-b border-white/10 grayscale">
                    <GalleryImage item={item} />
                  </div>
                  <div className="p-2.5 flex flex-col gap-2 flex-1">
                    <p className="font-black text-slate-200 text-sm leading-tight line-clamp-2">{item.name}</p>
                    {(item.setName || item.cardNumber) && (
                      <p className="text-[11px] text-slate-500 truncate">
                        {item.setName}{item.cardNumber ? ` · ${item.cardNumber}` : ''}
                      </p>
                    )}
                    <div className="mt-auto flex gap-1.5">
                      <button
                        onClick={() => handleRestore(item.id)}
                        className="flex-1 inline-flex items-center justify-center gap-1 py-1.5 rounded-lg bg-emerald-500/15 text-emerald-300 hover:bg-emerald-500/25 text-[11px] font-bold transition-colors"
                      >
                        <RotateCcw className="w-3.5 h-3.5" /> 還原
                      </button>
                      <button
                        onClick={() => handlePurge(item.id)}
                        className="inline-flex items-center justify-center gap-1 px-2.5 py-1.5 rounded-lg bg-red-500/10 text-red-300 hover:bg-red-500/20 text-[11px] font-bold transition-colors"
                        title="永久刪除"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
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
