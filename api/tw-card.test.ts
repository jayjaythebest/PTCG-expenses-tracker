import { describe, it, expect } from 'vitest';
import { nameMatches } from './tw-card';

describe('nameMatches', () => {
  it('rejects a same-number-different-card collision', () => {
    // The real bug: SV9F #131 is N's Zoroark ex, but the number-only resolver
    // returned 旋轉洛托姆 (Rotom) sitting at #131 in a wrong/incomplete set.
    expect(nameMatches('N的索羅亞克ex', '旋轉洛托姆')).toBe(false);
  });

  it('accepts an exact match', () => {
    expect(nameMatches('N的索羅亞克ex', 'N的索羅亞克ex')).toBe(true);
  });

  it('ignores whitespace and case differences', () => {
    expect(nameMatches('超級噴火龍X ex', '超級噴火龍Xex')).toBe(true);
    expect(nameMatches('Pikachu EX', 'pikachu ex')).toBe(true);
  });

  it('accepts a substring / suffix drift (same card)', () => {
    expect(nameMatches('噴火龍ex', '超級噴火龍ex')).toBe(true);
  });

  it('accepts a ≥2-char shared leading run (minor OCR drift on same Pokémon)', () => {
    expect(nameMatches('索羅亞克ex', '索羅亞克V')).toBe(true);
  });

  it('does not block when either name is empty', () => {
    expect(nameMatches('', '旋轉洛托姆')).toBe(true);
    expect(nameMatches('N的索羅亞克ex', '')).toBe(true);
  });

  it('rejects two clearly different Pokémon (no shared leading run)', () => {
    expect(nameMatches('皮卡丘ex', '妙蛙種子ex')).toBe(false);
  });
});
