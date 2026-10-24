// Snkrdunk product ids for the sealed JAPANESE products a row logs as a box
// (booster boxes, and a deck set that is a whole set of its own), keyed by the PTCG set
// code (see PTCG_PRODUCTS.code). Snkrdunk exposes a public JSON API
// (`/v1/apparels/{id}`) whose `usedMinPrice` / `minPrice` give a real sealed-box
// price that updates daily — the same feed Huca's box pages (huca.tw/?mode=box,
// e.g. huca.tw/boxes/2/m5-abyss-eye) display. There's no reliable keyword/box
// search API, so each set's whole-box id is harvested by hand from its Huca box
// detail page (which carries the Snkrdunk product id) and listed here. A set
// with an id here gets automatic, daily-updated box valuation; sets without one
// keep the user's manual estimate. zh-tw boxes are priced off kapaipai instead
// (ZH_BOX_* below); en boxes are not auto-priced.
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

// Sealed products that are NOT a set's standard box, so no set code can name
// them. Such a row stores the product's own name as its set_name, and is keyed
// by that here.
const SNKRDUNK_BOX_ID_JA_BY_NAME: Record<string, number> = {
  'スペシャルBOX ポケモンセンタートウホク': 618442,
  'スペシャルBOX ポケモンセンターフクオカ': 618444,
};

const findByCode = <T,>(map: Record<string, T>, setCode: string): T | undefined => {
  const want = (setCode ?? '').toLowerCase();
  if (!want) return undefined;
  const key = Object.keys(map).find(k => k.toLowerCase() === want);
  return key != null ? map[key] : undefined;
};

// Resolve the Snkrdunk box product id for a set + edition, or undefined when the
// box can't be priced off Snkrdunk. zh-tw boxes go through boxKapaipaiRef.
export function boxSnkrdunkId(setCode: string, edition?: string | null, setName?: string | null): number | undefined {
  // An unspecified edition ('' or null) is treated as JA, so a box added
  // without picking a version still gets a price.
  if ((edition || 'ja') !== 'ja') return undefined;
  return SNKRDUNK_BOX_ID_JA_BY_NAME[(setName ?? '').trim()] ?? findByCode(SNKRDUNK_BOX_ID_JA, setCode);
}

// Traditional-Chinese sealed products. Price: kapaipai's sealed listing, named
// by its packId + packCardId — the `原盒` row of getCardPackDetailList. One pack
// routinely holds several sealed products (M4 lists the standard box, the
// 10包組合PLUS and the 加值組合), and their packCardIds follow no rule
// (000P / 000P-M4 / 000PA / SV11B-000P), so each is copied by hand from
// `/api/card/getCardPackDetailList?packId=…&game=pkmtw`. Image: the product's
// thumbnail on the official TW products page (asia.pokemon-card.com/tw/products/),
// which, unlike the card-search landing page, keeps products that are no longer
// on sale.
export interface ZhBox {
  kpPackId: string;
  kpPackCardId: string;
  image: string;
}

const TW_UPLOADS = 'https://asia.pokemon-card.com/tw/wp-content/uploads/sites/2/';

const zhBox = (kpPackId: string, kpPackCardId: string, image: string): ZhBox =>
  ({ kpPackId, kpPackCardId, image: TW_UPLOADS + image });

// Standard boxes, keyed by set code like SNKRDUNK_BOX_ID_JA.
const ZH_BOX_BY_CODE: Record<string, ZhBox> = {
  // ── 超級進化 ──
  m1L: zhBox('M1L', '000P', '2025/07/twhk_product_thumbnail_M1L.png'),
  m1S: zhBox('M1S', '000P', '2025/07/twhk_product_thumbnail_M1S.png'),
  m2: zhBox('M2', '000P', '2025/09/tw_product_thumbnail_m2_pkg.png'),
  m2a: zhBox('M2a', '000P', '2025/11/tw_M2a_pkg.png'),
  m3: zhBox('M3', '000P', '2025/12/twhk_product_thumbnail_M3_PKG.png'),
  m4: zhBox('M4', '000P-M4', '2026/02/twhk_product_thumbnail_M4_PKG.png'),
  m5: zhBox('M5', '000P-M5', '2026/05/twhk_product_thumbnail_M5_pkg.png'),
  m6: zhBox('M6', '000PA', '2026/06/twhk_product_thumbnail_m6_pkg.png'),
  m6a: zhBox('M6a', '000P', '2026/05/twhk_product_thumbnail_m6a_pkg.png'),
  // ── 朱&紫 ──
  sv9: zhBox('SV9', '000P', '2025/01/twhk_product_thumbnail_SV9_pillow.png'),
  sv10: zhBox('SV10', '000P', '2025/03/twhk_product_thumbnail_SV10.png'),
  sv11B: zhBox('SV11B', 'SV11B-000P', '2025/05/twhk_product_thumbnail_SV11B.png'),
  sv11W: zhBox('SV11W', 'SV11W-000P', '2025/05/twhk_product_thumbnail_SV11W.png'),
};

// Special products, keyed by set_name (the product's official TW name).
// 初階牌組100對戰收藏 is deliberately absent: kapaipai's MC 原盒 listing sells
// ONE random deck (NT$100–300), so it can't price a carton of them.
const ZH_BOX_BY_NAME: Record<string, ZhBox> = {
  '超級勇氣 特別組合 莉莉艾': zhBox('M1L', '000S', '2025/07/twhk_product_thumbnail_SPset_M1L.png'),
  '烈獄狂火X 加值組合': zhBox('M2-PLUS', '000S', '2025/09/tw_prduct_banner_m2_40set.png'),
  '特別組合 超級噴火龍Y': zhBox('M3-PLUS', '000PD', '2025/12/twhk_product_thumbnail_M3P_PKG.png'),
  '忍者飛旋 加值組合': zhBox('M4-PLUS', '000PB-M4-PLUS', '2026/02/twhk_product_thumbnail_M4_40set_PKG.png'),
  '深淵之瞳 加值組合': zhBox('M5-PLUS', '000PB-M5-PLUS', '2026/05/twhk_product_thumbnail_m5_extra_value_set_pkg.png'),
};

export function zhBoxOf(setCode: string, edition?: string | null, setName?: string | null): ZhBox | undefined {
  if (edition !== 'zh-tw') return undefined;
  return ZH_BOX_BY_NAME[(setName ?? '').trim()] ?? findByCode(ZH_BOX_BY_CODE, setCode);
}
