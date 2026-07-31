/** Quad ordering, convex hull, polygon simplification and perspective warp --
 * all from scratch, no OpenCV.js. Mirrors set_solver/geometry.py + the
 * geometry helpers used inside set_solver/detection.py.
 */

export type Point = [number, number];

export interface ImageBuffer {
  width: number;
  height: number;
  /** RGBA, 4 bytes/pixel -- same layout as DOM ImageData so a canvas
   * getImageData() result can be used directly. */
  data: Uint8ClampedArray;
}

export function makeImageBuffer(width: number, height: number): ImageBuffer {
  return { width, height, data: new Uint8ClampedArray(width * height * 4) };
}

/** Order 4 points as TL, TR, BR, BL. */
export function orderQuad(pts: Point[]): Point[] {
  const sums = pts.map(([x, y]) => x + y);
  const diffs = pts.map(([x, y]) => x - y);
  const tl = pts[argmin(sums)];
  const br = pts[argmax(sums)];
  const tr = pts[argmax(diffs)];
  const bl = pts[argmin(diffs)];
  return [tl, tr, br, bl];
}

function argmin(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] < xs[best]) best = i;
  return best;
}

function argmax(xs: number[]): number {
  let best = 0;
  for (let i = 1; i < xs.length; i++) if (xs[i] > xs[best]) best = i;
  return best;
}

/** Shoelace formula. */
export function polygonArea(pts: Point[]): number {
  let sum = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % n];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
}

/** Andrew's monotone chain, O(n log n). Returns hull points counter-clockwise. */
export function convexHull(points: Point[]): Point[] {
  const pts = [...points].sort((a, b) => (a[0] - b[0]) || (a[1] - b[1]));
  const n = pts.length;
  if (n <= 2) return pts;

  const lower: Point[] = [];
  for (const p of pts) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) {
      lower.pop();
    }
    lower.push(p);
  }

  const upper: Point[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) {
      upper.pop();
    }
    upper.push(p);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function pointSegmentDistance(p: Point, a: Point, b: Point): number {
  const [px, py] = p, [ax, ay] = a, [bx, by] = b;
  const dx = bx - ax, dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.hypot(px - ax, py - ay);
  // perpendicular distance from p to the infinite line through a,b
  return Math.abs(dy * px - dx * py + bx * ay - by * ax) / Math.sqrt(lenSq);
}

/** Open-chain recursive Douglas-Peucker; keeps both endpoints. */
function simplifyOpen(pts: Point[], epsilon: number): Point[] {
  if (pts.length < 3) return pts;
  const a = pts[0], b = pts[pts.length - 1];
  let maxDist = -1;
  let maxIdx = -1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointSegmentDistance(pts[i], a, b);
    if (d > maxDist) { maxDist = d; maxIdx = i; }
  }
  if (maxDist <= epsilon) return [a, b];
  const left = simplifyOpen(pts.slice(0, maxIdx + 1), epsilon);
  const right = simplifyOpen(pts.slice(maxIdx), epsilon);
  return [...left.slice(0, -1), ...right];
}

/** Closed-contour approxPolyDP: split at the two farthest-apart points (the
 * polygon's approximate diameter), simplify each arc, and rejoin. Mirrors
 * cv2.approxPolyDP(..., closed=true) closely enough for our convex-hull inputs. */
export function approxPolyDPClosed(points: Point[], epsilon: number): Point[] {
  const n = points.length;
  if (n <= 3) return points;

  let bestI = 0, bestJ = 1, bestDist = -1;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const d = Math.hypot(points[i][0] - points[j][0], points[i][1] - points[j][1]);
      if (d > bestDist) { bestDist = d; bestI = i; bestJ = j; }
    }
  }

  const arcA: Point[] = [];
  for (let k = bestI; k !== bestJ; k = (k + 1) % n) arcA.push(points[k]);
  arcA.push(points[bestJ]);

  const arcB: Point[] = [];
  for (let k = bestJ; k !== bestI; k = (k + 1) % n) arcB.push(points[k]);
  arcB.push(points[bestI]);

  const simplifiedA = simplifyOpen(arcA, epsilon);
  const simplifiedB = simplifyOpen(arcB, epsilon);

  return [...simplifiedA.slice(0, -1), ...simplifiedB.slice(0, -1)];
}

/** Intersection-over-union of two convex quads via Sutherland-Hodgman clipping. Test/debug helper. */
export function quadIoU(a: Point[], b: Point[]): number {
  const areaA = polygonArea(a);
  const areaB = polygonArea(b);
  if (areaA <= 0 || areaB <= 0) return 0;
  const inter = clipPolygon(a, b);
  if (inter.length < 3) return 0;
  const interArea = polygonArea(inter);
  const union = areaA + areaB - interArea;
  return union <= 0 ? 0 : interArea / union;
}

function clipPolygon(subject: Point[], clip: Point[]): Point[] {
  let output = ensureCCW(subject);
  const clipCCW = ensureCCW(clip);
  for (let i = 0; i < clipCCW.length; i++) {
    const clipA = clipCCW[i];
    const clipB = clipCCW[(i + 1) % clipCCW.length];
    if (output.length === 0) break;
    const input = output;
    output = [];
    for (let j = 0; j < input.length; j++) {
      const current = input[j];
      const prev = input[(j + input.length - 1) % input.length];
      const currentInside = isInside(current, clipA, clipB);
      const prevInside = isInside(prev, clipA, clipB);
      if (currentInside) {
        if (!prevInside) output.push(lineIntersect(prev, current, clipA, clipB));
        output.push(current);
      } else if (prevInside) {
        output.push(lineIntersect(prev, current, clipA, clipB));
      }
    }
  }
  return output;
}

function ensureCCW(pts: Point[]): Point[] {
  return polygonSignedArea(pts) < 0 ? [...pts].reverse() : pts;
}

function polygonSignedArea(pts: Point[]): number {
  let sum = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

function isInside(p: Point, a: Point, b: Point): boolean {
  return (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]) >= 0;
}

function lineIntersect(p1: Point, p2: Point, p3: Point, p4: Point): Point {
  const [x1, y1] = p1, [x2, y2] = p2, [x3, y3] = p3, [x4, y4] = p4;
  const denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom;
  return [x1 + t * (x2 - x1), y1 + t * (y2 - y1)];
}

/** 3x3 homography (row-major, h[8]=1) mapping each `from[i]` to `to[i]`, via
 * direct linear transform: solves the 8x8 system for the 4-point case. */
export function computeHomography(from: Point[], to: Point[]): number[] {
  const A: number[][] = [];
  const b: number[] = [];
  for (let i = 0; i < 4; i++) {
    const [x, y] = from[i];
    const [X, Y] = to[i];
    A.push([x, y, 1, 0, 0, 0, -x * X, -y * X]);
    b.push(X);
    A.push([0, 0, 0, x, y, 1, -x * Y, -y * Y]);
    b.push(Y);
  }
  const h = solveLinearSystem(A, b);
  return [...h, 1];
}

function solveLinearSystem(A: number[][], b: number[]): number[] {
  const n = A.length;
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > Math.abs(M[pivot][col])) pivot = row;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const pivotVal = M[col][col];
    for (let row = 0; row < n; row++) {
      if (row === col) continue;
      const factor = M[row][col] / pivotVal;
      for (let k = col; k <= n; k++) M[row][k] -= factor * M[col][k];
    }
  }

  return M.map((row, i) => row[n] / row[i]);
}

export function applyHomography(h: number[], x: number, y: number): Point {
  const w = h[6] * x + h[7] * y + h[8];
  return [(h[0] * x + h[1] * y + h[2]) / w, (h[3] * x + h[4] * y + h[5]) / w];
}

function sampleBilinear(img: ImageBuffer, x: number, y: number): [number, number, number, number] {
  const x0 = Math.floor(x), y0 = Math.floor(y);
  const x1 = x0 + 1, y1 = y0 + 1;
  const fx = x - x0, fy = y - y0;

  const clampX = (v: number) => Math.min(Math.max(v, 0), img.width - 1);
  const clampY = (v: number) => Math.min(Math.max(v, 0), img.height - 1);

  const at = (xx: number, yy: number, c: number) =>
    img.data[(clampY(yy) * img.width + clampX(xx)) * 4 + c];

  const out: [number, number, number, number] = [0, 0, 0, 0];
  for (let c = 0; c < 4; c++) {
    const top = at(x0, y0, c) * (1 - fx) + at(x1, y0, c) * fx;
    const bottom = at(x0, y1, c) * (1 - fx) + at(x1, y1, c) * fx;
    out[c] = top * (1 - fy) + bottom * fy;
  }
  return out;
}

/** Warp the quad (ordered TL,TR,BR,BL) region of `src` onto an outW x outH canvas. */
export function warpCard(src: ImageBuffer, quad: Point[], outW: number, outH: number): ImageBuffer {
  const ordered = orderQuad(quad);
  const destRect: Point[] = [[0, 0], [outW - 1, 0], [outW - 1, outH - 1], [0, outH - 1]];
  // homography FROM the dest rectangle TO the source quad, so we can iterate
  // output pixels and pull samples (inverse warp, avoids matrix inversion).
  const h = computeHomography(destRect, ordered);

  const out = makeImageBuffer(outW, outH);
  for (let oy = 0; oy < outH; oy++) {
    for (let ox = 0; ox < outW; ox++) {
      const [sx, sy] = applyHomography(h, ox, oy);
      const [r, g, bch, a] = sampleBilinear(src, sx, sy);
      const idx = (oy * outW + ox) * 4;
      out.data[idx] = r;
      out.data[idx + 1] = g;
      out.data[idx + 2] = bch;
      out.data[idx + 3] = a;
    }
  }
  return out;
}
