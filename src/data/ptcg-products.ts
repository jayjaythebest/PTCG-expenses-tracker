export interface PtcgProduct {
  code: string;
  name: string;      // Japanese set name (what existing rows store)
  series: string;    // Japanese series name
  // Official Traditional-Chinese labels for the add/box form dropdowns. When a
  // set has no TW release yet, leave nameZh empty and the UI falls back to the
  // Japanese name. Values here are display-only — price lookups still use `code`.
  nameZh?: string;
  seriesZh?: string;
}

// Official Traditional-Chinese series names (asia.pokemon-card.com/tw).
export const SERIES_ZH: Record<string, string> = {
  'ポケモンカードゲーム MEGA': '超級進化',
  'スカーレット＆バイオレット': '朱＆紫',
  'ソード＆シールド': '劍＆盾',
};

// IMPORTANT: `code` must be the code PRINTED on the card (SV2D, S12a, M4…),
// and `name` must match the TCGdex set name EXACTLY.
//
// Both are load-bearing, not cosmetic:
//   * api/_lib/pricing.ts resolves the Huca set code by looking the stored set
//     NAME up in TCGdex. A name that differs by even one character (「スター
//     バース」vs「スターバース」, 「古代の鼓動」vs「古代の咆哮」) fails to resolve
//     and the card silently shows no price.
//   * `code` is the fallback when that lookup is ambiguous, and it drives
//     artwork fetches and the scan branches' setName resolution.
//
// Verify any addition against https://api.tcgdex.net/v2/ja/sets (and
// /v2/zh-tw/sets for nameZh) rather than typing from memory.
export const PTCG_PRODUCTS: PtcgProduct[] = [
  // ── ポケモンカードゲーム MEGA (2025〜) ──────────────────────
  { code: 'm1L',  name: 'メガブレイブ',            series: 'ポケモンカードゲーム MEGA', nameZh: '超級勇氣' },
  { code: 'm1S',  name: 'メガシンフォニア',         series: 'ポケモンカードゲーム MEGA', nameZh: '超級交響樂' },
  { code: 'm2',   name: 'インフェルノX',            series: 'ポケモンカードゲーム MEGA', nameZh: '烈獄狂火X' },
  { code: 'm2a',  name: 'MEGAドリームex',           series: 'ポケモンカードゲーム MEGA', nameZh: '超級進化夢想ex' },
  { code: 'm3',   name: 'ムニキスゼロ',             series: 'ポケモンカードゲーム MEGA', nameZh: '虛無歸零' },
  { code: 'm4',   name: 'ニンジャスピナー',         series: 'ポケモンカードゲーム MEGA', nameZh: '忍者飛旋' },
  { code: 'm5',   name: 'アビスアイ',               series: 'ポケモンカードゲーム MEGA', nameZh: '深淵之瞳' },
  // ── スカーレット＆バイオレット 2023 ─────────────────────────
  { code: 'sv1S', name: 'スカーレットex',           series: 'スカーレット＆バイオレット', nameZh: '朱ex' },
  { code: 'sv1V', name: 'バイオレットex',           series: 'スカーレット＆バイオレット', nameZh: '紫ex' },
  { code: 'sv1a', name: 'トリプレットビート',       series: 'スカーレット＆バイオレット', nameZh: '三連音爆' },
  { code: 'sv2P', name: 'スノーハザード',           series: 'スカーレット＆バイオレット', nameZh: '冰雪險境' },
  { code: 'sv2D', name: 'クレイバースト',           series: 'スカーレット＆バイオレット', nameZh: '碟旋暴擊' },
  { code: 'sv2a', name: 'ポケモンカード151',        series: 'スカーレット＆バイオレット', nameZh: '寶可夢卡牌151' },
  { code: 'sv3',  name: '黒炎の支配者',             series: 'スカーレット＆バイオレット', nameZh: '黯焰支配者' },
  { code: 'sv3a', name: 'レイジングサーフ',         series: 'スカーレット＆バイオレット', nameZh: '激狂駭浪' },
  { code: 'sv4K', name: '古代の咆哮',               series: 'スカーレット＆バイオレット', nameZh: '古代咆哮' },
  { code: 'sv4M', name: '未来の一閃',               series: 'スカーレット＆バイオレット', nameZh: '未來閃光' },
  // TCGdex's ja record for SV4a is wrong — it repeats SV3a's name
  // 「レイジングサーフ」. The card counts prove which is which (SV3a 62 official =
  // Raging Surf, SV4a 190 official = Shiny Treasure ex), and zh-tw/kapaipai both
  // say 閃色寶藏ex. We store the TRUE ja name; see JA_NAME_OVERRIDES in
  // scripts/verify-sets.mjs. Pricing is unaffected: 「レイジングサーフ」 resolves to
  // two ids so it's ambiguous either way, and lookupHuca falls back to `code`.
  { code: 'sv4a', name: 'シャイニートレジャーex',     series: 'スカーレット＆バイオレット', nameZh: '閃色寶藏ex' },
  // ── スカーレット＆バイオレット 2024 ─────────────────────────
  { code: 'sv5K', name: 'ワイルドフォース',         series: 'スカーレット＆バイオレット', nameZh: '狂野之力' },
  { code: 'sv5M', name: 'サイバージャッジ',         series: 'スカーレット＆バイオレット', nameZh: '異度審判' },
  { code: 'sv5a', name: 'クリムゾンヘイズ',         series: 'スカーレット＆バイオレット', nameZh: '緋紅薄霧' },
  { code: 'sv6',  name: '変幻の仮面',               series: 'スカーレット＆バイオレット', nameZh: '變幻假面' },
  { code: 'sv6a', name: 'ナイトワンダラー',         series: 'スカーレット＆バイオレット', nameZh: '黑夜漫遊者' },
  { code: 'sv7',  name: 'ステラミラクル',           series: 'スカーレット＆バイオレット', nameZh: '星晶奇跡' },
  { code: 'sv7a', name: '楽園ドラゴーナ',           series: 'スカーレット＆バイオレット', nameZh: '樂園騰龍' },
  { code: 'sv8',  name: '超電ブレイカー',           series: 'スカーレット＆バイオレット', nameZh: '超電突圍' },
  { code: 'sv8a', name: 'テラスタルフェスex',       series: 'スカーレット＆バイオレット', nameZh: '太晶慶典ex' },
  // ── スカーレット＆バイオレット 2025 ─────────────────────────
  { code: 'sv9',  name: 'バトルパートナーズ',       series: 'スカーレット＆バイオレット', nameZh: '對戰搭檔' },
  { code: 'sv9a', name: '熱風のアリーナ',           series: 'スカーレット＆バイオレット', nameZh: '熱風競技場' },
  { code: 'sv10', name: 'ロケット団の栄光',         series: 'スカーレット＆バイオレット', nameZh: '火箭隊的榮耀' },
  // TCGdex has no zh-tw record for these two yet, but kapaipai (the actual
  // zh-tw price source) ships packs SV11B/SV11W under these names, so nameZh is
  // verified against kapaipai instead — see ZH_NAME_SOURCES in verify-sets.mjs.
  { code: 'sv11B', name: 'ブラックボルト',          series: 'スカーレット＆バイオレット', nameZh: '漆黑伏特' },
  { code: 'sv11W', name: 'ホワイトフレア',          series: 'スカーレット＆バイオレット', nameZh: '純白閃焰' },
  // ── ソード＆シールド 人気セット ─────────────────────────────
  // These DO have Traditional-Chinese releases (asia.pokemon-card.com/tw), so a
  // scanned 繁中 card of these sets is legitimate — don't assume ja.
  { code: 's8b',  name: 'VMAXクライマックス',       series: 'ソード＆シールド', nameZh: 'VMAX絕群壓軸' },
  { code: 's9',   name: 'スターバース',             series: 'ソード＆シールド', nameZh: '星星誕生' },
  { code: 's9a',  name: 'バトルリージョン',         series: 'ソード＆シールド', nameZh: '對戰地區' },
  { code: 's10D', name: 'タイムゲイザー',           series: 'ソード＆シールド', nameZh: '時間觀察者' },
  { code: 's10P', name: 'スペースジャグラー',       series: 'ソード＆シールド', nameZh: '空間魔術師' },
  { code: 's10a', name: 'ダークファンタズマ',       series: 'ソード＆シールド', nameZh: '黑暗亡靈' },
  { code: 's10b', name: 'Pokémon GO',               series: 'ソード＆シールド', nameZh: 'Pokémon GO' },
  // TCGdex's zh-tw record for S11 is corrupted (it reports 「三連音爆」, the name
  // it also gives a dozen unrelated sets), so nameZh is left off rather than wrong.
  { code: 's11',  name: 'ロストアビス',             series: 'ソード＆シールド' },
  { code: 's11a', name: '白熱のアルカナ',           series: 'ソード＆シールド', nameZh: '白熱奧祕' },
  { code: 's12',  name: 'パラダイムトリガー',       series: 'ソード＆シールド', nameZh: '思維激盪' },
  { code: 's12a', name: 'VSTARユニバース',          series: 'ソード＆シールド', nameZh: '天地萬物VSTAR' },
];
