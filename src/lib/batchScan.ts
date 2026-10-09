// Cleaning up a batch read before it reaches the review list.
//
// A vision model reading six cards off a table sometimes answers with the same
// card twice — the same patch of the photo, described two different ways. That
// can't be caught by comparing names and numbers alone: two copies of one card
// in the same shot is a perfectly normal pull, and silently folding those into
// one row would lose a card. What distinguishes a double-read is that both
// entries point at the SAME place in the photo.
import type { ScannedCard } from './gemini';

// Intersection over union of two box_2d rectangles ([ymin, xmin, ymax, xmax]).
// 0 when they don't overlap (or either box is unusable), 1 when identical.
export function boxIoU(a: number[] | undefined, b: number[] | undefined): number {
  if (!a || !b || a.length !== 4 || b.length !== 4) return 0;
  const [ay1, ax1, ay2, ax2] = a;
  const [by1, bx1, by2, bx2] = b;
  const areaA = Math.max(0, ay2 - ay1) * Math.max(0, ax2 - ax1);
  const areaB = Math.max(0, by2 - by1) * Math.max(0, bx2 - bx1);
  if (areaA <= 0 || areaB <= 0) return 0;
  const iw = Math.max(0, Math.min(ax2, bx2) - Math.max(ax1, bx1));
  const ih = Math.max(0, Math.min(ay2, by2) - Math.max(ay1, by1));
  const inter = iw * ih;
  if (inter <= 0) return 0;
  return inter / (areaA + areaB - inter);
}

// Drop a card that occupies a box an earlier card already claimed — the same
// physical card read twice. Cards without a box are always kept: with nothing
// to compare, "two copies of the same card" is the likelier reading, and an
// extra row the user unticks beats a card that silently never arrived.
export function dedupeByBox(cards: ScannedCard[], threshold = 0.5): ScannedCard[] {
  const kept: ScannedCard[] = [];
  for (const card of cards) {
    if (card.box && kept.some(k => boxIoU(k.box, card.box) > threshold)) continue;
    kept.push(card);
  }
  return kept;
}

// Reading order: top to bottom, left to right, the way the cards are laid out
// in front of the camera — so row 3 in the list is the third card you see.
// Boxes within ~8% of the image height of each other count as the same row.
// With any box missing there is no consistent ordering to impose, so the
// model's own order stands rather than a half-sorted one.
export function sortByPosition(cards: ScannedCard[], rowTolerance = 80): ScannedCard[] {
  if (!cards.every(c => c.box)) return cards;
  return [...cards].sort((a, b) => {
    const [ay, ax] = a.box as number[];
    const [by, bx] = b.box as number[];
    if (Math.abs(ay - by) > rowTolerance) return ay - by;
    return ax - bx;
  });
}
