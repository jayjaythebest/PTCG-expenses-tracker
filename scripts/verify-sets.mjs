// Verifies src/data/ptcg-products.ts against TCGdex.
//
// Why this exists: the catalog is hand-maintained, and a wrong entry does NOT
// fail loudly. api/_lib/pricing.ts resolves a card's Huca set code by looking
// the stored set NAME up in TCGdex, so a name that is off by one character —
// or a name attached to the wrong code — just makes cards show no price. That
// rotted undetected until a scan filed a VSTARユニバース card under
// VMAXクライマックス: S12a/S12/S11a had their names shifted by one row, and
// several SV codes were wrong (クレイバースト as sv1b rather than SV2D).
//
// Not part of `npm test`, which is offline and must stay deterministic. Run it
// when adding sets, or when cards mysteriously stop showing prices:
//
//   npm run verify:sets
//
// Exits non-zero on any mismatch so it can gate a release if wired to CI.

import { readFile } from 'node:fs/promises';

const JA_SETS = 'https://api.tcgdex.net/v2/ja/sets';
const TW_SETS = 'https://api.tcgdex.net/v2/zh-tw/sets';
const KP_PACKS = 'https://trade.kapaipai.tw/api/card/getCardPackList?game=pkmtw';
const HUCA_API = 'https://huca.tw/api/api.php';

// TCGdex is authoritative *except* where it is provably wrong. Each entry says
// what TCGdex currently reports, so this stays a real check: if TCGdex fixes
// its data the stated value stops matching and the script tells us to drop the
// override, instead of silently masking a future regression.
const JA_NAME_OVERRIDES = {
  // SV4a repeats SV3a's name. Card counts settle it: SV3a has 62 official
  // (Raging Surf), SV4a has 190 official (Shiny Treasure ex), and both zh-tw
  // and kapaipai call SV4a 閃色寶藏ex.
  SV4A: { tcgdexSays: 'レイジングサーフ', weSay: 'シャイニートレジャーex' },
};

// Sets with no TCGdex zh-tw record yet whose Chinese name is verified against
// kapaipai's pack list instead — which is the source that actually matters,
// since resolvePackId() in api/_lib/pricing.ts matches a stored zh-tw set name
// straight against kapaipai's packName.
// TCGdex carries no zh-tw record for the whole MEGA series, nor for SV11B/W,
// even though all of them have shipped in Traditional Chinese. kapaipai lists
// every one of them.
const ZH_VIA_KAPAIPAI = new Set([
  'M1L', 'M1S', 'M2', 'M2A', 'M3', 'M4', 'M5', 'M6',
  'SV11B', 'SV11W',
]);

// TCGdex also lags actual RELEASES, not just translations: M6 is on sale, Huca
// prices it and kapaipai lists 116 of its cards, yet /v2/ja/sets/M6 is still a
// 404. Codes listed here have their Japanese name verified against Huca instead
// — whose card titles end in 拡張パック「<ja set name>」, and which is the source
// api/_lib/pricing.ts actually asks for ja prices. So this checks the name
// against the system that has to agree with it, rather than waiving the check.
//
// This is a TEMPORARY exemption by design: once TCGdex publishes the set the
// loop below fails and tells us to drop the code from here, so the waiver can't
// quietly become a permanent blind spot.
const JA_VIA_HUCA = new Set(['M6']);

// Pull a set's Japanese name out of any one of its Huca card titles, e.g.
// 「ヘラクロス C [M6 001/076](拡張パック「ストームエメラルダ」)」 -> ストームエメラルダ.
// Returns null when Huca doesn't know the set (or the request fails), which the
// caller reports as a problem rather than silently passing.
async function hucaJaSetName(id) {
  const url = `${HUCA_API}?search=&set_code=${encodeURIComponent(id)}`
    + '&card_number=1&promo=0&accuracy=1&limit=1';
  try {
    const json = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json());
    const title = json?.data?.[0]?.title;
    if (!title) return null;
    return title.match(/拡張パック「([^」]+)」/)?.[1] ?? null;
  } catch {
    return null;
  }
}

async function main() {
  // The catalog is TypeScript, so read it as text and pull the object literals
  // out rather than adding a transpile step for a one-file script.
  const source = await readFile(
    new URL('../src/data/ptcg-products.ts', import.meta.url),
    'utf8',
  );

  // Grab each object literal first, then pull named fields out of it. Doing it
  // in one regex with an optional `(?:nameZh:…)?` group does NOT work: the group
  // is optional and the surrounding `[^}]*` is greedy, so the engine always
  // skips it and nameZh silently comes back undefined for every entry — which
  // is exactly what happened, leaving every zh-tw name unchecked while the
  // script still reported "all names match".
  const entries = [...source.matchAll(/\{[^{}]*\bcode:\s*'[^']*'[^{}]*\}/g)].map(m => {
    const block = m[0];
    const field = key => block.match(new RegExp(`\\b${key}:\\s*'([^']*)'`))?.[1];
    return { code: field('code'), name: field('name'), nameZh: field('nameZh') };
  });

  const malformed = entries.filter(e => !e.code || !e.name);
  if (malformed.length) {
    console.error(`${malformed.length} entr(ies) missing code or name — check the file format.`);
    return 2;
  }

  if (entries.length === 0) {
    console.error('Could not parse any products — has the file format changed?');
    return 2;
  }

  const [ja, tw, kp] = await Promise.all([
    fetch(JA_SETS).then(r => r.json()),
    fetch(TW_SETS).then(r => r.json()),
    fetch(KP_PACKS, { headers: { 'User-Agent': 'Mozilla/5.0' } }).then(r => r.json()).catch(() => null),
  ]);

  const byId = list => new Map(list.map(s => [String(s.id).toUpperCase(), String(s.name)]));
  const jaById = byId(ja);
  const twById = byId(tw);

  const kpList = (Array.isArray(kp?.data) ? kp.data : kp?.data?.list) ?? [];
  const kpById = new Map(kpList.map(p => [String(p.packId).toUpperCase(), String(p.packName)]));

  const problems = [];
  const seen = new Map();

  for (const { code, name, nameZh } of entries) {
    const id = code.toUpperCase();

    const dupe = seen.get(id);
    if (dupe) problems.push(`${code}: duplicate code (also '${dupe}')`);
    else seen.set(id, name);

    const realJa = jaById.get(id);
    const override = JA_NAME_OVERRIDES[id];
    if (JA_VIA_HUCA.has(id)) {
      // Verified against Huca while TCGdex catches up — see JA_VIA_HUCA.
      if (realJa) {
        problems.push(
          `${code}: TCGdex now has a ja record ('${realJa}') — drop it from JA_VIA_HUCA `
          + 'and check the name against TCGdex',
        );
      } else {
        const hucaJa = await hucaJaSetName(id);
        if (!hucaJa) problems.push(`${code}: not in TCGdex, and Huca has no 拡張パック title for it either`);
        else if (hucaJa !== name) problems.push(`${code}: name '${name}' but Huca says '${hucaJa}'`);
      }
    } else if (!realJa) {
      problems.push(`${code}: not a TCGdex ja set id`);
    } else if (override) {
      // Deliberate divergence. Re-check the premise rather than just skipping:
      // both halves must still hold or the override has gone stale.
      if (name !== override.weSay) {
        problems.push(`${code}: name '${name}' but the documented override says '${override.weSay}'`);
      } else if (realJa !== override.tcgdexSays) {
        problems.push(
          `${code}: override assumes TCGdex reports '${override.tcgdexSays}', but it now reports `
          + `'${realJa}' — recheck the set and drop JA_NAME_OVERRIDES.${id} if TCGdex is fixed`,
        );
      }
    } else if (realJa !== name) {
      // The failure that started all this: a real name on the wrong code.
      problems.push(`${code}: name '${name}' but TCGdex says '${realJa}'`);
    }

    if (nameZh) {
      if (ZH_VIA_KAPAIPAI.has(id)) {
        // No TCGdex zh-tw record yet; kapaipai's packName is the name pricing
        // actually matches on, so verify there instead.
        if (kpById.size === 0) {
          problems.push(`${code}: nameZh is verified via kapaipai, but its pack list could not be fetched`);
        } else {
          const kpName = kpById.get(id);
          if (!kpName) problems.push(`${code}: nameZh '${nameZh}' but kapaipai has no pack '${id}'`);
          else if (kpName !== nameZh) problems.push(`${code}: nameZh '${nameZh}' but kapaipai says '${kpName}'`);
          else if (twById.has(id)) {
            problems.push(`${code}: TCGdex now has a zh-tw record — drop it from ZH_VIA_KAPAIPAI`);
          }
        }
      } else {
        const realTw = twById.get(id);
        if (!realTw) problems.push(`${code}: nameZh '${nameZh}' but no zh-tw release`);
        else if (realTw !== nameZh) problems.push(`${code}: nameZh '${nameZh}' but TCGdex says '${realTw}'`);
      }
    }
  }

  console.log(`Checked ${entries.length} products against TCGdex (${jaById.size} ja / ${twById.size} zh-tw sets).`);

  if (problems.length) {
    console.error(`\n${problems.length} problem(s):`);
    for (const p of problems) console.error('  x ' + p);
    return 1;
  }
  console.log('All set codes and names match.');
  return 0;
}

// Set exitCode rather than calling process.exit(): exiting while fetch's
// keep-alive sockets are still open aborts Node on Windows with a libuv
// assertion, which mangles the status and would make a CI gate silently pass.
process.exitCode = await main();
