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

async function main() {
  // The catalog is TypeScript, so read it as text and pull the object literals
  // out rather than adding a transpile step for a one-file script.
  const source = await readFile(
    new URL('../src/data/ptcg-products.ts', import.meta.url),
    'utf8',
  );

  const entries = [...source.matchAll(
    /\{\s*code:\s*'([^']+)'\s*,\s*name:\s*'([^']+)'[^}]*?(?:nameZh:\s*'([^']+)')?[^}]*\}/g,
  )].map(m => ({ code: m[1], name: m[2], nameZh: m[3] }));

  if (entries.length === 0) {
    console.error('Could not parse any products — has the file format changed?');
    return 2;
  }

  const [ja, tw] = await Promise.all([
    fetch(JA_SETS).then(r => r.json()),
    fetch(TW_SETS).then(r => r.json()),
  ]);

  const byId = list => new Map(list.map(s => [String(s.id).toUpperCase(), String(s.name)]));
  const jaById = byId(ja);
  const twById = byId(tw);

  const problems = [];
  const seen = new Map();

  for (const { code, name, nameZh } of entries) {
    const id = code.toUpperCase();

    const dupe = seen.get(id);
    if (dupe) problems.push(`${code}: duplicate code (also '${dupe}')`);
    else seen.set(id, name);

    const realJa = jaById.get(id);
    if (!realJa) {
      problems.push(`${code}: not a TCGdex ja set id`);
    } else if (realJa !== name) {
      // The failure that started all this: a real name on the wrong code.
      problems.push(`${code}: name '${name}' but TCGdex says '${realJa}'`);
    }

    if (nameZh) {
      const realTw = twById.get(id);
      if (!realTw) problems.push(`${code}: nameZh '${nameZh}' but no zh-tw release`);
      else if (realTw !== nameZh) problems.push(`${code}: nameZh '${nameZh}' but TCGdex says '${realTw}'`);
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
