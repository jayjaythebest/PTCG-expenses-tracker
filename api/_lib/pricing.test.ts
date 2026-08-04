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
  type KpCardRow,
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
