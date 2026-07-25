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
  // MEGA-series gold / secret rarities (TCGdex started returning these in 2026).
  'mega hyper rare': 'MUR',
  'mega ultra rare': 'MUR',
  'ultra gold rare': 'UR',
  'gold rare': 'UR',
  'shiny rare': 'SR',
  'shiny ultra rare': 'SAR',
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

// ---- Set-level representative image (for boxes / packs / manual singles) ----
// Lets a row show "which generation" at a glance without scanning a card.
// Strategy: prefer the expansion `logo` when TCGdex serves one (more common on
// zh-tw sets); otherwise fall back to a representative card image from the set
// (the first card that has artwork). `kind` lets the UI style logos (wide) vs
// card art (tall) differently.
export interface SetImageResult {
  imageUrl: string;
  kind: 'logo' | 'card';
  edition: ScanLanguage;
}

async function trySetImage(code: string, lang: ScanLanguage): Promise<SetImageResult | null> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets/${encodeURIComponent(code)}`);
    if (!res.ok) return null;
    const data = await res.json();

    // 1) Expansion logo, when present (asset URL has no extension — append one).
    if (typeof data?.logo === 'string' && data.logo) {
      return { imageUrl: `${data.logo}.png`, kind: 'logo', edition: lang };
    }

    // 2) Fall back to the first card that carries artwork.
    const cards: Array<{ image?: unknown }> = Array.isArray(data?.cards) ? data.cards : [];
    const withArt = cards.find(c => typeof c?.image === 'string' && c.image);
    if (withArt) {
      return { imageUrl: `${withArt.image as string}/low.webp`, kind: 'card', edition: lang };
    }
    return null;
  } catch {
    return null;
  }
}

// ---- Bulbagarden Archives set logos (covers the newest sets) ----
// TCGdex has no logos and no card art for brand-new sets (e.g. the 2025 MEGA
// series `m5` returns 118 cards but every `image` is empty). The Bulbagarden
// Archives MediaWiki API serves expansion logos for essentially every set,
// including the newest ones, key-free and with `Access-Control-Allow-Origin: *`
// so the URLs hotlink from the browser. Docs pattern verified for m5/sv2a.
const BULBA_API = 'https://archives.bulbagarden.net/w/api.php';

async function resolveBulbaImageUrl(title: string): Promise<string | null> {
  try {
    const url = `${BULBA_API}?action=query&titles=${encodeURIComponent(title)}&prop=imageinfo&iiprop=url&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const pages = data?.query?.pages;
    if (!pages || typeof pages !== 'object') return null;
    for (const key of Object.keys(pages)) {
      const info = (pages as Record<string, { imageinfo?: Array<{ url?: unknown }> }>)[key]?.imageinfo;
      if (Array.isArray(info) && typeof info[0]?.url === 'string' && info[0].url) {
        return info[0].url as string;
      }
    }
    return null;
  } catch {
    return null;
  }
}

async function searchBulbaLogoTitle(code: string): Promise<string | null> {
  try {
    const url = `${BULBA_API}?action=query&list=search&srsearch=${encodeURIComponent(`${code} Logo`)}&srnamespace=6&format=json&origin=*`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const results = data?.query?.search;
    if (Array.isArray(results) && typeof results[0]?.title === 'string') {
      return results[0].title as string;
    }
    return null;
  } catch {
    return null;
  }
}

// Newer sets follow `File:{CODE} Logo JP.png` (e.g. "M5 Logo JP.png"); older
// sets have descriptive names ("SV2a Pokémon Card 151 Logo.png"), so try the
// direct title first and fall back to a File-namespace search by set code.
async function fetchBulbaLogo(code: string): Promise<string | null> {
  const direct = await resolveBulbaImageUrl(`File:${code} Logo JP.png`);
  if (direct) return direct;
  const title = await searchBulbaLogoTitle(code);
  return title ? await resolveBulbaImageUrl(title) : null;
}

// ---- Official Traditional-Chinese artwork (via our /api proxy) ----
// The official TW site (asia.pokemon-card.com) has precise zh-tw card & pack
// art but serves no CORS header, so we resolve the URL through a same-origin
// serverless proxy (api/tw-card-image). The images hotlink freely afterwards.
async function fetchTwOfficialImage(code: string, number?: number): Promise<string | null> {
  try {
    const qs = new URLSearchParams({ set: code });
    if (number && Number.isFinite(number)) qs.set('number', String(number));
    const res = await fetch(`/api/tw-card-image?${qs.toString()}`);
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data?.imageUrl === 'string' && data.imageUrl ? data.imageUrl : null;
  } catch {
    return null;
  }
}

// Precise single-card image from the official TW site, by set code + collector
// number. Returns null (caller falls back) if the proxy can't resolve it.
const twCardImageCache = new Map<string, string | null>();
export async function lookupTwCardImage(setCode: string, cardNumber: number | string): Promise<string | null> {
  const code = setCode.trim();
  const n = typeof cardNumber === 'number' ? cardNumber : Number(String(cardNumber).match(/\d+/)?.[0]);
  if (!code || !n || !Number.isFinite(n)) return null;
  const key = `${code.toLowerCase()}#${n}`;
  const cached = twCardImageCache.get(key);
  if (cached !== undefined) return cached;
  const url = await fetchTwOfficialImage(code, n);
  twCardImageCache.set(key, url);
  return url;
}

// Resolved images are cached per set code (case-insensitive) for the session so
// a list of rows sharing a set only hits the network once.
const setImageCache = new Map<string, SetImageResult | null>();

// Resolve a representative image for a whole set by its code (e.g. "m5", "sv2a").
// Priority: (1) official TW pack/product art (precise, matches what the user
// buys); (2) Bulbagarden expansion logo (covers brand-new sets); (3) a TCGdex
// card image from the set. Returns null on total miss so the UI can show a
// placeholder / let the user paste a URL manually.
export async function lookupSetImage(
  setCode: string,
  language: ScanLanguage = 'ja',
): Promise<SetImageResult | null> {
  const code = setCode.trim();
  if (!code) return null;

  const cacheKey = code.toLowerCase();
  const cached = setImageCache.get(cacheKey);
  if (cached !== undefined) return cached;

  // 1) Official TW pack/product art.
  const tw = await fetchTwOfficialImage(code);
  let result: SetImageResult | null = tw
    ? { imageUrl: tw, kind: 'card', edition: language }
    : null;

  // 2) Bulbagarden expansion logo.
  if (!result) {
    const logo = await fetchBulbaLogo(code);
    result = logo ? { imageUrl: logo, kind: 'logo', edition: language } : null;
  }

  // 3) TCGdex representative card art (older sets the others might miss).
  if (!result) {
    const secondary: ScanLanguage = language === 'ja' ? 'zh-tw' : 'ja';
    result = (await trySetImage(code, language)) ?? (await trySetImage(code, secondary));
  }

  setImageCache.set(cacheKey, result);
  return result;
}
