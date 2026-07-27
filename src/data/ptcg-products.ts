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

export const PTCG_PRODUCTS: PtcgProduct[] = [
  // ── ポケモンカードゲーム MEGA (2025〜) ──────────────────────
  { code: 'm1L',  name: 'メガブレイブ',            series: 'ポケモンカードゲーム MEGA' },
  { code: 'm1S',  name: 'メガシンフォニア',         series: 'ポケモンカードゲーム MEGA' },
  { code: 'm2',   name: 'インフェルノX',            series: 'ポケモンカードゲーム MEGA' },
  { code: 'm2a',  name: 'MEGAドリームex',           series: 'ポケモンカードゲーム MEGA' },
  { code: 'm3',   name: 'ムニキスゼロ',             series: 'ポケモンカードゲーム MEGA' },
  { code: 'm4',   name: 'ニンジャスピナー',         series: 'ポケモンカードゲーム MEGA' },
  { code: 'm5',   name: 'アビスアイ',               series: 'ポケモンカードゲーム MEGA' },
  // ── スカーレット＆バイオレット 2023 ─────────────────────────
  // nameZh values below are the official TW names verified against retail /
  // asia.pokemon-card.com/tw. Sets whose official TW name isn't yet confirmed
  // are left without nameZh so the UI falls back to the Japanese name.
  { code: 'sv1',  name: 'スカーレット',             series: 'スカーレット＆バイオレット', nameZh: '朱' },
  { code: 'sv1',  name: 'バイオレット',             series: 'スカーレット＆バイオレット', nameZh: '紫' },
  { code: 'sv1a', name: 'トリプレットビート',       series: 'スカーレット＆バイオレット', nameZh: '三連音爆' },
  { code: 'sv1b', name: 'スノーハザード',           series: 'スカーレット＆バイオレット' },
  { code: 'sv1b', name: 'クレイバースト',           series: 'スカーレット＆バイオレット' },
  { code: 'sv2a', name: 'ポケモンカード151',        series: 'スカーレット＆バイオレット', nameZh: '151' },
  { code: 'sv2',  name: '黒炎の支配者',             series: 'スカーレット＆バイオレット', nameZh: '黑炎支配者' },
  { code: 'sv3',  name: 'レイジングサーフ',         series: 'スカーレット＆バイオレット' },
  { code: 'sv4K', name: '古代の鼓動',               series: 'スカーレット＆バイオレット' },
  { code: 'sv4M', name: '未来の一閃',               series: 'スカーレット＆バイオレット' },
  // ── スカーレット＆バイオレット 2024 ─────────────────────────
  { code: 'sv5K', name: 'ワイルドフォース',         series: 'スカーレット＆バイオレット' },
  { code: 'sv5M', name: 'サイバージャッジ',         series: 'スカーレット＆バイオレット' },
  { code: 'sv5a', name: 'クリムゾンヘイズ',         series: 'スカーレット＆バイオレット' },
  { code: 'sv6',  name: 'ナイトワンダラー',         series: 'スカーレット＆バイオレット' },
  { code: 'sv6a', name: 'テラスタルフェスティバル', series: 'スカーレット＆バイオレット' },
  { code: 'sv7',  name: 'ステラミラクル',           series: 'スカーレット＆バイオレット' },
  { code: 'sv7a', name: '楽園ドラゴーナ',           series: 'スカーレット＆バイオレット' },
  { code: 'sv8',  name: '超電ブレイカー',           series: 'スカーレット＆バイオレット', nameZh: '超電突圍' },
  { code: 'sv8a', name: 'テラスタルフェスex',       series: 'スカーレット＆バイオレット' },
  // ── スカーレット＆バイオレット 2025 ─────────────────────────
  { code: 'sv9',  name: 'バトルパートナーズ',       series: 'スカーレット＆バイオレット', nameZh: '對戰搭檔' },
  { code: 'sv9a', name: '熱風のアリーナ',           series: 'スカーレット＆バイオレット' },
  { code: 'sv10', name: 'ロケット団の栄光',         series: 'スカーレット＆バイオレット' },
  // ── ソード＆シールド 人気セット ─────────────────────────────
  // These predate the TW Traditional-Chinese launch (Oct 2023) and were never
  // released in 繁中, so there is no official Chinese name — JA is shown.
  { code: 's12a', name: 'VMAXクライマックス',       series: 'ソード＆シールド' },
  { code: 's12',  name: 'スター バース',            series: 'ソード＆シールド' },
  { code: 's11a', name: 'パラダイムトリガー',       series: 'ソード＆シールド' },
  { code: 's10a', name: 'ダークファンタズマ',       series: 'ソード＆シールド' },
  { code: 's10b', name: 'ポケモンGO',               series: 'ソード＆シールド' },
  { code: 's9a',  name: 'バトルリージョン',         series: 'ソード＆シールド' },
];
