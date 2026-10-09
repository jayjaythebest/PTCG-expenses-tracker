import { describe, it, expect } from 'vitest';
import { boxIoU, dedupeByBox, sortByPosition } from './batchScan';
import { parseMultiScan } from './gemini';
import { boxToRect } from './imageCrop';
import type { ScannedCard } from './gemini';

// The six cards of the photo this was built against: two MEGA sets laid out
// 3×2 on a table. They matter as a fixture because they are MIXED — M1L and
// M1S in one shot — which is exactly the case a per-photo (rather than
// per-card) set code would get wrong.
const card = (over: Partial<ScannedCard> = {}): ScannedCard => ({
  setCode: 'M1L', localId: '072', name: 'シルシュルー', rarity: 'AR', language: 'ja', ...over,
});

const photo: ScannedCard[] = [
  card({ setCode: 'M1L', localId: '072', name: 'シルシュルー',   rarity: 'AR',  box: [240, 70, 540, 350] }),
  card({ setCode: 'M1S', localId: '064', name: 'ツボツボ',       rarity: 'AR',  box: [270, 360, 560, 650] }),
  card({ setCode: 'M1S', localId: '080', name: 'メガガルーラex', rarity: 'SR',  box: [250, 660, 540, 950] }),
  card({ setCode: 'M1S', localId: '072', name: 'ヌケニン',       rarity: 'AR',  box: [570, 60, 870, 350] }),
  card({ setCode: 'M1L', localId: '091', name: 'リーリエの決心', rarity: 'SAR', box: [580, 370, 880, 660] }),
  card({ setCode: 'M1L', localId: '074', name: 'オニスズメ',     rarity: 'AR',  box: [560, 670, 860, 960] }),
];

describe('parseMultiScan', () => {
  it('keeps every card of a six-card read, each with its own set code', () => {
    const out = parseMultiScan({ cards: photo, provider: 'gemini' });
    expect(out.cards).toHaveLength(6);
    expect(out.cards.map(c => `${c.setCode} ${c.localId}`)).toEqual([
      'M1L 072', 'M1S 064', 'M1S 080', 'M1S 072', 'M1L 091', 'M1L 074',
    ]);
    expect(out.provider).toBe('gemini');
  });

  it('drops an entry with nothing identifiable on it', () => {
    const out = parseMultiScan({
      cards: [
        ...photo,
        { setCode: '', localId: '', name: '', rarity: '', language: '' },
        { setCode: 'M1L', localId: '', name: '', rarity: 'AR', language: 'ja' },
      ],
    });
    expect(out.cards).toHaveLength(6);
  });

  it('reports a failed read as an error, not as zero cards found', () => {
    const out = parseMultiScan({ cards: [], error: 'ai_failed', reason: 'quota', providers: ['gemini'] });
    expect(out.cards).toEqual([]);
    expect(out.error).toBe('ai_failed');
    expect(out.reason).toBe('quota');
  });

  it('survives a response with no cards array at all', () => {
    expect(parseMultiScan({}).cards).toEqual([]);
    expect(parseMultiScan(null).cards).toEqual([]);
  });
});

describe('boxIoU', () => {
  it('is 1 for the same box and 0 for separate ones', () => {
    expect(boxIoU([0, 0, 100, 100], [0, 0, 100, 100])).toBe(1);
    expect(boxIoU([0, 0, 100, 100], [200, 200, 300, 300])).toBe(0);
  });

  it('is 0 when a box is missing or degenerate', () => {
    expect(boxIoU(undefined, [0, 0, 10, 10])).toBe(0);
    expect(boxIoU([0, 0, 0, 0], [0, 0, 10, 10])).toBe(0);
  });

  it('measures partial overlap', () => {
    // Two 100×100 boxes offset by 50 in both axes: 2500 / 17500.
    expect(boxIoU([0, 0, 100, 100], [50, 50, 150, 150])).toBeCloseTo(2500 / 17500, 6);
  });
});

describe('dedupeByBox', () => {
  it('leaves six distinct cards alone', () => {
    expect(dedupeByBox(photo)).toHaveLength(6);
  });

  it('drops a second read of the same patch of the photo', () => {
    // The same card described twice — the giveaway is the box, not the name.
    const doubled = [...photo, card({ setCode: 'M1L', localId: '072', name: 'シルシュルー', box: [245, 75, 545, 355] })];
    expect(dedupeByBox(doubled)).toHaveLength(6);
  });

  it('keeps two physical copies of one card laid side by side', () => {
    // Same card, its own place on the table — a legitimate second copy.
    const twoCopies = [...photo, card({ setCode: 'M1L', localId: '072', name: 'シルシュルー', box: [20, 70, 220, 350] })];
    expect(dedupeByBox(twoCopies)).toHaveLength(7);
  });

  it('keeps cards the model gave no box for', () => {
    const noBoxes = photo.map(({ box: _box, ...rest }) => rest);
    expect(dedupeByBox([...noBoxes, noBoxes[0]])).toHaveLength(7);
  });
});

describe('sortByPosition', () => {
  it('reads the table top to bottom, left to right', () => {
    const shuffled = [photo[5], photo[1], photo[3], photo[0], photo[4], photo[2]];
    expect(sortByPosition(shuffled).map(c => c.name)).toEqual(photo.map(c => c.name));
  });

  it('leaves the order alone when any box is missing', () => {
    const partial = [photo[2], { ...photo[0], box: undefined }, photo[1]];
    expect(sortByPosition(partial).map(c => c.name)).toEqual([photo[2].name, photo[0].name, photo[1].name]);
  });
});

describe('boxToRect', () => {
  it('converts a 0–1000 box into padded pixels', () => {
    const r = boxToRect([250, 500, 750, 1000], 1000, 2000, 0);
    expect(r).toEqual({ x: 500, y: 500, width: 500, height: 1000 });
  });

  it('clamps the padding to the image instead of cropping off-frame', () => {
    const r = boxToRect([0, 0, 500, 500], 1000, 1000, 0.1);
    expect(r).toEqual({ x: 0, y: 0, width: 550, height: 550 });
  });

  it('rejects a box that is missing, malformed or inside out', () => {
    expect(boxToRect(undefined, 100, 100)).toBeNull();
    expect(boxToRect([1, 2, 3], 100, 100)).toBeNull();
    expect(boxToRect([500, 500, 100, 100], 100, 100)).toBeNull();
    expect(boxToRect([0, 0, 500, 500], 0, 0)).toBeNull();
  });
});
