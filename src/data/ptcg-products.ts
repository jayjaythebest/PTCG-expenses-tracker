export interface PtcgProduct {
  code: string;
  name: string;
  series: string;
}

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
  { code: 'sv1',  name: 'スカーレット',             series: 'スカーレット＆バイオレット' },
  { code: 'sv1',  name: 'バイオレット',             series: 'スカーレット＆バイオレット' },
  { code: 'sv1a', name: 'トリプレットビート',       series: 'スカーレット＆バイオレット' },
  { code: 'sv1b', name: 'スノーハザード',           series: 'スカーレット＆バイオレット' },
  { code: 'sv1b', name: 'クレイバースト',           series: 'スカーレット＆バイオレット' },
  { code: 'sv2a', name: 'ポケモンカード151',        series: 'スカーレット＆バイオレット' },
  { code: 'sv2',  name: '黒炎の支配者',             series: 'スカーレット＆バイオレット' },
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
  { code: 'sv8',  name: '超電ブレイカー',           series: 'スカーレット＆バイオレット' },
  { code: 'sv8a', name: 'テラスタルフェスex',       series: 'スカーレット＆バイオレット' },
  // ── スカーレット＆バイオレット 2025 ─────────────────────────
  { code: 'sv9',  name: 'バトルパートナーズ',       series: 'スカーレット＆バイオレット' },
  { code: 'sv9a', name: '熱風のアリーナ',           series: 'スカーレット＆バイオレット' },
  { code: 'sv10', name: 'ロケット団の栄光',         series: 'スカーレット＆バイオレット' },
  // ── ソード＆シールド 人気セット ─────────────────────────────
  { code: 's12a', name: 'VMAXクライマックス',       series: 'ソード＆シールド' },
  { code: 's12',  name: 'スター バース',            series: 'ソード＆シールド' },
  { code: 's11a', name: 'パラダイムトリガー',       series: 'ソード＆シールド' },
  { code: 's10a', name: 'ダークファンタズマ',       series: 'ソード＆シールド' },
  { code: 's10b', name: 'ポケモンGO',               series: 'ソード＆シールド' },
  { code: 's9a',  name: 'バトルリージョン',         series: 'ソード＆シールド' },
];
