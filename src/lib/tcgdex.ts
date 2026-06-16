import { PTCG_PRODUCTS } from '../data/ptcg-products';

// Authoritative card data resolved from the free TCGdex Japanese API.
// Docs: https://tcgdex.dev — endpoint: /v2/ja/sets/{setCode}/{localId}
export interface CardLookupResult {
  name: string;
  rarity: string;
  setName: string;
  series: string;
  imageUrl: string;
}

// TCGdex English rarity names → this project's JP-card abbreviations.
const RARITY_MAP: Record<string, string> = {
  'common': 'C',
  'uncommon': 'U',
  'rare': 'R',
  'rare holo': 'R',
  'double rare': 'RR',
  'ultra rare': 'SR',
  'illustration rare': 'AR',
  'special illustration rare': 'SAR',
  'hyper rare': 'HR',
  'ace spec rare': 'ACE SPEC',
};

function mapRarity(raw?: string): string {
  if (!raw) return '';
  return RARITY_MAP[raw.toLowerCase()] ?? '其他';
}

function findProductByCode(code: string) {
  const lc = code.toLowerCase();
  return PTCG_PRODUCTS.find(p => p.code.toLowerCase() === lc);
}

// Look up a card by set code (e.g. "sv2a") and local id (e.g. "001" or "1").
// Returns null on miss so callers can fall back to raw AI fields.
export async function lookupCard(setCode: string, localId: string): Promise<CardLookupResult | null> {
  const code = setCode.trim();
  const id = localId.trim().replace(/^0+(?=\d)/, ''); // TCGdex localId is unpadded ("1", not "001")
  if (!code || !id) return null;

  try {
    const res = await fetch(`https://api.tcgdex.net/v2/ja/sets/${encodeURIComponent(code)}/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.name) return null;

    const product = findProductByCode(code);
    return {
      name:    String(data.name),
      rarity:  mapRarity(data.rarity),
      setName: product?.name ?? String(data.set?.name ?? ''),
      series:  product?.series ?? '',
      imageUrl: data.image ? `${data.image}/high.webp` : '',
    };
  } catch {
    return null;
  }
}
