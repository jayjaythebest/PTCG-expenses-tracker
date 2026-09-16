// Sealed products that aren't a booster set of their own (premium boxes, deck
// sets, card sets) but belong to one. Shown in the expense form's product picker
// so they can be logged by their real title in either language; picking one
// tags the expense with `setCode`.
//
// Kept out of ptcg-products.ts on purpose: scripts/verify-sets.mjs and the
// pricing code treat every entry there as a TCGdex set.
//
// Titles are copied from the official product pages — nameJa from
// 30th.pokemon-card.com/product, nameZh from asia.pokemon-card.com/tw. Leave a
// side empty when that language has no equivalent product.
export interface SpecialProduct {
  setCode: string;  // PTCG_PRODUCTS.code of the set it belongs to
  group: string;    // picker heading
  nameJa?: string;
  nameZh?: string;
}

export const SPECIAL_PRODUCTS: SpecialProduct[] = [
  // ── 30 週年（2026-09-16 世界同步發售）─────────────────────────
  {
    setCode: 'm6a', group: '30 週年特別商品',
    nameJa: '拡張パック「30th CELEBRATION」BOX',
    nameZh: '擴充包「30th CELEBRATION」BOX',
  },
  {
    setCode: 'm6a', group: '30 週年特別商品',
    nameJa: '30th CELEBRATION FUTURISTIC BOX',
    nameZh: '30th CELEBRATION FUTURISTIC BOX',
  },
  {
    setCode: 'm6a', group: '30 週年特別商品',
    nameJa: '30th CELEBRATION プレミアムデッキセット エーフィ・ブラッキー',
    nameZh: '30th CELEBRATION頂級牌組組合 太陽伊布・月亮伊布',
  },
  // The two markets split the starter product differently: Japan sells nine
  // separate カードセット (2026-10-16), Taiwan one 特別卡組 in nine variants.
  {
    setCode: 'm6a', group: '30 週年特別商品',
    nameJa: '30th CELEBRATION カードセット',
    nameZh: '30th CELEBRATION特別卡組「最初的夥伴」',
  },
];
