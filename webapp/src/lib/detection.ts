/** Card detection: downscale -> adaptive threshold -> connected components ->
 * quad filter -> warp. From-scratch TS port of set_solver/detection.py --
 * no OpenCV.js. Contour tracing is sidestepped entirely: a connected
 * component's own boundary pixels are convex-hulled directly, since the hull
 * doesn't care what order its input points arrive in.
 */
import * as C from "./config";
import { connectedComponents } from "./cc";
import {
  approxPolyDPClosed,
  convexHull,
  orderQuad,
  orderQuadLongEdgeFirst,
  polygonArea,
  warpCard,
  type ImageBuffer,
  type Point,
} from "./geometry";

export interface CardCandidate {
  /** Ordered TL,TR,BR,BL, in ORIGINAL image coordinates. */
  quad: Point[];
  area: number;
  warped: ImageBuffer;
}

export interface DetectionDebug {
  small?: ImageBuffer;
  gray?: Float64Array;
  grayW?: number;
  grayH?: number;
  mask?: Uint8Array;
  allCandidates: Point[][];
  rejectedBorder: Point[][];
  rejectedAspect: Point[][];
  rejectedMedian: Point[][];
}

export function newDetectionDebug(): DetectionDebug {
  return { allCandidates: [], rejectedBorder: [], rejectedAspect: [], rejectedMedian: [] };
}

function toGrayscale(img: ImageBuffer): Float64Array {
  const out = new Float64Array(img.width * img.height);
  const { data } = img;
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    out[i] = 0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2];
  }
  return out;
}

function resizeBilinear(img: ImageBuffer, outW: number, outH: number): ImageBuffer {
  const out: ImageBuffer = { width: outW, height: outH, data: new Uint8ClampedArray(outW * outH * 4) };
  const scaleX = img.width / outW;
  const scaleY = img.height / outH;
  for (let oy = 0; oy < outH; oy++) {
    const sy = (oy + 0.5) * scaleY - 0.5;
    const y0 = Math.max(0, Math.min(img.height - 1, Math.floor(sy)));
    const y1 = Math.min(img.height - 1, y0 + 1);
    const fy = sy - y0;
    for (let ox = 0; ox < outW; ox++) {
      const sx = (ox + 0.5) * scaleX - 0.5;
      const x0 = Math.max(0, Math.min(img.width - 1, Math.floor(sx)));
      const x1 = Math.min(img.width - 1, x0 + 1);
      const fx = sx - x0;
      const outIdx = (oy * outW + ox) * 4;
      for (let c = 0; c < 4; c++) {
        const v00 = img.data[(y0 * img.width + x0) * 4 + c];
        const v10 = img.data[(y0 * img.width + x1) * 4 + c];
        const v01 = img.data[(y1 * img.width + x0) * 4 + c];
        const v11 = img.data[(y1 * img.width + x1) * 4 + c];
        const top = v00 * (1 - fx) + v10 * fx;
        const bottom = v01 * (1 - fx) + v11 * fx;
        out.data[outIdx + c] = top * (1 - fy) + bottom * fy;
      }
    }
  }
  return out;
}

export function downscale(img: ImageBuffer, longEdge = C.DOWNSCALE_LONG_EDGE): { small: ImageBuffer; scale: number } {
  const scale = longEdge / Math.max(img.width, img.height);
  if (scale >= 1) return { small: img, scale: 1 };
  const outW = Math.round(img.width * scale);
  const outH = Math.round(img.height * scale);
  return { small: resizeBilinear(img, outW, outH), scale };
}

/** Local mean via a summed-area table (integral image). */
function boxMean(gray: Float64Array, w: number, h: number, window: number): Float64Array {
  const integral = new Float64Array((w + 1) * (h + 1));
  for (let y = 0; y < h; y++) {
    let rowSum = 0;
    for (let x = 0; x < w; x++) {
      rowSum += gray[y * w + x];
      integral[(y + 1) * (w + 1) + (x + 1)] = integral[y * (w + 1) + (x + 1)] + rowSum;
    }
  }
  const r = Math.floor(window / 2);
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    const y0 = Math.max(0, y - r);
    const y1 = Math.min(h, y + r + 1);
    for (let x = 0; x < w; x++) {
      const x0 = Math.max(0, x - r);
      const x1 = Math.min(w, x + r + 1);
      const total =
        integral[y1 * (w + 1) + x1] - integral[y0 * (w + 1) + x1] - integral[y1 * (w + 1) + x0] + integral[y0 * (w + 1) + x0];
      out[y * w + x] = total / ((y1 - y0) * (x1 - x0));
    }
  }
  return out;
}

export function adaptiveCardMask(gray: Float64Array, w: number, h: number): Uint8Array {
  const longEdge = Math.max(w, h);
  let window = Math.max(3, Math.floor(longEdge * C.ADAPTIVE_THRESH_WINDOW_FRACTION));
  if (window % 2 === 0) window += 1;
  const localMean = boxMean(gray, w, h, window);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) {
    mask[i] = gray[i] > localMean[i] + C.ADAPTIVE_THRESH_C ? 255 : 0;
  }
  return mask;
}

function approxQuad(boundary: Point[]): Point[] | null {
  const hull = convexHull(boundary);
  if (hull.length < 3) return null;
  const perimeter = hullPerimeter(hull);
  if (perimeter <= 0) return null;
  for (const factor of C.APPROX_POLY_EPSILON_FACTORS) {
    const approx = approxPolyDPClosed(hull, factor * perimeter);
    if (approx.length === 4) return approx;
  }
  return null;
}

function hullPerimeter(hull: Point[]): number {
  let perim = 0;
  for (let i = 0; i < hull.length; i++) {
    const [x1, y1] = hull[i];
    const [x2, y2] = hull[(i + 1) % hull.length];
    perim += Math.hypot(x2 - x1, y2 - y1);
  }
  return perim;
}

function touchesBorder(quad: Point[], w: number, h: number, margin = C.BORDER_MARGIN_PX): boolean {
  return quad.some(([x, y]) => x <= margin || y <= margin || x >= w - 1 - margin || y >= h - 1 - margin);
}

function aspectOk(quad: Point[]): boolean {
  const [tl, tr, br, bl] = orderQuad(quad);
  const width = (Math.hypot(tr[0] - tl[0], tr[1] - tl[1]) + Math.hypot(br[0] - bl[0], br[1] - bl[1])) / 2;
  const height = (Math.hypot(bl[0] - tl[0], bl[1] - tl[1]) + Math.hypot(br[0] - tr[0], br[1] - tr[1])) / 2;
  if (width <= 0 || height <= 0) return false;
  const ratio = Math.max(width, height) / Math.min(width, height);
  const lo = C.CARD_ASPECT_RATIO * (1 - C.CARD_ASPECT_TOLERANCE);
  const hi = C.CARD_ASPECT_RATIO * (1 + C.CARD_ASPECT_TOLERANCE);
  return ratio >= lo && ratio <= hi;
}

function findCardCandidates(
  mask: Uint8Array,
  w: number,
  h: number,
  debug?: DetectionDebug,
): { quad: Point[]; area: number }[] {
  const { components } = connectedComponents(mask, w, h);
  const minArea = C.MIN_COMPONENT_AREA_FRACTION * (w * h);

  const preMedian: { quad: Point[]; area: number }[] = [];
  for (const comp of components) {
    if (comp.pixelCount < minArea) continue;
    const quad = approxQuad(comp.boundary);
    if (quad === null) continue;
    if (debug) debug.allCandidates.push(quad);

    if (touchesBorder(quad, w, h)) {
      if (debug) debug.rejectedBorder.push(quad);
      continue;
    }
    if (!aspectOk(quad)) {
      if (debug) debug.rejectedAspect.push(quad);
      continue;
    }
    preMedian.push({ quad: orderQuadLongEdgeFirst(quad), area: polygonArea(quad) });
  }

  if (preMedian.length === 0) return [];

  const areas = preMedian.map((c) => c.area).sort((a, b) => a - b);
  const medianArea = areas[Math.floor(areas.length / 2)];
  const lo = medianArea * (1 - C.CARD_AREA_MEDIAN_TOLERANCE);
  const hi = medianArea * (1 + C.CARD_AREA_MEDIAN_TOLERANCE);

  const result: { quad: Point[]; area: number }[] = [];
  for (const cand of preMedian) {
    if (cand.area >= lo && cand.area <= hi) {
      result.push(cand);
    } else if (debug) {
      debug.rejectedMedian.push(cand.quad);
    }
  }
  return result;
}

export function detectCards(image: ImageBuffer, debug?: DetectionDebug): CardCandidate[] {
  const { small, scale } = downscale(image);
  const gray = toGrayscale(small);
  const mask = adaptiveCardMask(gray, small.width, small.height);

  if (debug) {
    debug.small = small;
    debug.gray = gray;
    debug.grayW = small.width;
    debug.grayH = small.height;
    debug.mask = mask;
  }

  const candidates = findCardCandidates(mask, small.width, small.height, debug);

  return candidates.map(({ quad, area }) => {
    const fullResQuad: Point[] = quad.map(([x, y]) => [x / scale, y / scale]);
    const warped = warpCard(image, fullResQuad, C.CANONICAL_CARD_W, C.CANONICAL_CARD_H);
    return { quad: fullResQuad, area, warped };
  });
}
