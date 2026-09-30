import { describe, it, expect } from 'vitest';
import { productCodeFromFile } from './tw-card-image';

describe('productCodeFromFile', () => {
  it('reads the code-first filenames', () => {
    expect(productCodeFromFile('M5_pillow_img_TWHK.png')).toBe('M5');
    expect(productCodeFromFile('MBD_PKG_img.png')).toBe('MBD');
    expect(productCodeFromFile('MC_PKG_TWHK.png')).toBe('MC');
  });

  it('reads the 2026 twhk-prefixed filenames', () => {
    // The real bug: these all resolved to "TWHK", so MF had no pack photo and
    // the gallery showed MF's first card (熱帶龍) for the 30th CELEBRATION
    // 頂級牌組組合 太陽伊布・月亮伊布 deck set.
    expect(productCodeFromFile('twhk_mf_pkg.png')).toBe('MF');
    expect(productCodeFromFile('twhk_m6a_pkg.png')).toBe('M6A');
    expect(productCodeFromFile('twhk_MJ_exp.png')).toBe('MJ');
  });

  it('skips a section marker between the locale and the code', () => {
    expect(productCodeFromFile('twhk_news_SVQP_pkg.png')).toBe('SVQP');
  });
});
