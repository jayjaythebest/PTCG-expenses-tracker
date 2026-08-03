// Thin client wrappers over the market-price serverless endpoints
// (api/card-price, api/fx). Prices come back in the source's native currency
// (JPY for Huca / Japanese cards); the UI converts to TWD for display using the
// JPY->TWD rate from /api/fx.

import { apiFetch } from './apiFetch';

export interface CardPrice {
  price: number | null;
  currency: string | null;
  source: string | null;
  condition: string | null;
  url: string | null;
  updatedAt: string;
}

export async function fetchCardPrice(params: {
  setCode?: string;
  number?: string;
  edition?: string;
  name?: string;
  setName?: string; // zh-tw: kapaipai is resolved by set name (no local set-code map)
  // Grading intent: when the card is graded, the endpoint matches the slab's
  // grade (e.g. PSA10) instead of a raw price.
  isGraded?: boolean;
  gradingCompany?: string;
  grade?: string;
  // Sealed-box pricing: a box with a curated Snkrdunk product id is priced off
  // Snkrdunk (usedMinPrice/minPrice) instead of the single-card sources.
  itemType?: string;
  snkrdunkId?: number;
}): Promise<CardPrice | null> {
  try {
    const res = await apiFetch('/api/card-price', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params),
    });
    if (!res.ok) return null;
    return (await res.json()) as CardPrice;
  } catch {
    return null;
  }
}

const FALLBACK_JPY_TO_TWD = 0.2;

export async function fetchFxJpyToTwd(): Promise<number> {
  try {
    const res = await apiFetch('/api/fx');
    if (!res.ok) return FALLBACK_JPY_TO_TWD;
    const data = await res.json();
    return typeof data.jpyToTwd === 'number' && data.jpyToTwd > 0 ? data.jpyToTwd : FALLBACK_JPY_TO_TWD;
  } catch {
    return FALLBACK_JPY_TO_TWD;
  }
}
