// Labels, catalog lookups and the tiny presentational atoms shared by every
// piece of the collection UI (the gallery container, the add/edit form, the
// detail sheet, the merge prompt). Split out of Collection.tsx so those files
// can be read on their own — nothing here has behaviour of its own.
import { useState } from 'react';
import { CollectionItemType, CollectionCondition, CardEdition, GradingCompany } from '../../types';
import { PTCG_PRODUCTS, SERIES_ZH, type PtcgProduct } from '../../data/ptcg-products';
import { cn } from '../../lib/utils';
import { collectorKey } from '../../lib/mergeCandidates';
import { type ScanLanguage } from '../../lib/tcgdex';
import { CreditCard, Package } from 'lucide-react';

export const ITEM_TYPE_LABELS: Record<CollectionItemType, string> = {
  single: '單卡',
  box: '整盒',
};

// Legacy rows may still carry the retired 'pack' item type. Fold anything that
// isn't a single card into 'box' for display so old data never breaks the UI.
export const displayType = (t: CollectionItemType | string): CollectionItemType =>
  t === 'single' ? 'single' : 'box';

export const CONDITION_LABELS: Record<CollectionCondition, string> = {
  mint: 'Mint',
  nm: 'NM',
  lp: 'LP',
  mp: 'MP',
};

// MA is its own rarity (the MEGA-series mark printed on the card), not a kind of
// AR/SAR — collapsing it into either loses a distinction the cards actually make.
export const RARITY_OPTIONS = ['UR', 'MUR', 'MA', 'SAR', 'AR', 'SR', 'HR', 'CSR', 'SER', 'RR', 'R', 'U', 'C', 'ACE SPEC', 'Promo', '其他'];

export const EDITION_LABELS: Record<CardEdition, string> = {
  'ja': '日文版',
  'zh-tw': '繁體中文版',
  'en': '英文版',
};

export const GRADING_LABELS: Record<GradingCompany, string> = {
  psa: 'PSA',
  bgs: 'BGS',
  other: '其他',
};

export const GRADE_OPTIONS = ['10', '9.5', '9', '8.5', '8', '7.5', '7', '6.5', '6', '5.5', '5', '4', '3', '2', '1'];

// Map the AI-read slab company label (raw text like "PSA", "Beckett", "CGC") to
// this app's grading enum. Anything recognized but unsupported → 'other'.
export function normalizeGradingCompany(raw?: string): GradingCompany | '' {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s.includes('psa')) return 'psa';
  if (s.includes('bgs') || s.includes('beckett')) return 'bgs';
  return 'other';
}

export const SERIES_OPTIONS = [...new Set(PTCG_PRODUCTS.map(p => p.series))];
export const SET_OPTIONS = PTCG_PRODUCTS.map(p => ({ value: p.name, series: p.series }));

// Japanese set name -> official Traditional-Chinese label (falls back to the
// Japanese name when a set has no TW release yet). Used to show Chinese in the
// series/set dropdowns while the stored value stays the Japanese name.
const SET_NAME_ZH: Record<string, string> = Object.fromEntries(
  PTCG_PRODUCTS.filter(p => p.nameZh).map(p => [p.name, p.nameZh as string]),
);
export const seriesLabel = (s: string): string => SERIES_ZH[s] ?? s;
export const setLabel = (name: string): string => SET_NAME_ZH[name] ?? name;

// Set name (as shown in the form) → TCGdex set code, so we can auto-fetch a
// representative image for boxes / packs / manually-typed items.
export const SET_CODE_BY_NAME: Record<string, string> = Object.fromEntries(
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
export const productForScanCode = (rawCode: string | undefined | null): PtcgProduct | undefined => {
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
export const setOptionLabel = (name: string): string => {
  const code = SET_CODE_BY_NAME[name];
  return code ? `${setLabel(name)} (${code.toUpperCase()})` : setLabel(name);
};

export const editionToLang = (e: CardEdition | ''): ScanLanguage => (e === 'zh-tw' ? 'zh-tw' : 'ja');

// Whether a stored market-price condition is a graded slab (PSA10, BGS9.5…) as
// opposed to a raw grade (A/B/C/D). Used to label a graded reference price on an
// ungraded card as "參考" so it isn't mistaken for a raw price.
export const isGradedCondition = (c: string | null | undefined): boolean =>
  !!c && /^(PSA|BGS|CGC|ARS)/i.test(c);

// Pull the printed collector number out of possibly-messy stored text, for the
// image CDNs that key on it — the same normalisation the duplicate check uses,
// so a card that counts as "already in the collection" also resolves to the
// same artwork.
export const collectorNo = collectorKey;

export function ItemTypeIcon({ type }: { type: CollectionItemType }) {
  if (displayType(type) === 'single') return <CreditCard className="w-3.5 h-3.5" />;
  return <Package className="w-3.5 h-3.5" />;
}

export function ItemTypeBadge({ type }: { type: CollectionItemType }) {
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

// Consistent image slot for a collection item. Renders the artwork when we have
// a working URL, otherwise a muted placeholder that shows the item type — so
// every row keeps the same layout whether or not it has a picture. Broken URLs
// (e.g. a logo that 404s) fall back to the placeholder automatically.
export function Thumb({
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
