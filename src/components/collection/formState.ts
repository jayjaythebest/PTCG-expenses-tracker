// The shape the add/edit form holds while the user is typing, and the two
// translations between it and a stored CollectionItem. Kept apart from the form
// component because the container also needs them: it converts a submitted form
// into a row (formToItem), pre-fills the edit modal (itemToForm), and checks for
// duplicates before inserting.
import { CollectionItem, CollectionItemType, CollectionCondition, CardEdition, GradingCompany } from '../../types';
import { setLabel } from './constants';

export const EMPTY_FORM = {
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

export type FormState = typeof EMPTY_FORM;

// Local YYYY-MM-DD for date <input> defaults (avoids the UTC shift toISOString
// would introduce near midnight).
export const todayISO = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Market-price fields for a manual override. Stamped source 'manual' so the
// auto-refresh (client button + daily cron) leaves it alone. Stored in TWD —
// that's what the user reads off 蝦皮/樂天/local marketplaces.
export function manualPriceFields(value: string): Partial<CollectionItem> {
  return {
    marketPrice: Number(value),
    marketPriceCurrency: 'TWD',
    marketPriceSource: 'manual',
    marketPriceUpdatedAt: new Date().toISOString(),
    marketPriceCondition: undefined,
  };
}

export function formToItem(f: FormState): Omit<CollectionItem, 'id' | 'createdAt'> {
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

export function itemToForm(item: CollectionItem): FormState {
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
