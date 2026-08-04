import { describe, it, expect } from 'vitest';
import { scanCardNumber } from './cardNumber';
import { promoSetCodeFromNumber, extractNumber } from '../../api/_lib/pricing';

describe('scanCardNumber', () => {
  it('keeps the bare number for a catalogued card', () => {
    expect(scanCardNumber('223', 'SV8a', 'テラスタルフェスex')).toBe('223');
    expect(scanCardNumber('001', 'M5', 'メガブレイブ')).toBe('001');
  });

  it('appends the set code when no set name is stored', () => {
    expect(scanCardNumber('198', 'SV-P', '')).toBe('198/SV-P');
    expect(scanCardNumber('133', 'm-p', '')).toBe('133/M-P');
  });

  it('leaves an already-slashed number alone', () => {
    expect(scanCardNumber('198/SV-P', 'SV-P', '')).toBe('198/SV-P');
    expect(scanCardNumber('223/187', 'SV8a', '')).toBe('223/187');
  });

  it('refuses to append a code that would read back as a set size or junk', () => {
    expect(scanCardNumber('198', '187', '')).toBe('198');
    expect(scanCardNumber('198', '', '')).toBe('198');
    expect(scanCardNumber('198', 'こんな長いごみ', '')).toBe('198');
  });

  it('returns empty for an unread number so callers can fall back', () => {
    expect(scanCardNumber('', 'SV-P', '')).toBe('');
  });
});

// The whole point of the appended code is that the pricing resolver can read it
// back off the stored number, so assert the round-trip rather than the format.
describe('agrees with api/_lib/pricing', () => {
  it('stores a promo in the form promoSetCodeFromNumber resolves', () => {
    const stored = scanCardNumber('198', 'SV-P', '');
    expect(promoSetCodeFromNumber(stored)).toBe('SV-P');
    expect(extractNumber(stored)).toBe('198');
  });

  it('leaves a catalogued card resolving by set name, not by its number', () => {
    const stored = scanCardNumber('223', 'SV8a', 'テラスタルフェスex');
    expect(promoSetCodeFromNumber(stored)).toBeNull();
    expect(extractNumber(stored)).toBe('223');
  });
});
