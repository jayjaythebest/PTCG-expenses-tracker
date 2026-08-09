// Expansion-code lists fed to the scan prompt so the model can spell the code it
// reads off the card the way the rest of the app writes it.
//
// TCGdex is the bulk of the list, but it publishes a set WEEKS after release —
// M6 (ストームエメラルダ) was still a 404 there while the cards were already in
// shops. A list that lags is worse than a short one: the prompt used to say
// "pick the closest known code", so a brand-new set got snapped onto whatever
// old code looked nearest (an M6 card came back as SV7a). So we union TCGdex
// with the hand-maintained local catalog, which is exactly where a new set lands
// first, and the prompt now treats the list as a spelling reference only.

import { PTCG_PRODUCTS } from '../../src/data/ptcg-products.js';

type Lang = 'ja' | 'zh-tw';
type SetCodes = { ja: string[]; 'zh-tw': string[] };

let cache: SetCodes | null = null;

// The local catalog stores codes lower-cased (m6, sv7a); TCGdex — and the print
// on the card — upper-cases the leading letters (M6, SV7a, S12a).
function printedForm(code: string): string {
  return code.replace(/^[a-z]+/, m => m.toUpperCase());
}

function localCodes(lang: Lang): string[] {
  const codes = PTCG_PRODUCTS.map(p => printedForm(p.code));
  // zh-tw MEGA sets print a trailing edition "F" (M5F, M2aF) that ja doesn't.
  return lang === 'zh-tw'
    ? codes.flatMap(c => (/^M\d/.test(c) ? [c, `${c}F`] : [c]))
    : codes;
}

async function fetchIds(lang: Lang): Promise<string[]> {
  try {
    const res = await fetch(`https://api.tcgdex.net/v2/${lang}/sets`);
    if (!res.ok) return [];
    const data = await res.json();
    return (Array.isArray(data) ? data : [])
      .map((s: { id?: unknown }) => String(s?.id ?? ''))
      .filter(Boolean);
  } catch {
    return [];
  }
}

function merge(remote: string[], local: string[]): string[] {
  const seen = new Set(remote.map(c => c.toLowerCase()));
  return [...remote, ...local.filter(c => !seen.has(c.toLowerCase()))];
}

export async function getKnownSetCodes(): Promise<SetCodes> {
  if (cache) return cache;
  const [ja, zhtw] = await Promise.all([fetchIds('ja'), fetchIds('zh-tw')]);
  const codes: SetCodes = {
    ja: merge(ja, localCodes('ja')),
    'zh-tw': merge(zhtw, localCodes('zh-tw')),
  };
  // Only cache a list TCGdex actually answered — a fetch that failed would
  // otherwise pin the catalog-only list for the lambda's whole warm life.
  if (ja.length && zhtw.length) cache = codes;
  return codes;
}

// Spelling-normalize a code the model read off the card ("m6" -> "M6", "SV7A" ->
// "SV7a"), so image CDNs and price sources that are case-sensitive still match.
// An unrecognized code is returned VERBATIM on purpose: it is far more likely to
// be a set nobody has catalogued yet than a misread of a lookalike code.
export function canonicalSetCode(raw: string, known: string[]): string {
  const code = (raw ?? '').trim();
  if (!code) return '';
  return known.find(k => k.toLowerCase() === code.toLowerCase()) ?? code;
}
