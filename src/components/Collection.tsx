import { useState, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import { useCollection } from '../lib/useCollection';
import { CollectionItem, CollectionItemType, CollectionCondition, CardEdition } from '../types';
import { boxSnkrdunkId } from '../data/ptcg-boxes';
import { COLLECTION_OWNERS, PRIMARY_OWNER, ownerOf } from '../data/collectionOwners';
import { cn, relativeTime } from '../lib/utils';
// Value math lives in one tested module (src/lib/collectionValue.ts) so the home
// summary, this page and the daily snapshot can never drift apart on what a card
// is worth.
import { toTwd, estValue } from '../lib/collectionValue';
import { fetchCardPrice, fetchFxJpyToTwd, type CardPrice } from '../lib/pricing';
import { findMergeCandidates, findDuplicateGroups, planMerge } from '../lib/mergeCandidates';
import { ConfirmDialog } from './ConfirmDialog';
// The gallery used to be one 2.5k-line file. Everything imported below is a pure
// move out of it: labels/catalog lookups in ./collection/constants, the
// form <-> row translations in ./collection/formState, and one file per modal.
// What stays here is the container — state, filtering, the grid, the actions.
import {
  ITEM_TYPE_LABELS, CONDITION_LABELS, RARITY_OPTIONS, EDITION_LABELS, GRADING_LABELS,
  displayType, SET_CODE_BY_NAME, isGradedCondition, ItemTypeBadge,
} from './collection/constants';
import { EMPTY_FORM, todayISO, manualPriceFields, formToItem, itemToForm, type FormState } from './collection/formState';
import { GalleryImage } from './collection/GalleryImage';
import { CollectionModal } from './collection/CollectionForm';
import { MergePromptModal } from './collection/MergePromptModal';
import { CardDetailModal } from './collection/CardDetailModal';
import { Plus, Trash2, Pencil, TrendingUp, TrendingDown, RefreshCw, Search, ArrowUp, ArrowDown, RotateCcw, ChevronDown, Layers } from 'lucide-react';

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

export function Collection() {
  const { items: allItems, deletedItems: allDeletedItems, loading, addItem, updateItem, deleteItem, restoreItem, purgeItem } = useCollection();
  // Whose collection is on screen. The account is shared, so this is a view
  // filter and nothing more — it decides which cards are listed, which total is
  // shown, and which tab a newly added card is filed under.
  const [owner, setOwner] = useState<string>(PRIMARY_OWNER);
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
  // Pending add that duplicates existing rows: the form as submitted, plus the
  // rows it could be merged into. Non-null = the 「已經有這個了」 prompt is open.
  const [mergeAsk, setMergeAsk] = useState<{ form: FormState; candidates: CollectionItem[] } | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [detailId, setDetailId] = useState<string | null>(null);
  // Per-card price refresh, driven from the detail modal.
  const [pricingId, setPricingId] = useState<string | null>(null);
  const [priceMsg, setPriceMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  // Destructive/overwriting actions ask through ConfirmDialog instead of the
  // native confirm(): the browser dialog is a different visual language, and on
  // iOS Safari it can be suppressed outright — which would turn "確認刪除" into
  // "delete without asking". Non-null = the dialog is open.
  const [confirmAsk, setConfirmAsk] = useState<{
    title: string;
    message: React.ReactNode;
    confirmLabel: string;
    destructive?: boolean;
    run: () => Promise<void>;
  } | null>(null);
  const [confirmBusy, setConfirmBusy] = useState(false);
  // Failures that used to be alert() — shown as a dismissible banner so the
  // message can't be missed but also doesn't block the page.
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [fxRate, setFxRate] = useState(0.2); // JPY -> TWD, refined from /api/fx
  const [refreshing, setRefreshing] = useState(false);
  const [priceProgress, setPriceProgress] = useState<{ done: number; total: number } | null>(null);
  const [refreshErrors, setRefreshErrors] = useState<string[]>([]); // card names that failed to price
  const [refreshDone, setRefreshDone] = useState<number | null>(null); // count priced on last refresh

  useEffect(() => {
    fetchFxJpyToTwd().then(setFxRate).catch(() => {});
  }, []);

  // Everything below this line works off ONE owner's cards. Two collections
  // living in one table must never be summed together — the hero總值, 收藏件數,
  // 損益 and the bulk price refresh all read these lists, so filtering once here
  // is what keeps a friend's cards out of the account holder's numbers.
  const items = useMemo(() => allItems.filter(i => ownerOf(i) === owner), [allItems, owner]);
  const deletedItems = useMemo(() => allDeletedItems.filter(i => ownerOf(i) === owner), [allDeletedItems, owner]);

  const editingItem = editingId ? (items.find(i => i.id === editingId) ?? null) : null;
  // Looked up from `items` (not held as a snapshot) so the modal re-renders with
  // the new price the moment a per-card refresh writes one.
  const detailItem = detailId ? (items.find(i => i.id === detailId) ?? null) : null;

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

  // Rows already in this tab that are the same product split across several
  // entries. The add-time prompt can't catch these — they were split before it
  // existed, or on purpose — so the gallery offers to fold them back together.
  const dupGroups = useMemo(() => findDuplicateGroups(items), [items]);

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

  // Fetch and store the live price for ONE item. Shared by the bulk 「更新價格」
  // and the per-card button in the detail modal, so both route to the same
  // source, pass the same grading intent, and — importantly — both LEAVE THE
  // STORED PRICE ALONE when the lookup comes back empty. A blank/stale price is
  // the honest outcome; overwriting with a guess is not.
  const repriceOne = async (
    item: CollectionItem,
    // Shared across one bulk run: rows that resolve to the SAME lookup must end
    // up with the same figure and the same timestamp. Without it, two rows of
    // one product (a duplicate pair, or the same box under two owners) get two
    // separate fetches, and any move in the source between them shows up in the
    // gallery as one product listed at two different prices.
    cache?: Map<string, CardPrice | null>,
  ): Promise<{ ok: boolean; price?: number; currency?: string }> => {
    const edition = item.edition ?? 'ja';
    // ja: Huca resolves by set code (from our local map). zh-tw: kapaipai
    // resolves by set name (no local zh-tw set-code map).
    const setCode = SET_CODE_BY_NAME[item.setName] ?? '';
    const params = {
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
    };
    const key = JSON.stringify(params);
    let p: CardPrice | null;
    if (cache?.has(key)) {
      p = cache.get(key)!;
    } else {
      p = await fetchCardPrice(params);
      cache?.set(key, p);
    }
    if (!p || p.price == null) return { ok: false };
    const currency = p.currency ?? (edition === 'zh-tw' ? 'TWD' : 'JPY');
    await updateItem(item.id, {
      marketPrice: p.price,
      marketPriceCurrency: currency,
      marketPriceSource: p.source ?? (edition === 'zh-tw' ? 'kapaipai' : 'huca'),
      marketPriceUpdatedAt: p.updatedAt,
      marketPriceCondition: p.condition ?? undefined,
    });
    return { ok: true, price: p.price, currency };
  };

  // Re-price just the card open in the detail modal.
  const handleRepriceOne = async (item: CollectionItem) => {
    if (pricingId) return;
    // The bulk refresh skips manual prices outright; here the user is asking for
    // this specific card, so offer it — but say plainly what will be lost.
    if (item.marketPriceSource === 'manual') {
      setConfirmAsk({
        title: '會蓋掉你手動輸入的價格',
        message: '這張卡現在顯示的是你自己填的市價。更新後改用抓到的市場價，手動填的數值不會保留（可以再編輯填回去）。',
        confirmLabel: '仍要更新',
        run: () => runReprice(item),
      });
      return;
    }
    await runReprice(item);
  };

  const runReprice = async (item: CollectionItem) => {
    setPricingId(item.id);
    setPriceMsg(null);
    try {
      const r = await repriceOne(item);
      setPriceMsg(r.ok
        ? { ok: true, text: `已更新：${r.currency === 'TWD' ? 'NT$' : '¥'}${Math.round(r.price!).toLocaleString()}` }
        : { ok: false, text: '查不到能確定是這張卡的價格，已保留原本的數值' });
    } catch (err) {
      console.error('price refresh failed for', item.name, err);
      setPriceMsg({ ok: false, text: '更新失敗，請稍後再試' });
    } finally {
      setPricingId(null);
    }
  };

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
    // One lookup per distinct product for the whole run — see repriceOne.
    const runCache = new Map<string, CardPrice | null>();
    for (const item of priceable) {
      try {
        const r = await repriceOne(item, runCache);
        if (r.ok) ok += 1;
        else failed.push(item.name);
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

  // The actual insert. Split out from handleAdd so the "已經有這個了" prompt can
  // run first and still reach it when the user chooses to keep the rows separate.
  const insertItem = async (f: FormState) => {
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
      // File it under the tab the user is looking at — that tab is the only
      // place they'll go looking for it afterwards.
      await addItem({ ...toAdd, owner });
      setMergeAsk(null);
      setShowAddForm(false);
    } catch (err) {
      console.error(err);
      setActionMsg('新增失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  };

  // Adding something the collection already holds shouldn't quietly create a
  // second row for it — ask first, and let the user raise the existing row's
  // quantity instead. Only offered for an unambiguous duplicate (same product,
  // edition, number and condition; never a graded slab).
  const handleAdd = async (f: FormState) => {
    const dupes = findMergeCandidates(items, formToItem(f));
    if (dupes.length > 0) {
      setMergeAsk({ form: f, candidates: dupes });
      return;
    }
    await insertItem(f);
  };

  // Fold the new copies into an existing row. Quantity only: the row keeps its
  // own acquired date, estimate and market price, which is what the prompt says.
  const handleMergeInto = async (target: CollectionItem, f: FormState) => {
    setSubmitting(true);
    try {
      await updateItem(target.id, { quantity: target.quantity + f.quantity });
      setMergeAsk(null);
      setShowAddForm(false);
    } catch (err) {
      console.error(err);
      setActionMsg('合併失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  };

  // Fold every duplicate group in this tab into one row each. Same idea as the
  // add-time prompt, applied to rows that are already here: the earliest row
  // keeps the collection's history and takes on the summed quantity, the
  // quantity-weighted baseline and the freshest of the prices the group held.
  // The rest are SOFT-deleted, so a merge the user didn't want is one 還原 away.
  const askMergeDuplicates = () => setConfirmAsk({
    title: `合併 ${dupGroups.length} 組重複的收藏？`,
    message: (
      <>
        <span className="block mb-2">同一個商品被拆成好幾筆，會各自合併成一筆：</span>
        {dupGroups.map(g => {
          const plan = planMerge(g)!;
          return (
            <span key={plan.keep.id} className="block text-slate-400">
              「{plan.keep.name}」{g.map(i => `×${i.quantity}`).join(' + ')}
              {' → '}
              <span className="font-black text-poke-accent">×{plan.quantity}</span>
            </span>
          );
        })}
        <span className="block mt-2">
          保留最早入手的那筆，市價取各筆之中最新抓到的；多餘的會移到「已刪除」，需要時可以還原。
        </span>
      </>
    ),
    confirmLabel: '合併',
    run: async () => {
      try {
        for (const g of dupGroups) {
          const plan = planMerge(g);
          if (!plan) continue;
          await updateItem(plan.keep.id, {
            quantity: plan.quantity,
            ...(plan.currentValue != null ? { currentValue: plan.currentValue } : {}),
            ...plan.price,
          });
          for (const d of plan.drop) await deleteItem(d.id);
        }
        // A row the user had open may have just been merged away.
        setDetailId(null);
      } catch (err) {
        console.error(err);
        setActionMsg('合併失敗，請再試一次');
      }
    },
  });

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
      setActionMsg('更新失敗，請再試一次');
    } finally {
      setSubmitting(false);
    }
  };

  // Soft delete → the card moves to the 已刪除 graveyard, where it can be
  // restored or permanently removed. Closing the detail sheet happens INSIDE the
  // confirmed branch: cancelling must leave the card the user is looking at open.
  const askDelete = (item: CollectionItem) => setConfirmAsk({
    title: '刪除這筆收藏？',
    message: <>「{item.name}」會移到下方的「已刪除」區域，之後還可以還原。</>,
    confirmLabel: '刪除',
    destructive: true,
    run: async () => {
      try {
        await deleteItem(item.id);
        if (detailId === item.id) setDetailId(null);
      } catch (err) {
        console.error(err);
        setActionMsg('刪除失敗，請稍後再試');
      }
    },
  });

  const handleRestore = async (id: string) => {
    try {
      await restoreItem(id);
    } catch (err) {
      console.error(err);
      setActionMsg('還原失敗，請稍後再試');
    }
  };

  const askPurge = (item: CollectionItem) => setConfirmAsk({
    title: '永久刪除？',
    message: <>「{item.name}」會從資料庫整筆移除，這個動作無法復原。</>,
    confirmLabel: '永久刪除',
    destructive: true,
    run: async () => {
      try {
        await purgeItem(item.id);
      } catch (err) {
        console.error(err);
        setActionMsg('永久刪除失敗，請稍後再試');
      }
    },
  });

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-poke-blue"></div>
      </div>
    );
  }

  // Switching tabs is switching to a different person's collection, so anything
  // referring to a card in the old one has to go: an open modal would vanish
  // mid-view, and the refresh banner would report the previous tab's counts.
  const handleSwitchOwner = (next: string) => {
    if (next === owner) return;
    setOwner(next);
    setDetailId(null);
    setEditingId(null);
    setShowAddForm(false);
    setShowGraveyard(false);
    setPriceMsg(null);
    setRefreshDone(null);
    setRefreshErrors([]);
    setActionMsg(null);
    setConfirmAsk(null);
  };

  return (
    <div className="space-y-4">
      {/* Owner tabs — one shared account, several collectors. Always rendered,
          including for an empty tab, or there'd be no way back out of one. */}
      {COLLECTION_OWNERS.length > 1 && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-0.5">
          {COLLECTION_OWNERS.map(o => {
            const active = o.id === owner;
            const count = allItems.reduce((s, i) => ownerOf(i) === o.id ? s + i.quantity : s, 0);
            return (
              <button
                key={o.id}
                onClick={() => handleSwitchOwner(o.id)}
                className={cn(
                  'flex items-center gap-1.5 px-3.5 py-2 rounded-lg text-sm font-bold whitespace-nowrap transition-colors border',
                  active
                    ? 'bg-poke-blue text-white border-poke-blue'
                    : 'bg-white/5 text-slate-400 border-white/10 hover:text-slate-200 hover:border-white/20',
                )}
              >
                {o.label}
                <span className={cn(
                  'text-[11px] font-black px-1.5 py-0.5 rounded-full',
                  active ? 'bg-white/20 text-white' : 'bg-white/5 text-slate-500',
                )}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}

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

      {/* Duplicate rows. Two entries for one product aren't just untidy: each
          carries its own market price, fetched on its own day, so the gallery
          shows one product at two prices and the totals double-count nothing but
          look wrong. Offer the fix rather than merging behind the user's back —
          keeping two purchases apart is a legitimate thing to want. */}
      {dupGroups.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs">
          <Layers className="w-4 h-4 text-amber-300 shrink-0" />
          <span className="font-bold text-amber-300">
            {dupGroups.length} 組重複
          </span>
          <span className="text-slate-400 min-w-0 truncate">
            {dupGroups.slice(0, 3).map(g => g[0].name).join('、')}
            {dupGroups.length > 3 ? ' …' : ''} 被拆成好幾筆
          </span>
          <button
            onClick={askMergeDuplicates}
            className="ml-auto shrink-0 px-3 py-1.5 rounded-lg font-bold bg-amber-500/20 border border-amber-500/40 text-amber-200 hover:bg-amber-500/30 transition-colors"
          >
            合併
          </button>
        </div>
      )}

      {/* Action failures (add / update / merge / delete / restore). Replaces the
          alert() these used to raise: visible, but doesn't block the page. */}
      {actionMsg && (
        <div className="flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs">
          <span className="font-bold text-red-300">{actionMsg}</span>
          <button
            onClick={() => setActionMsg(null)}
            className="ml-auto text-slate-500 hover:text-slate-300 font-bold"
            aria-label="關閉"
          >
            ×
          </button>
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
              ? '這裡還沒有收藏紀錄，點下面的「新增」開始記錄吧！'
              : filtersActive
                ? '找不到符合條件的收藏'
                : '尚無收藏紀錄'}
          </p>
          {/* The toolbar (and with it the only other 新增 button) is hidden when
              the tab has no cards — so without this one, a brand-new owner's tab
              would be a dead end with no way to add the first card. */}
          {items.length === 0 && (
            <button
              onClick={() => { setEditingId(null); setShowAddForm(true); }}
              className="mt-4 inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-bold bg-poke-blue text-white hover:bg-poke-dark-blue transition-colors"
            >
              <Plus className="w-4 h-4" />
              新增
            </button>
          )}
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

                  {/* Whole-artwork tap target -> detail view. Sits above the
                      image but below the corner actions, and the decorations
                      are pointer-events-none, so it can't swallow their clicks. */}
                  <button
                    type="button"
                    onClick={() => { setDetailId(item.id); setPriceMsg(null); }}
                    aria-label={`檢視 ${item.name}`}
                    className="absolute inset-0 z-[1] cursor-zoom-in"
                  />

                  {/* Bottom gradient for badge legibility */}
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/45 to-transparent" />

                  {/* Top-left badges */}
                  <div className="pointer-events-none absolute top-1.5 left-1.5 z-[2] flex flex-col items-start gap-1">
                    <ItemTypeBadge type={item.itemType} />
                    {item.isGraded && (
                      <span className="text-[10px] font-black text-amber-700 bg-gradient-to-r from-amber-100 to-yellow-100 border border-amber-300 px-1.5 py-0.5 rounded-full shadow-sm">
                        {item.gradingCompany ? GRADING_LABELS[item.gradingCompany] : '鑑定'}{item.grade ? ` ${item.grade}` : ''}
                      </span>
                    )}
                  </div>

                  {/* Quantity */}
                  {item.quantity > 1 && (
                    <span className="pointer-events-none absolute bottom-1.5 left-1.5 z-[2] text-[10px] font-black text-white bg-slate-800/70 px-1.5 py-0.5 rounded-full">
                      ×{item.quantity}
                    </span>
                  )}

                  {/* Actions (always visible so they work on touch/mobile too) */}
                  <div className="absolute top-1.5 right-1.5 z-[2] flex gap-1">
                    <button
                      onClick={() => { setEditingId(item.id); setShowAddForm(false); }}
                      className="p-1.5 rounded-lg bg-black/40 backdrop-blur text-slate-200 hover:text-poke-accent shadow-sm transition-colors"
                      title="編輯"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={() => askDelete(item)}
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
                        onClick={() => askPurge(item)}
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
            onClose={() => { setShowAddForm(false); setMergeAsk(null); }}
            submitting={submitting}
          />
        )}
        {mergeAsk && (
          <MergePromptModal
            incoming={mergeAsk.form}
            candidates={mergeAsk.candidates}
            onMerge={target => handleMergeInto(target, mergeAsk.form)}
            onKeepSeparate={() => insertItem(mergeAsk.form)}
            // Cancel returns to the add form, which is still open behind this.
            onClose={() => setMergeAsk(null)}
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
        {/* Card detail. Hidden while the edit form is open so the two modals
            never stack, but detailId is kept so closing the form returns here. */}
        {detailItem && !editingItem && (
          <CardDetailModal
            key={detailItem.id}
            item={detailItem}
            estTwd={(() => {
              const e = estValue(detailItem);
              return e ? toTwd(e.amount, e.currency, fxRate) : null;
            })()}
            est={estValue(detailItem)}
            diff={pnlOf(detailItem)?.diff ?? null}
            diffPct={pnlOf(detailItem)?.pct ?? null}
            pricing={pricingId === detailItem.id}
            priceMsg={priceMsg}
            onReprice={() => handleRepriceOne(detailItem)}
            onEdit={() => { setEditingId(detailItem.id); setShowAddForm(false); }}
            onDelete={() => askDelete(detailItem)}
            onClose={() => { setDetailId(null); setPriceMsg(null); }}
          />
        )}
        {confirmAsk && (
          <ConfirmDialog
            title={confirmAsk.title}
            message={confirmAsk.message}
            confirmLabel={confirmAsk.confirmLabel}
            destructive={confirmAsk.destructive}
            busy={confirmBusy}
            onCancel={() => setConfirmAsk(null)}
            onConfirm={async () => {
              setConfirmBusy(true);
              try {
                await confirmAsk.run();
              } finally {
                setConfirmBusy(false);
                setConfirmAsk(null);
              }
            }}
          />
        )}
      </AnimatePresence>
    </div>
  );
}
