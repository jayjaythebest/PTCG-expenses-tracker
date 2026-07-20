import { PTCG_PRODUCTS } from '../data/ptcg-products';
import type { CardEdition } from '../types';

// Authoritative card data resolved from the free TCGdex API (multilingual).
// Docs: https://tcgdex.dev — endpoint: /v2/{lang}/sets/{setCode}/{localId}
// Supported here: 'ja' (Japanese) and 'zh-tw' (Traditional Chinese).
export type ScanLanguage = Extract<CardEdition, 'ja' | 'zh-tw'>;

export interface CardLookupResult {
  name: string;
  rarity: string;
  setName: string;
  series: string;
  imageUrl: string;
  edition: ScanLanguage; // the language whose endpoint actually resolved the card
}

// TCGdex English rarity names → this project's JP-card abbreviations.
// TCGdex returns rarity in English for both /ja/ and /zh-tw/, so this is language-agnostic.
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

// ---- Known set codes (per language), fetched once from TCGdex and cached ----
// Set codes differ between languages (JP "sv2a" vs zh-tw "SC2a"/"CS1a"),
// so we feed both lists to Gemini and let it pick the one matching the card language.
let setCodeCache: { ja: string[]; 'zh-tw': string[] } | null = null;

async function fetchSetCodes(lang: ScanLanguage): Promise<string[]> {
  const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets`);
  if (!res.ok) throw new Error(`TCGdex /sets ${lang} ${res.status}`);
  const data = await res.json();
  return (Array.isArray(data) ? data : [])
    .map((s: { id?: unknown }) => String(s?.id ?? ''))
    .filter(Boolean);
}

export async function getKnownSetCodes(): Promise<{ ja: string[]; 'zh-tw': string[] }> {
  if (setCodeCache) return setCodeCache;
  try {
    const [ja, zhtw] = await Promise.all([fetchSetCodes('ja'), fetchSetCodes('zh-tw')]);
    setCodeCache = { ja, 'zh-tw': zhtw };
  } catch {
    // Degrade gracefully: fall back to local JP product codes, no zh-tw list.
    setCodeCache = {
      ja: Array.from(new Set(PTCG_PRODUCTS.map(p => p.code))),
      'zh-tw': [],
    };
  }
  return setCodeCache;
}

// ---- Card lookup ----
async function tryLookup(code: string, id: string, lang: ScanLanguage): Promise<CardLookupResult | null> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(code)}/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.name) return null;

    // Local product data is Japanese-only, so only use it to enrich JP lookups.
    const product = lang === 'ja' ? findProductByCode(code) : undefined;
    return {
      name:    String(data.name),
      rarity:  mapRarity(data.rarity),
      setName: product?.name ?? String(data.set?.name ?? ''),
      series:  product?.series ?? '',
      imageUrl: data.image ? `${data.image}/high.webp` : '',
      edition: lang,
    };
  } catch {
    return null;
  }
}

// Look up a card by set code and local id (e.g. "001" or "1").
// Tries the detected language first, then the other one as a fallback.
// Returns null on miss so callers can fall back to raw AI fields.
export async function lookupCard(
  setCode: string,
  localId: string,
  language: ScanLanguage = 'ja',
): Promise<CardLookupResult | null> {
  const code = setCode.trim();
  const id = localId.trim().replace(/^0+(?=\d)/, ''); // TCGdex localId is unpadded ("1", not "001")
  if (!code || !id) return null;

  const primary = language;
  const secondary: ScanLanguage = language === 'ja' ? 'zh-tw' : 'ja';

  return (await tryLookup(code, id, primary)) ?? (await tryLookup(code, id, secondary));
}
