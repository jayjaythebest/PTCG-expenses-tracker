import { describe, it, expect } from 'vitest';
import {
  extractNumber,
  classifyCondition,
  buildWantGrade,
  pickHucaPrice,
  normNum,
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
