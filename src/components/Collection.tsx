import { useState, useRef } from 'react';
import { useCollection } from '../lib/useCollection';
import { CollectionItem, CollectionItemType, CollectionCondition, CardEdition } from '../types';
import { PTCG_PRODUCTS } from '../data/ptcg-products';
import { cn } from '../lib/utils';
import { recognizeCardFromPhoto } from '../lib/gemini';
import { lookupCard } from '../lib/tcgdex';
import { Plus, Trash2, Pencil, X, Check, TrendingUp, TrendingDown, Package, CreditCard, Layers, Camera, Loader2, Sparkles } from 'lucide-react';

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

const SERIES_OPTIONS = [...new Set(PTCG_PRODUCTS.map(p => p.series))];
const SET_OPTIONS = PTCG_PRODUCTS.map(p => ({ value: p.name, series: p.series }));

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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const set = (k: keyof FormState, v: unknown) => setForm(f => ({ ...f, [k]: v }));

  const filteredSets = SET_OPTIONS.filter(s => !form.series || s.series === form.series);

  const handleSeriesChange = (series: string) => {
    set('series', series);
    set('setName', '');
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
      className="bg-white rounded-xl border border-slate-200 p-4 space-y-3"
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
            onChange={e => set('setName', e.target.value)}
            className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-poke-blue bg-white"
          >
            <option value="">選擇...</option>
            {filteredSets.map(s => <option key={s.value} value={s.value}>{s.value}</option>)}
            <option value="其他">其他</option>
          </select>
        </div>
      </div>

      {/* Rarity + Condition (single only) */}
      {form.itemType === 'single' && (
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
        </div>
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
    condition:     (f.condition as CollectionCondition) || undefined,
    quantity:      f.quantity,
    purchasePrice: f.purchasePrice !== '' ? Number(f.purchasePrice) : undefined,
    currentValue:  f.currentValue !== '' ? Number(f.currentValue) : undefined,
    notes:         f.notes || undefined,
    imageUrl:      f.imageUrl || undefined,
    edition:       (f.edition as CardEdition) || undefined,
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
  };
}

export function Collection() {
  const { items, loading, addItem, updateItem, deleteItem } = useCollection();
  const [filterType, setFilterType] = useState<FilterType>('all');
  const [showAddForm, setShowAddForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const filtered = items.filter(i => filterType === 'all' || i.itemType === filterType);

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
          onClick={() => { setShowAddForm(v => !v); setEditingId(null); }}
          className={cn(
            'flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-colors',
            showAddForm
              ? 'bg-slate-100 text-slate-500'
              : 'bg-poke-blue text-white hover:bg-poke-dark-blue',
          )}
        >
          {showAddForm ? <X className="w-4 h-4" /> : <Plus className="w-4 h-4" />}
          {showAddForm ? '取消' : '新增'}
        </button>
      </div>

      {/* Add form */}
      {showAddForm && (
        <CollectionForm
          initial={EMPTY_FORM}
          onSubmit={handleAdd}
          onCancel={() => setShowAddForm(false)}
          submitting={submitting}
        />
      )}

      {/* Empty state */}
      {filtered.length === 0 && !showAddForm && (
        <div className="text-center p-12 bg-white rounded-xl border-2 border-dashed border-slate-200">
          <p className="text-slate-500 text-sm">
            {filterType === 'all' ? '尚無收藏紀錄，點右上角「新增」開始記錄吧！' : `尚無${ITEM_TYPE_LABELS[filterType]}紀錄`}
          </p>
        </div>
      )}

      {/* Item list */}
      <div className="space-y-2">
        {filtered.map(item => (
          <div key={item.id}>
            {editingId === item.id ? (
              <CollectionForm
                initial={itemToForm(item)}
                onSubmit={f => handleUpdate(item.id, f)}
                onCancel={() => setEditingId(null)}
                submitting={submitting}
              />
            ) : (
              <div className="bg-white rounded-xl border border-slate-200 px-4 py-3 flex items-start gap-3">
                {item.imageUrl && (
                  <img
                    src={item.imageUrl}
                    alt={item.name}
                    className="w-12 h-16 object-contain rounded-md border border-slate-100 bg-slate-50 flex-shrink-0 cursor-pointer"
                    onClick={() => window.open(item.imageUrl, '_blank')}
                  />
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <ItemTypeBadge type={item.itemType} />
                    {item.edition && (
                      <span className="text-xs font-bold text-sky-600 bg-sky-50 px-2 py-0.5 rounded-full">
                        {EDITION_LABELS[item.edition]}
                      </span>
                    )}
                    {item.rarity && (
                      <span className="text-xs font-bold text-violet-600 bg-violet-50 px-2 py-0.5 rounded-full">
                        {item.rarity}
                      </span>
                    )}
                    {item.condition && (
                      <span className="text-xs font-bold text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full">
                        {CONDITION_LABELS[item.condition]}
                      </span>
                    )}
                    {item.quantity > 1 && (
                      <span className="text-xs text-slate-400">×{item.quantity}</span>
                    )}
                  </div>

                  <p className="font-black text-slate-800 text-sm leading-tight">{item.name}</p>

                  {(item.setName || item.cardNumber) && (
                    <p className="text-xs text-slate-400 mt-0.5">
                      {item.setName}{item.cardNumber ? ` · ${item.cardNumber}` : ''}
                    </p>
                  )}

                  <div className="flex items-center gap-3 mt-2 text-sm text-slate-600">
                    <PriceField label="入手" value={item.purchasePrice} />
                    {item.purchasePrice != null && item.currentValue != null && (
                      <span className="text-slate-200">|</span>
                    )}
                    <PriceField label="現估" value={item.currentValue} />
                    {item.purchasePrice != null && item.currentValue != null && (() => {
                      const diff = (item.currentValue - item.purchasePrice) * item.quantity;
                      return (
                        <span className={cn('text-xs font-bold', diff >= 0 ? 'text-emerald-500' : 'text-red-400')}>
                          {diff >= 0 ? '+' : ''}¥{diff.toLocaleString()}
                        </span>
                      );
                    })()}
                  </div>

                  {item.notes && (
                    <p className="text-xs text-slate-400 mt-1 italic">{item.notes}</p>
                  )}
                </div>

                <div className="flex gap-1 shrink-0">
                  <button
                    onClick={() => { setEditingId(item.id); setShowAddForm(false); }}
                    className="p-1.5 text-slate-300 hover:text-poke-blue transition-colors rounded-lg hover:bg-slate-50"
                  >
                    <Pencil className="w-4 h-4" />
                  </button>
                  <button
                    onClick={() => handleDelete(item.id)}
                    className="p-1.5 text-slate-300 hover:text-red-400 transition-colors rounded-lg hover:bg-red-50"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
