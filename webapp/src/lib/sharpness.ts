/** Cheap blur/focus check for a live camera frame: variance of the Laplacian.
 * Sharp edges produce large second-derivative responses; a blurred frame's
 * responses cluster near zero, so their variance is low. Used to skip
 * processing frames that are too blurred to classify reliably (motion blur
 * from a hand-held phone, a moment before autofocus catches up) rather than
 * confidently misreading them.
 */
import type { ImageBuffer } from "./geometry";

export function toGrayscaleSmall(img: ImageBuffer, longEdge: number): { gray: Float64Array; w: number; h: number } {
  const scale = Math.min(1, longEdge / Math.max(img.width, img.height));
  const w = Math.max(1, Math.round(img.width * scale));
  const h = Math.max(1, Math.round(img.height * scale));
  const gray = new Float64Array(w * h);

  for (let y = 0; y < h; y++) {
    const sy = Math.min(img.height - 1, Math.floor((y + 0.5) / scale));
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.floor((x + 0.5) / scale));
      const idx = (sy * img.width + sx) * 4;
      gray[y * w + x] = 0.299 * img.data[idx] + 0.587 * img.data[idx + 1] + 0.114 * img.data[idx + 2];
    }
  }
  return { gray, w, h };
}

export function laplacianVariance(gray: Float64Array, w: number, h: number): number {
  if (w < 3 || h < 3) return Infinity;
  let sum = 0, sumSq = 0, count = 0;
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap = 4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      sum += lap;
      sumSq += lap * lap;
      count++;
    }
  }
  const mean = sum / count;
  return sumSq / count - mean * mean;
}

/** Sharpness score for a frame, at a small fixed size so this is cheap
 * enough to run every frame even when the full pipeline gets skipped. */
export function frameSharpness(img: ImageBuffer): number {
  const { gray, w, h } = toGrayscaleSmall(img, 320);
  return laplacianVariance(gray, w, h);
}
