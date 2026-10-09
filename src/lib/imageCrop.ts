// Cropping one card out of a photo of several, for the batch-scan review list.
// The AI answers with a box per card (Gemini's box_2d: [ymin, xmin, ymax, xmax],
// each 0–1000 of the image's height/width); the review row shows that crop next
// to the card the scan resolved, which is the only way to tell WHICH of six
// cards a wrong read belongs to.

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// box_2d -> pixel rect, padded a little so the crop isn't shaved tight to the
// card's edge, and clamped to the image. Returns null for a box that isn't four
// usable numbers or that lands outside the frame — the caller then shows the
// whole photo instead of a bad crop.
export function boxToRect(
  box: number[] | undefined,
  width: number,
  height: number,
  pad = 0.04,
): Rect | null {
  if (!box || box.length !== 4 || box.some(n => !Number.isFinite(n))) return null;
  const [ymin, xmin, ymax, xmax] = box;
  if (ymax <= ymin || xmax <= xmin) return null;
  if (width <= 0 || height <= 0) return null;

  const top = (ymin / 1000) * height;
  const left = (xmin / 1000) * width;
  const bottom = (ymax / 1000) * height;
  const right = (xmax / 1000) * width;
  const padY = (bottom - top) * pad;
  const padX = (right - left) * pad;

  const x = Math.max(0, Math.min(width, left - padX));
  const y = Math.max(0, Math.min(height, top - padY));
  const x2 = Math.max(0, Math.min(width, right + padX));
  const y2 = Math.max(0, Math.min(height, bottom + padY));
  if (x2 - x < 1 || y2 - y < 1) return null;

  return { x, y, width: x2 - x, height: y2 - y };
}

// Crop a box out of an already-loaded image, as a JPEG data URL. Small on
// purpose (a review-list thumbnail), and it never throws: a failure just means
// no crop, and the row falls back to the full photo.
export function cropToDataUrl(
  img: CanvasImageSource & { width: number; height: number },
  box: number[] | undefined,
  maxEdge = 320,
): string | null {
  const rect = boxToRect(box, img.width, img.height);
  if (!rect) return null;
  try {
    const scale = Math.min(1, maxEdge / Math.max(rect.width, rect.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(rect.width * scale));
    canvas.height = Math.max(1, Math.round(rect.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, rect.x, rect.y, rect.width, rect.height, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', 0.85);
  } catch {
    return null;
  }
}

// Load a File into an <img> so several boxes can be cropped out of it without
// decoding the photo once per card.
export function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const el = new Image();
    el.onload = () => { URL.revokeObjectURL(url); resolve(el); };
    el.onerror = e => { URL.revokeObjectURL(url); reject(e); };
    el.src = url;
  });
}
