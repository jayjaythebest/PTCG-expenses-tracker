import { describe, it, expect } from 'vitest';
import {
  extractNumber,
  classifyCondition,
  buildWantGrade,
  pickHucaPrice,
  pickSnkrdunkBoxPrice,
  normNum,
  nameKey,
  pickKpRowForNumber,
  promoSetCodeFromNumber,
  hucaTitleCardName,
  hucaTitleMatchesName,
  parseHucaTitle,
  trimmedMean,
  kpSalePrice,
  recentSalePrice,
  snkrdunkSalePrice,
  type KpCardRow,
  type SnkrdunkTrade,
  type KpListing,
} from './pricing';

describe('extractNumber', () => {
  it('takes the part before a slash', () => {
    expect(extractNumber('117/081')).toBe('117');
  });
  it('takes the last run of digits, ignoring set-code prefixes', () => {
    expect(extractNumber('J m5 117')).toBe('117');
  });
  it('handles a bare number', () => {
    expect(extractNumber('054')).toBe('054');
  });
  it('takes the digit run even with a trailing letter', () => {
    expect(extractNumber(' 000P ')).toBe('000');
  });
  it('falls back to trimmed input when there are no digits', () => {
    expect(extractNumber(' PROMO ')).toBe('PROMO');
  });
});

describe('promoSetCodeFromNumber', () => {
  // Promos have no catalog entry, so the denominator of their collector number
  // is the only place their set is recorded.
  it('reads the set code off a promo number', () => {
    expect(promoSetCodeFromNumber('198/SV-P')).toBe('SV-P');
    expect(promoSetCodeFromNumber('133/M-P')).toBe('M-P');
    expect(promoSetCodeFromNumber('213/BW-P')).toBe('BW-P');
  });
  it('upper-cases so a lower-case entry still resolves', () => {
    expect(promoSetCodeFromNumber('198/sv-p')).toBe('SV-P');
  });
  it('returns null for a normal card, whose denominator is the set size', () => {
    expect(promoSetCodeFromNumber('223/187')).toBeNull();
    expect(promoSetCodeFromNumber('019/016')).toBeNull();
  });
  it('returns null when there is no denominator at all', () => {
    expect(promoSetCodeFromNumber('054')).toBeNull();
    expect(promoSetCodeFromNumber('')).toBeNull();
  });
  it('rejects junk rather than sending it as a set code', () => {
    expect(promoSetCodeFromNumber('198/こんな長い日本語のごみ')).toBeNull();
    expect(promoSetCodeFromNumber('198/ ')).toBeNull();
  });
});

describe('classifyCondition', () => {
  it('treats single letters as raw', () => {
    expect(classifyCondition('A')).toEqual({ graded: false, label: 'A' });
    expect(classifyCondition('b')).toEqual({ graded: false, label: 'B' });
  });
  it('normalises PSA slabs', () => {
    expect(classifyCondition('PSA10')).toEqual({ graded: true, label: 'PSA10' });
    expect(classifyCondition('PSA 10')).toEqual({ graded: true, label: 'PSA10' });
  });
  it('normalises BGS half-point slabs', () => {
    expect(classifyCondition('BGS 9.5')).toEqual({ graded: true, label: 'BGS9.5' });
  });
  it('handles empty / null', () => {
    expect(classifyCondition(null)).toEqual({ graded: false, label: null });
    expect(classifyCondition('')).toEqual({ graded: false, label: null });
  });
});

describe('buildWantGrade', () => {
  it('builds a compact label from grading fields', () => {
    expect(buildWantGrade(true, 'psa', '10')).toBe('PSA10');
    expect(buildWantGrade(true, 'bgs', '9.5')).toBe('BGS9.5');
  });
  it('returns null when not graded or missing fields', () => {
    expect(buildWantGrade(false, 'psa', '10')).toBeNull();
    expect(buildWantGrade(true, '', '10')).toBeNull();
    expect(buildWantGrade(true, 'psa', '')).toBeNull();
    expect(buildWantGrade(undefined, undefined, undefined)).toBeNull();
  });
});

describe('pickHucaPrice', () => {
  it('prefers average over latest over sort', () => {
    expect(pickHucaPrice({ id: 1, average_price: 100, latest_price: 200, sort_price: 300 })).toBe(100);
  });
  it('falls back to latest when average missing', () => {
    expect(pickHucaPrice({ id: 1, latest_price: 200, sort_price: 300 })).toBe(200);
  });
  it('falls back to sort_price when the others are missing', () => {
    expect(pickHucaPrice({ id: 1, sort_price: 300 })).toBe(300);
  });
  it('rounds the chosen price', () => {
    expect(pickHucaPrice({ id: 1, average_price: 99.6 })).toBe(100);
  });
  it('returns null when nothing usable', () => {
    expect(pickHucaPrice({ id: 1 })).toBeNull();
    expect(pickHucaPrice({ id: 1, average_price: 0, latest_price: 0, sort_price: 0 })).toBeNull();
  });
});

describe('pickSnkrdunkBoxPrice', () => {
  it('prefers the used floor over listing/new prices', () => {
    expect(pickSnkrdunkBoxPrice({ usedMinPrice: 12000, minPrice: 15000, minPriceOfNewListing: 18000 }))
      .toEqual({ price: 12000, condition: '二手' });
  });
  it('falls back to the lowest listing when there is no used floor', () => {
    expect(pickSnkrdunkBoxPrice({ minPrice: 15000, minPriceOfNewListing: 18000 }))
      .toEqual({ price: 15000, condition: '最低' });
  });
  it('falls back to the new-listing floor when the others are missing', () => {
    expect(pickSnkrdunkBoxPrice({ minPriceOfNewListing: 18000 }))
      .toEqual({ price: 18000, condition: '全新' });
  });
  it('rounds the chosen price', () => {
    expect(pickSnkrdunkBoxPrice({ usedMinPrice: 11999.6 }))
      .toEqual({ price: 12000, condition: '二手' });
  });
  it('returns null when nothing usable', () => {
    expect(pickSnkrdunkBoxPrice({})).toBeNull();
    expect(pickSnkrdunkBoxPrice({ usedMinPrice: 0, minPrice: 0, minPriceOfNewListing: 0 })).toBeNull();
  });
});

describe('normNum', () => {
  it('treats zero-padded and spaced numbers as equal', () => {
    expect(normNum('012')).toBe('12');
    expect(normNum('12')).toBe('12');
    expect(normNum(' 12 ')).toBe('12');
  });
  it('upper-cases fully non-numeric ids', () => {
    expect(normNum('abc')).toBe('ABC');
  });
});

describe('hucaTitleCardName', () => {
  it('drops the bracketed set/number and a trailing rarity token', () => {
    expect(hucaTitleCardName('イーブイex SAR [SV8a 223/187](ハイクラスパック「テラスタルフェスex」)'))
      .toBe('イーブイex');
  });
  it('keeps a bare name untouched', () => {
    expect(hucaTitleCardName('イーブイ [SVP 198]')).toBe('イーブイ');
  });
  it('strips a multi-word rarity like ACE SPEC', () => {
    expect(hucaTitleCardName('マスターボール ACE SPEC [SV5a 086]')).toBe('マスターボール');
  });
  it('never strips the name itself, even when it looks like a token', () => {
    expect(hucaTitleCardName('P [SVP 001]')).toBe('P');
  });
  // Promo titles carry a ":"-prefixed note about the printing. Left in, it made
  // a real SV-P promo unmatchable and the card silently showed no price.
  it('drops a colon-prefixed printing note', () => {
    expect(hucaTitleCardName('モトトカゲex: プロモ RR[SV-P 009]')).toBe('モトトカゲex');
    expect(hucaTitleCardName('基本草エネルギー P:参加賞 [M-P 035]')).toBe('基本草エネルギー');
    expect(hucaTitleCardName('イーブイ: 旧裏/プロモ[neo-P No.133]')).toBe('イーブイ');
  });
});

describe('parseHucaTitle', () => {
  // Huca lists a set the day it ships, so this title is the only card table that
  // can identify a brand-new set — the case where a scan used to snap the set
  // code onto an older set and take the wrong name/art/price with it.
  it('reads a brand-new set off the title', () => {
    expect(parseHucaTitle('カイオーガ AR [M6 080/076](拡張パック「ストームエメラルダ」)')).toEqual({
      setCode: 'M6',
      collectorNumber: '080/076',
      name: 'カイオーガ',
      rarity: 'AR',
      setName: 'ストームエメラルダ',
    });
  });
  it('reads FUR, the rarity 30th CELEBRATION introduced', () => {
    expect(parseHucaTitle('ミュウツーex FUR [M6a 134/103](拡張パック「30th CELEBRATION」)')).toEqual({
      setCode: 'M6a',
      collectorNumber: '134/103',
      name: 'ミュウツーex',
      rarity: 'FUR',
      setName: '30th CELEBRATION',
    });
  });
  it('reads a set name that itself contains a rarity-ish suffix', () => {
    expect(parseHucaTitle('イーブイex SAR [SV8a 223/187](ハイクラスパック「テラスタルフェスex」)')).toEqual({
      setCode: 'SV8a',
      collectorNumber: '223/187',
      name: 'イーブイex',
      rarity: 'SAR',
      setName: 'テラスタルフェスex',
    });
  });
  it('handles a promo: hyphenated code, no pack label, printing note dropped', () => {
    expect(parseHucaTitle('モトトカゲex: プロモ RR[SV-P 009]')).toEqual({
      setCode: 'SV-P',
      collectorNumber: '009',
      name: 'モトトカゲex',
      rarity: 'RR',
      setName: '',
    });
  });
  it('keeps ACE SPEC together rather than reporting the trailing token', () => {
    expect(parseHucaTitle('マスターボール ACE SPEC [SV5a 086/066]')?.rarity).toBe('ACE SPEC');
  });
  it('returns null when the title carries no bracketed set/number', () => {
    expect(parseHucaTitle('カイオーガ AR ストームエメラルダ')).toBeNull();
    expect(parseHucaTitle('')).toBeNull();
  });
});

describe('hucaTitleMatchesName', () => {
  // Only ever a second check on top of set-code + number. What it is actually
  // for: promo codes collide across languages, so Huca's SVP 198 is ザシアンex
  // (English) while the wanted card is a Japanese SV-P.
  it('rejects a different card sharing the set and number', () => {
    expect(hucaTitleMatchesName('ザシアンex P [SVP EN 198]【英語版】', 'イーブイ')).toBe(false);
  });
  it('accepts the same card with a rarity token', () => {
    expect(hucaTitleMatchesName('ピカチュウ P [SV-P 291]', 'ピカチュウ')).toBe(true);
  });
  it('ignores whitespace differences', () => {
    expect(hucaTitleMatchesName('超級噴火龍X ex [M2a 223]', '超級噴火龍Xex')).toBe(true);
  });
  it('rejects an empty wanted name rather than matching everything', () => {
    expect(hucaTitleMatchesName('イーブイ [SVP 198]', '')).toBe(false);
  });
  // Documents WHY this must never be the only check: it cannot tell printings
  // of the same name apart, which is exactly the ¥765,000 mispricing.
  it('cannot distinguish printings, so it is not an identity test on its own', () => {
    expect(hucaTitleMatchesName('ピカチュウ UR[BW1 056/053]', 'ピカチュウ')).toBe(true);
  });
});

describe('nameKey', () => {
  it('ignores whitespace so spaced/unspaced names compare equal', () => {
    expect(nameKey('超級噴火龍Xex')).toBe(nameKey('超級噴火龍X ex'));
  });
  it('is case-insensitive', () => {
    expect(nameKey('Pikachu EX')).toBe('pikachuex');
  });
  it('handles null/undefined', () => {
    expect(nameKey(undefined as unknown as string)).toBe('');
  });
});

describe('pickKpRowForNumber', () => {
  const row = (over: Partial<KpCardRow>): KpCardRow => ({
    packId: 'M2a',
    packCardId: '223',
    cardGlobalKey: 'M2a-223',
    cardName: '超級噴火龍Xex',
    ...over,
  });

  it('matches on the in-pack number (zero-pad insensitive) and returns the price', () => {
    const rows = [row({ packCardId: '223', averagePrice: 427 })];
    const picked = pickKpRowForNumber(rows, 'M2a', normNum('223'), '超級噴火龍Xex');
    expect(picked?.price).toBe(427);
    expect(picked?.localNumber).toBe('223');
  });

  it('prefers an exact name match over another variant at the same number', () => {
    const rows = [
      row({ packCardId: 'M2a-223', cardName: '其他卡', averagePrice: 10 }),
      row({ packCardId: 'M2a-223', cardName: '超級噴火龍X ex', averagePrice: 427 }),
    ];
    const picked = pickKpRowForNumber(rows, 'M2a', normNum('223'), '超級噴火龍Xex');
    expect(picked?.price).toBe(427);
  });

  it('falls back to lowestPrice when averagePrice is missing/zero', () => {
    const rows = [row({ averagePrice: 0, lowestPrice: 300 })];
    const picked = pickKpRowForNumber(rows, 'M2a', normNum('223'), '超級噴火龍Xex');
    expect(picked?.price).toBe(300);
  });

  it('returns null when no row matches the number', () => {
    const rows = [row({ packCardId: '001' })];
    expect(pickKpRowForNumber(rows, 'M2a', normNum('223'), '超級噴火龍Xex')).toBeNull();
  });

  it('returns null when the only match has no usable price', () => {
    const rows = [row({ averagePrice: 0, lowestPrice: 0 })];
    expect(pickKpRowForNumber(rows, 'M2a', normNum('223'), '超級噴火龍Xex')).toBeNull();
  });
});

describe('trimmedMean', () => {
  it('drops the bottom and top quarter before averaging', () => {
    // 8 values: cut 2 each side -> mean of 3000, 3100, 3200, 3300
    expect(trimmedMean([1, 50, 3000, 3100, 3200, 3300, 9999, 9999999])).toBe(3150);
  });
  it('uses the median when there are too few values to trim', () => {
    expect(trimmedMean([1, 3000, 9999999])).toBe(3000);
    expect(trimmedMean([2000, 3000])).toBe(2500);
  });
  it('ignores zero, negative and non-numeric values', () => {
    expect(trimmedMean([0, -5, NaN, 700])).toBe(700);
    expect(trimmedMean([])).toBeNull();
  });
});

describe('kpSalePrice', () => {
  const now = Date.parse('2026-09-17T00:00:00+08:00');
  const daysAgo = (d: number) => new Date(now - d * 86400000).toISOString();
  const row: KpCardRow = {
    packId: 'M2a', packCardId: '240', cardGlobalKey: '超級耿鬼ex-350-影藏-空無強風', cardName: '超級耿鬼ex', rare: ['SAR'],
  };
  const sale = (price: number, ago: number, over: Partial<KpListing> = {}): KpListing => ({
    productKey: row.cardGlobalKey, packCardId: '240', rare: 'SAR', price: String(price),
    condition: 'perfect', soldQuantity: 1, sortTime: daysAgo(ago), ...over,
  });

  it('averages the middle half of the last 30 days of sales', () => {
    const listings = [1, 3200, 3300, 3400, 3500, 3600, 3700, 12440].map((p, i) => sale(p, i + 1));
    // 8 sales, drop 2 each side -> 3300, 3400, 3500, 3600
    expect(kpSalePrice(listings, row, now)).toBe(3450);
  });

  it('ignores unsold, flawed, other-printing and other-variant listings', () => {
    const listings = [
      sale(3000, 1), sale(3000, 2), sale(3000, 3), sale(3000, 4), sale(3000, 5),
      sale(99, 1, { soldQuantity: 0 }),
      sale(99, 1, { condition: 'flawed' }),
      sale(99, 1, { packCardId: '241' }),
      sale(99, 1, { rare: 'SR' }),
      sale(99, 1, { productKey: 'another-card' }),
    ];
    expect(kpSalePrice(listings, row, now)).toBe(3000);
  });

  it('falls back to the ten most recent sales when the window is thin', () => {
    const old = Array.from({ length: 12 }, (_, i) => sale(i < 10 ? 4000 : 1000, 40 + i));
    expect(kpSalePrice([sale(4000, 2), ...old], row, now)).toBe(4000);
  });

  it('returns null when nothing has sold', () => {
    expect(kpSalePrice([sale(3000, 1, { soldQuantity: 0 })], row, now)).toBeNull();
  });
});

describe('recentSalePrice', () => {
  const now = Date.parse('2026-09-17T00:00:00Z');
  const daysAgo = (d: number) => now - d * 86400000;

  it('uses only the last 30 days when that holds at least five sales', () => {
    const sales = [100, 100, 100, 100, 100].map((p, i) => ({ price: p, at: daysAgo(i + 1) }));
    expect(recentSalePrice([...sales, { price: 9000, at: daysAgo(45) }], now)).toBe(100);
  });

  it('ignores sales older than 90 days', () => {
    expect(recentSalePrice([{ price: 1000, at: daysAgo(180) }], now)).toBeNull();
    expect(recentSalePrice([{ price: 1000, at: daysAgo(180) }, { price: 300, at: daysAgo(60) }], now)).toBe(300);
  });

  it('ignores unparseable dates', () => {
    expect(recentSalePrice([{ price: 500, at: NaN }], now)).toBeNull();
  });
});

describe('snkrdunkSalePrice', () => {
  const now = Date.parse('2026-09-17T00:00:00Z');
  const trade = (price: number, day: number, over: Partial<SnkrdunkTrade> = {}): SnkrdunkTrade => ({
    price, soldAt: new Date(now - day * 86400000).toISOString(), title: 'A', label: '1枚', ...over,
  });

  it('trims and averages single-card sales in the wanted condition', () => {
    const trades = [30000, 35000, 36000, 37000, 38000, 39000, 40000, 52000].map((p, i) => trade(p, i + 1));
    // drop 2 each side -> 36000..39000
    expect(snkrdunkSalePrice(trades, 'A', now)).toBe(37500);
  });

  it('skips other conditions and multi-card bundles', () => {
    const trades = [
      trade(1000, 1), trade(1000, 2), trade(1000, 3), trade(1000, 4), trade(1000, 5),
      trade(62000, 1, { title: 'PSA10' }),
      trade(5000, 1, { label: '2枚' }),
    ];
    expect(snkrdunkSalePrice(trades, 'A', now)).toBe(1000);
    expect(snkrdunkSalePrice(trades, 'PSA10', now)).toBe(62000);
  });
});
