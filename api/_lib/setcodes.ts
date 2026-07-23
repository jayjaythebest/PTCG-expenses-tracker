// Server-side TCGdex expansion-code lists, fed to the scan prompt so the model
// picks a real set code per detected language. Kept tiny and standalone (no
// import of src/lib/tcgdex.ts) to avoid dragging the client's src/data bundle
// into the serverless function. Cached per warm lambda; degrades to empty lists.

type SetCodes = { ja: string[]; 'zh-tw': string[] };

let cache: SetCodes | null = null;

async function fetchIds(lang: 'ja' | 'zh-tw'): Promise<string[]> {
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

export async function getKnownSetCodes(): Promise<SetCodes> {
  if (cache) return cache;
  const [ja, zhtw] = await Promise.all([fetchIds('ja'), fetchIds('zh-tw')]);
  cache = { ja, 'zh-tw': zhtw };
  return cache;
}
