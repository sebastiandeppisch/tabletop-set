/** 8-connected component labeling, shared by card detection (on the full
 * downscaled photo) and symbol segmentation (on a single canonical card). */
import type { Point } from "./geometry";

export interface Component {
  pixelCount: number;
  /** Flat pixel indices (y*w+x) belonging to this component. */
  pixels: number[];
  /** Pixels with at least one non-component neighbor -- cheap hull input. */
  boundary: Point[];
  bbox: { x: number; y: number; w: number; h: number };
}

export function connectedComponents(mask: Uint8Array, w: number, h: number): { labels: Int32Array; components: Component[] } {
  const labels = new Int32Array(w * h);
  const components: Component[] = [];
  const queue = new Int32Array(w * h);

  for (let start = 0; start < mask.length; start++) {
    if (mask[start] === 0 || labels[start] !== 0) continue;
    const label = components.length + 1;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = label;

    const pixels: number[] = [];
    const boundary: Point[] = [];
    let minX = w, minY = h, maxX = -1, maxY = -1;

    while (head < tail) {
      const idx = queue[head++];
      pixels.push(idx);
      const x = idx % w, y = (idx / w) | 0;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;

      let isBoundary = false;
      if (x === 0 || mask[y * w + (x - 1)] === 0) isBoundary = true;
      if (x === w - 1 || mask[y * w + (x + 1)] === 0) isBoundary = true;
      if (y === 0 || mask[(y - 1) * w + x] === 0) isBoundary = true;
      if (y === h - 1 || mask[(y + 1) * w + x] === 0) isBoundary = true;
      if (isBoundary) boundary.push([x, y]);

      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          const nIdx = ny * w + nx;
          if (mask[nIdx] !== 0 && labels[nIdx] === 0) {
            labels[nIdx] = label;
            queue[tail++] = nIdx;
          }
        }
      }
    }

    components.push({
      pixelCount: pixels.length,
      pixels,
      boundary,
      bbox: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 },
    });
  }
  return { labels, components };
}
