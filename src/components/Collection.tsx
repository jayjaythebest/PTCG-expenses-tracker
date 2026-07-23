import { useState, useRef, useEffect } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCollection } from '../lib/useCollection';
import { CollectionItem, CollectionItemType, CollectionCondition, CardEdition, GradingCompany } from '../types';
import { PTCG_PRODUCTS } from '../data/ptcg-products';
import { cn } from '../lib/utils';
import { recognizeCardFromPhoto } from '../lib/gemini';
import { lookupCard, lookupSetImage, lookupTwCardImage, type ScanLanguage } from '../lib/tcgdex';
import { Plus, Trash2, Pencil, X, Check, TrendingUp, TrendingDown, Package, CreditCard, Layers, Camera, Loader2, Sparkles, ImagePlus, ImageOff } from 'lucide-react';

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

const RARITY_OPTIONS = ['SAR', 'AR', 'SR', 'HR', 'CSR', 'SER', 'RR', 'R', 'U', 'C', 'ACE SPEC', 'Promo', '其他'];

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

const EMPTY_FORM = {
  name: '',
  setName: '',
  series: '',
  cardNumber: '',
  rarity: '',
  itemType: 'single' as CollectionItemType,
  condition: '' as CollectionCondition | '',
  quantity: 1,
  purchasePrice: '',
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

function PriceField({ label, value }: { label: string; value?: number }) {
  if (value == null) return <span className="text-slate-300">—</span>;
  return (
    <span>
      <span className="text-xs text-slate-400 mr-0.5">{label}</span>
      <span className="font-bold">¥{value.toLocaleString()}</span>
    </span>
  );
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
  const [scanResult, setScanResult] = useState<'matched' | 'fallback' | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [fetchingImg, setFetchingImg] = useState(false);
  const [imgMsg, setImgMsg] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handlePhotoScan = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) {
      alert('圖片太大，請選擇小於 10MB 的圖片');
      return;
    }
    setPhotoPreview(URL.createObjectURL(file));
    setScanResult(null);
    setScanning(true);
    try {
      // 1) Gemini reads the reliable identifiers (language + set code + card number).
      const scan = await recognizeCardFromPhoto(file);
      // 2) Resolve authoritative data (name/rarity/series/official art) from TCGdex,
      //    querying the endpoint that matches the detected language (falls back internally).
      const card = scan.setCode && scan.localId
        ? await lookupCard(scan.setCode, scan.localId, scan.language || 'ja')
        : null;

      if (card) {
        setForm(f => ({
          ...f,
          name:       card.name,
          setName:    card.setName || f.setName,
          series:     card.series  || f.series,
          rarity:     card.rarity  || scan.rarity || f.rarity,
          cardNumber: scan.localId || f.cardNumber,
          imageUrl:   card.imageUrl || f.imageUrl,
          edition:    card.edition,
        }));
        setScanResult('matched');
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
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
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
                : 'bg-amber-50 border-amber-200',
            )}>
              <img
                src={scanResult === 'matched' && form.imageUrl ? form.imageUrl : (photoPreview ?? '')}
                alt="card"
                referrerPolicy="no-referrer"
                className="w-12 h-16 object-contain rounded-md border border-slate-200 bg-white flex-shrink-0"
              />
              <p className={cn(
                'text-xs font-bold',
                scanResult === 'matched' ? 'text-emerald-700' : 'text-amber-700',
              )}>
                {form.edition ? `（${EDITION_LABELS[form.edition]}）` : ''}
                {scanResult === 'matched'
                  ? '已從卡片資料庫帶入正確資料，請確認後儲存'
                  : '查無此卡，已填入可辨識的部分，請手動補完'}
              </p>
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

      {/* Quantity + prices */}
      <div className="grid grid-cols-3 gap-2">
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
          <label className="text-xs font-bold text-slate-500 mb-1 block">入手價 (¥)</label>
          <input
            type="number"
            min={0}
            value={form.purchasePrice}
            onChange={e => set('purchasePrice', e.target.value)}
            placeholder="0"
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
        </div>
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
    purchasePrice: f.purchasePrice !== '' ? Number(f.purchasePrice) : undefined,
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
    purchasePrice: item.purchasePrice != null ? String(item.purchasePrice) : '',
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
function GalleryImage({ item }: { item: CollectionItem }) {
  const [src, setSrc] = useState<string | undefined>(item.imageUrl || undefined);
  const [broken, setBroken] = useState(false);

  useEffect(() => {
    let alive = true;
    setBroken(false);
    setSrc(undefined);

    const code = SET_CODE_BY_NAME[item.setName];
    const stored = item.imageUrl || undefined;
    const lang = editionToLang(item.edition ?? '');

    const resolve = async (): Promise<string | undefined> => {
      if (item.itemType === 'single') {
        // Keep genuine scanned card art; otherwise pull the precise official
        // card image by collector number, then a set representative.
        if (stored) return stored;
        if (code && item.cardNumber) {
          const tw = await lookupTwCardImage(code, item.cardNumber);
          if (tw) return tw;
        }
        if (code) return (await lookupSetImage(code, lang))?.imageUrl;
        return undefined;
      }
      // Boxes / packs: prefer the official pack artwork over any stored logo.
      if (code) {
        const rep = await lookupSetImage(code, lang);
        if (rep?.imageUrl) return rep.imageUrl;
      }
      return stored;
    };

    resolve()
      .then(url => { if (alive) setSrc(url); })
      .catch(() => { if (alive) setSrc(stored); });
    return () => { alive = false; };
  }, [item.imageUrl, item.setName, item.edition, item.itemType, item.cardNumber]);

  if (!src || broken) {
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
      onError={() => setBroken(true)}
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
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = items.filter(i => filterType === 'all' || i.itemType === filterType);
  const editingItem = editingId ? (items.find(i => i.id === editingId) ?? null) : null;

  const totalPurchase = items.reduce((s, i) => s + ((i.purchasePrice ?? 0) * i.quantity), 0);
  const totalCurrent  = items.reduce((s, i) => s + ((i.currentValue  ?? 0) * i.quantity), 0);
  const pnl = totalCurrent - totalPurchase;
  const hasPrices = totalPurchase > 0 || totalCurrent > 0;

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
      {/* Stats */}
      {hasPrices && (
        <div className="grid grid-cols-3 gap-3">
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-400 font-bold mb-1">入手總價</p>
            <p className="text-lg font-black text-slate-700">¥{totalPurchase.toLocaleString()}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4 text-center">
            <p className="text-xs text-slate-400 font-bold mb-1">現估總價</p>
            <p className="text-lg font-black text-slate-700">¥{totalCurrent.toLocaleString()}</p>
          </div>
          <div className={cn(
            'rounded-xl border p-4 text-center',
            pnl >= 0 ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200',
          )}>
            <p className="text-xs font-bold mb-1 text-slate-400">損益</p>
            <p className={cn('text-lg font-black flex items-center justify-center gap-1', pnl >= 0 ? 'text-emerald-600' : 'text-red-500')}>
              {pnl >= 0 ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
              {pnl >= 0 ? '+' : ''}¥{pnl.toLocaleString()}
            </p>
          </div>
        </div>
      )}

      {/* Filter + Add */}
      <div className="flex items-center justify-between gap-2">
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

        <button
          onClick={() => { setEditingId(null); setShowAddForm(true); }}
          className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold bg-poke-blue text-white hover:bg-poke-dark-blue transition-colors"
        >
          <Plus className="w-4 h-4" />
          新增
        </button>
      </div>

      {/* Empty state */}
      {filtered.length === 0 && (
        <div className="text-center p-12 bg-white rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">
            {filterType === 'all' ? '尚無收藏紀錄，點右上角「新增」開始記錄吧！' : `尚無${ITEM_TYPE_LABELS[filterType]}紀錄`}
          </p>
        </div>
      )}

      {/* Gallery grid */}
      {filtered.length > 0 && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
          {filtered.map(item => {
            const diff = (item.purchasePrice != null && item.currentValue != null)
              ? (item.currentValue - item.purchasePrice) * item.quantity
              : null;
            return (
              <div
                key={item.id}
                className="group relative bg-white rounded-xl border border-slate-200 overflow-hidden flex flex-col"
              >
                {/* Image */}
                <div className="relative aspect-[3/4] bg-slate-50 border-b border-slate-100">
                  <GalleryImage item={item} />

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

                  {/* Actions */}
                  <div className="absolute top-1.5 right-1.5 flex gap-1">
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
                    {item.condition && (
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

                  <div className="mt-auto pt-1 flex items-baseline justify-between gap-1">
                    <div className="min-w-0">
                      <PriceField label="現估" value={item.currentValue ?? item.purchasePrice} />
                    </div>
                    {diff != null && (
                      <span className={cn('text-[11px] font-bold shrink-0', diff >= 0 ? 'text-emerald-500' : 'text-red-400')}>
                        {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Add / edit modal */}
      <AnimatePresence>
        {showAddForm && (
          <CollectionModal
            title="新增收藏"
            initial={EMPTY_FORM}
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
