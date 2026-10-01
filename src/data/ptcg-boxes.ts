// Snkrdunk product ids for the sealed JAPANESE products a row logs as a box
// (booster boxes, and a deck set that is a whole set of its own), keyed by the PTCG set
// code (see PTCG_PRODUCTS.code). Snkrdunk exposes a public JSON API
// (`/v1/apparels/{id}`) whose `usedMinPrice` / `minPrice` give a real sealed-box
// price that updates daily — the same feed Huca's box pages (huca.tw/?mode=box,
// e.g. huca.tw/boxes/2/m5-abyss-eye) display. There's no reliable keyword/box
// search API, so each set's whole-box id is harvested by hand from its Huca box
// detail page (which carries the Snkrdunk product id) and listed here. A set
// with an id here gets automatic, daily-updated box valuation; sets without one
// keep the user's manual estimate. zh-tw / en boxes are not auto-priced yet (no
// free source), so they always fall back to the manual estimate.
//
// The id must be the one sealed product its SET CODE names, because the lookup
// has nothing finer than the code to go on. For a booster set that means the
// STANDARD box (拡張パック「…」ボックス) and deliberately NOT the single pack
// (パック), the attaché-case set, or a special box — M6a alone ships a Box
// (881421), a Pack (881422) and the FUTURISTIC BOX (881424) at ¥25,400 / ¥1,000
// / ¥63,800, and all three would answer to `m6a`. A code that names exactly one
// product, like the MF deck set, has no such ambiguity and maps to that product.
//
// To add a box: open its Huca box page (huca.tw/?mode=box), grab the Snkrdunk
// product id it links to, and map it from the set code below.
const SNKRDUNK_BOX_ID_JA: Record<string, number> = {
  // ── ポケモンカードゲーム MEGA ──
  m1L: 628146, // メガブレイブ
  m1S: 628148, // メガシンフォニア
  m2: 687430, // インフェルノX
  m2a: 721913, // MEGAドリームex（ハイクラスパック）
  m3: 743533, // ムニキスゼロ
  m4: 762693, // ニンジャスピナー
  m5: 806644, // アビスアイ
  m6: 846048, // ストームエメラルダ
  m6a: 881421, // 30th CELEBRATION
  // Not a booster box: MF is the 構築デッキ「30th CELEBRATION プレミアムデッキセット
  // エーフィ・ブラッキー」, Snkrdunk's `pkmn-tcg-MF-PD`. It is the only sealed
  // product filed under MF, so the code resolves it unambiguously.
  MF: 881423,
  // ── スカーレット＆バイオレット ──
  sv2a: 118914, // ポケモンカード151
  sv6: 224649, // ナイトワンダラー
  sv8a: 424297, // テラスタルフェスex
  sv9: 484952, // バトルパートナーズ
};

// Resolve the Snkrdunk box product id for a set + edition, or undefined when the
// box can't be auto-priced. Only JA boxes are auto-priced today; zh-tw / en
// boxes fall back to the manual estimate.
export function boxSnkrdunkId(setCode: string, edition?: string | null): number | undefined {
  // An unspecified edition ('' or null) is treated as JA — the only edition we
  // can auto-price — so a box added without picking a version still gets a price.
  if ((edition || 'ja') !== 'ja') return undefined;
  const want = (setCode ?? '').toLowerCase();
  if (!want) return undefined;
  const key = Object.keys(SNKRDUNK_BOX_ID_JA).find(k => k.toLowerCase() === want);
  return key != null ? SNKRDUNK_BOX_ID_JA[key] : undefined;
}
