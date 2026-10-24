import { describe, it, expect } from 'vitest';
import { boxSnkrdunkId, zhBoxOf } from './ptcg-boxes';

describe('boxSnkrdunkId', () => {
  it('resolves a standard ja box by set code, case-insensitively', () => {
    expect(boxSnkrdunkId('M1L', 'ja')).toBe(628146);
  });

  it('resolves a special ja box by its set name', () => {
    expect(boxSnkrdunkId('', 'ja', 'スペシャルBOX ポケモンセンターフクオカ')).toBe(618444);
  });

  it('never answers for a zh-tw box', () => {
    expect(boxSnkrdunkId('m1L', 'zh-tw')).toBeUndefined();
  });
});

describe('zhBoxOf', () => {
  it('resolves a standard zh-tw box by set code', () => {
    expect(zhBoxOf('sv11b', 'zh-tw')).toMatchObject({ kpPackId: 'SV11B', kpPackCardId: 'SV11B-000P' });
  });

  it('prefers the special product named by set name over the set code', () => {
    // 莉莉艾's special set shares pack M1L with the standard box.
    expect(zhBoxOf('m1L', 'zh-tw', '超級勇氣 特別組合 莉莉艾')).toMatchObject({ kpPackId: 'M1L', kpPackCardId: '000S' });
  });

  it('never answers for a ja box', () => {
    expect(zhBoxOf('m1L', 'ja')).toBeUndefined();
  });
});
