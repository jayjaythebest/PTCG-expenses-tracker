import { useState, useEffect, useRef } from 'react';
import { supabase } from './supabase';
import { CollectionItem } from '../types';

let channelCounter = 0;

function mapRow(row: Record<string, unknown>): CollectionItem {
  return {
    id:            row.id as string,
    name:          row.name as string,
    setName:       (row.set_name as string | null) ?? '',
    series:        (row.series as string | null) ?? '',
    cardNumber:    row.card_number as string | undefined,
    rarity:        row.rarity as string | undefined,
    itemType:      row.item_type as CollectionItem['itemType'],
    condition:     row.condition as CollectionItem['condition'] | undefined,
    quantity:      (row.quantity as number | null) ?? 1,
    acquiredDate:  (row.acquired_date as string | null) ?? undefined,
    purchasePrice: row.purchase_price as number | undefined,
    currentValue:  row.current_value as number | undefined,
    marketPrice:          row.market_price as number | undefined,
    marketPriceCurrency:  row.market_price_currency as string | undefined,
    marketPriceSource:    row.market_price_source as string | undefined,
    marketPriceUpdatedAt: row.market_price_updated_at as string | undefined,
    marketPriceCondition: row.market_price_condition as string | undefined,
    notes:         row.notes as string | undefined,
    imageUrl:      row.image_url as string | undefined,
    edition:       (row.edition as CollectionItem['edition']) ?? undefined,
    isGraded:      (row.is_graded as boolean | null) ?? false,
    gradingCompany:(row.grading_company as CollectionItem['gradingCompany']) ?? undefined,
    grade:         row.grade as string | undefined,
    gradingCert:   row.grading_cert as string | undefined,
    deletedAt:     (row.deleted_at as string | null) ?? undefined,
    // Null on rows written before the owner column existed; ownerOf() maps
    // those to the account holder, so don't coerce to a default here.
    owner:         (row.owner as string | null) ?? undefined,
    createdAt:     row.created_at as string,
  };
}

type CollectionInput = Omit<CollectionItem, 'id' | 'createdAt'>;

export function useCollection() {
  // Active cards (deleted_at null) shown in the gallery.
  const [items, setItems] = useState<CollectionItem[]>([]);
  // Soft-deleted cards (deleted_at set) shown in the 已刪除 graveyard, restorable.
  const [deletedItems, setDeletedItems] = useState<CollectionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const channelName = useRef(`collection-${++channelCounter}`).current;

  async function fetchItems() {
    const { data, error } = await supabase
      .from('collection_items')
      .select('*')
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase error:', error);
    } else {
      const rows = (data ?? []).map(mapRow);
      setItems(rows.filter(r => !r.deletedAt));
      setDeletedItems(rows.filter(r => r.deletedAt));
    }
    setLoading(false);
  }

  useEffect(() => {
    fetchItems();

    const channel = supabase
      .channel(channelName)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'collection_items' }, fetchItems)
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, []);

  const addItem = async (item: CollectionInput) => {
    const { error } = await supabase.from('collection_items').insert({
      name:           item.name,
      set_name:       item.setName,
      series:         item.series,
      card_number:    item.cardNumber ?? null,
      rarity:         item.rarity ?? null,
      item_type:      item.itemType,
      condition:      item.condition ?? null,
      quantity:       item.quantity,
      acquired_date:  item.acquiredDate ?? null,
      purchase_price: item.purchasePrice ?? null,
      current_value:  item.currentValue ?? null,
      market_price:            item.marketPrice ?? null,
      market_price_currency:   item.marketPriceCurrency ?? null,
      market_price_source:     item.marketPriceSource ?? null,
      market_price_updated_at: item.marketPriceUpdatedAt ?? null,
      market_price_condition:  item.marketPriceCondition ?? null,
      notes:          item.notes ?? null,
      image_url:      item.imageUrl ?? null,
      edition:        item.edition ?? 'ja',
      is_graded:       item.isGraded ?? false,
      grading_company: item.gradingCompany ?? null,
      grade:           item.grade ?? null,
      grading_cert:    item.gradingCert ?? null,
      // Which tab the card was added under. Falls back to the DB default rather
      // than being forced here, so a caller that doesn't know about owners
      // still files cards under the account holder.
      ...(item.owner ? { owner: item.owner } : {}),
    });
    if (error) throw error;
  };

  const updateItem = async (id: string, updates: Partial<CollectionInput>) => {
    const dbUpdates: Record<string, unknown> = {};
    if (updates.name !== undefined)          dbUpdates.name = updates.name;
    if (updates.setName !== undefined)       dbUpdates.set_name = updates.setName;
    if (updates.series !== undefined)        dbUpdates.series = updates.series;
    if ('cardNumber' in updates)             dbUpdates.card_number = updates.cardNumber ?? null;
    if ('rarity' in updates)                 dbUpdates.rarity = updates.rarity ?? null;
    if (updates.itemType !== undefined)      dbUpdates.item_type = updates.itemType;
    if ('condition' in updates)              dbUpdates.condition = updates.condition ?? null;
    if (updates.quantity !== undefined)      dbUpdates.quantity = updates.quantity;
    if ('acquiredDate' in updates)           dbUpdates.acquired_date = updates.acquiredDate ?? null;
    if ('purchasePrice' in updates)          dbUpdates.purchase_price = updates.purchasePrice ?? null;
    if ('currentValue' in updates)           dbUpdates.current_value = updates.currentValue ?? null;
    if ('marketPrice' in updates)            dbUpdates.market_price = updates.marketPrice ?? null;
    if ('marketPriceCurrency' in updates)    dbUpdates.market_price_currency = updates.marketPriceCurrency ?? null;
    if ('marketPriceSource' in updates)      dbUpdates.market_price_source = updates.marketPriceSource ?? null;
    if ('marketPriceUpdatedAt' in updates)   dbUpdates.market_price_updated_at = updates.marketPriceUpdatedAt ?? null;
    if ('marketPriceCondition' in updates)   dbUpdates.market_price_condition = updates.marketPriceCondition ?? null;
    if ('notes' in updates)                  dbUpdates.notes = updates.notes ?? null;
    if ('edition' in updates)                dbUpdates.edition = updates.edition ?? null;
    if (updates.isGraded !== undefined)      dbUpdates.is_graded = updates.isGraded;
    if ('gradingCompany' in updates)         dbUpdates.grading_company = updates.gradingCompany ?? null;
    if ('grade' in updates)                  dbUpdates.grade = updates.grade ?? null;
    if ('gradingCert' in updates)            dbUpdates.grading_cert = updates.gradingCert ?? null;
    // Never write null: owner is NOT NULL, and a card filed under nobody would
    // vanish from every tab.
    if (updates.owner)                       dbUpdates.owner = updates.owner;

    const { error } = await supabase.from('collection_items').update(dbUpdates).eq('id', id);
    if (error) throw error;
  };

  // Soft delete: tombstone the row so it moves to the 已刪除 graveyard instead
  // of being lost. Restorable via restoreItem; permanently removed via purgeItem.
  const deleteItem = async (id: string) => {
    const { error } = await supabase
      .from('collection_items')
      .update({ deleted_at: new Date().toISOString() })
      .eq('id', id);
    if (error) throw error;
  };

  // Bring a soft-deleted card back to the active gallery.
  const restoreItem = async (id: string) => {
    const { error } = await supabase
      .from('collection_items')
      .update({ deleted_at: null })
      .eq('id', id);
    if (error) throw error;
  };

  // Permanent hard delete (from the graveyard). This cannot be undone.
  const purgeItem = async (id: string) => {
    const { error } = await supabase.from('collection_items').delete().eq('id', id);
    if (error) throw error;
  };

  return { items, deletedItems, loading, addItem, updateItem, deleteItem, restoreItem, purgeItem };
}
