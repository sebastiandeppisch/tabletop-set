/** Attribute classification on a canonical warped card: count, shape, color, fill.
 *
 * From-scratch TS port of set_solver/classify.py. Everything shares one
 * per-pixel signal -- "distance from white" -- so segmentation, shape
 * metrics and fill scanlines all agree on what counts as "ink" vs
 * background. Colour is the only place hue is needed, and even that is
 * computed after a per-card white balance.
 */
import * as C from "./config";
import { connectedComponents } from "./cc";
import { convexHull, polygonArea, type ImageBuffer, type Point } from "./geometry";
import { laplacianVariance, toGrayscaleSmall } from "./sharpness";

export interface SymbolMetrics {
  bbox: [number, number, number, number]; // x, y, w, h
  area: number;
  shape: string;
  shapeMargin: number;
  fill: string;
  fillMargin: number;
  hue: number;
}

export interface CardAttributes {
  count: number;
  color: string | null;
  shape: string | null;
  fill: string | null;
  colorMargin: number;
  shapeMargin: number;
  fillMargin: number;
  symbols: SymbolMetrics[];
}

export function confidenceOf(attrs: CardAttributes): number {
  const margins = [attrs.colorMargin, attrs.shapeMargin, attrs.fillMargin];
  return Math.max(0, Math.min(1, Math.min(...margins)));
}

export function labelOf(attrs: CardAttributes): string {
  if (![1, 2, 3].includes(attrs.count) || attrs.color === null || attrs.shape === null || attrs.fill === null) {
    return "????";
  }
  return `${attrs.count}${attrs.color}${attrs.shape}${attrs.fill}`;
}

export function inkSignal(img: ImageBuffer): Float64Array {
  return distanceFrom(img, [255, 255, 255]);
}

export function distanceFrom(img: ImageBuffer, color: [number, number, number]): Float64Array {
  const n = img.width * img.height;
  const out = new Float64Array(n);
  const [cr, cg, cb] = color;
  for (let i = 0; i < n; i++) {
    const dr = cr - img.data[i * 4];
    const dg = cg - img.data[i * 4 + 1];
    const db = cb - img.data[i * 4 + 2];
    out[i] = Math.sqrt(dr * dr + dg * dg + db * db);
  }
  return out;
}

function inkMaskFrom(signal: Float64Array, threshold = C.INK_SIGNAL_THRESHOLD): Uint8Array {
  const out = new Uint8Array(signal.length);
  for (let i = 0; i < signal.length; i++) out[i] = signal[i] > threshold ? 255 : 0;
  return out;
}

function andMasks(a: Uint8Array, b: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] !== 0 && b[i] !== 0 ? 255 : 0;
  return out;
}

function invertMask(a: Uint8Array): Uint8Array {
  const out = new Uint8Array(a.length);
  for (let i = 0; i < a.length; i++) out[i] = a[i] === 0 ? 255 : 0;
  return out;
}

function dilate(mask: Uint8Array, w: number, h: number, radius: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let found = false;
      for (let dy = -radius; dy <= radius && !found; dy++) {
        const ny = y + dy;
        if (ny < 0 || ny >= h) continue;
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx;
          if (nx < 0 || nx >= w) continue;
          if (mask[ny * w + nx] !== 0) { found = true; break; }
        }
      }
      out[y * w + x] = found ? 255 : 0;
    }
  }
  return out;
}

function interiorMargins(w: number, h: number): [number, number] {
  return [Math.max(1, Math.floor(w * C.CARD_BORDER_MARGIN_FRACTION)), Math.max(1, Math.floor(h * C.CARD_BORDER_MARGIN_FRACTION))];
}

function interiorMaskArray(w: number, h: number, mx: number, my: number): Uint8Array {
  const out = new Uint8Array(w * h);
  for (let y = my; y < h - my; y++) {
    for (let x = mx; x < w - mx; x++) out[y * w + x] = 255;
  }
  return out;
}

function touchesInteriorEdge(
  bbox: [number, number, number, number],
  w: number,
  h: number,
  mx: number,
  my: number,
  tolerance = 2,
): boolean {
  const [x, y, bw, bh] = bbox;
  return x <= mx + tolerance || y <= my + tolerance || x + bw >= w - mx - tolerance || y + bh >= h - my - tolerance;
}

function medianColor(img: ImageBuffer, mask: Uint8Array): [number, number, number] {
  const rs: number[] = [], gs: number[] = [], bs: number[] = [];
  for (let i = 0; i < mask.length; i++) {
    if (mask[i] === 0) continue;
    rs.push(img.data[i * 4]);
    gs.push(img.data[i * 4 + 1]);
    bs.push(img.data[i * 4 + 2]);
  }
  const median = (arr: number[]) => {
    arr.sort((a, b) => a - b);
    return arr.length ? arr[Math.floor(arr.length / 2)] : 255;
  };
  return [median(rs), median(gs), median(bs)];
}

function whiteBalance(img: ImageBuffer, backgroundMask: Uint8Array): ImageBuffer {
  let sumR = 0, sumG = 0, sumB = 0, count = 0;
  for (let i = 0; i < backgroundMask.length; i++) {
    if (backgroundMask[i] === 0) continue;
    sumR += img.data[i * 4];
    sumG += img.data[i * 4 + 1];
    sumB += img.data[i * 4 + 2];
    count++;
  }
  const meanR = count ? sumR / count : 255;
  const meanG = count ? sumG / count : 255;
  const meanB = count ? sumB / count : 255;
  const gainR = 255 / Math.max(meanR, 1);
  const gainG = 255 / Math.max(meanG, 1);
  const gainB = 255 / Math.max(meanB, 1);

  const out: ImageBuffer = { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data.length) };
  for (let i = 0; i < img.width * img.height; i++) {
    out.data[i * 4] = img.data[i * 4] * gainR;
    out.data[i * 4 + 1] = img.data[i * 4 + 1] * gainG;
    out.data[i * 4 + 2] = img.data[i * 4 + 2] * gainB;
    out.data[i * 4 + 3] = img.data[i * 4 + 3];
  }
  return out;
}

/** Returns [hue 0..180, saturation 0..255, value 0..255] -- the OpenCV 8-bit
 * HSV convention the calibrated HUE_* constants were sampled against. */
function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const rf = r / 255, gf = g / 255, bf = b / 255;
  const max = Math.max(rf, gf, bf), min = Math.min(rf, gf, bf);
  const delta = max - min;
  let h = 0;
  if (delta !== 0) {
    if (max === rf) h = 60 * (((gf - bf) / delta) % 6);
    else if (max === gf) h = 60 * ((bf - rf) / delta + 2);
    else h = 60 * ((rf - gf) / delta + 4);
  }
  if (h < 0) h += 360;
  const s = max === 0 ? 0 : (delta / max) * 255;
  const v = max * 255;
  return [h / 2, s, v];
}

function circularMeanFromSums(sx: number, sy: number): number {
  const meanAngleDeg = (Math.atan2(sy, sx) * 180) / Math.PI;
  const meanDeg = ((meanAngleDeg % 360) + 360) % 360;
  return (meanDeg / 2) % 180;
}

export function circularMeanHue(hues: number[]): number {
  let sx = 0, sy = 0;
  for (const hue of hues) {
    const angle = (hue * 2 * Math.PI) / 180;
    sx += Math.cos(angle);
    sy += Math.sin(angle);
  }
  return circularMeanFromSums(sx, sy);
}

function hueDistance(h1: number, h2: number): number {
  const d = Math.abs(h1 - h2) % 180;
  return Math.min(d, 180 - d);
}

export function classifyShape(pixelCount: number, hullArea: number, bboxW: number, bboxH: number): [string, number] {
  const solidity = hullArea > 0 ? pixelCount / hullArea : 0;
  const rectArea = bboxW * bboxH;
  const extent = rectArea > 0 ? pixelCount / rectArea : 0;

  if (solidity < C.SHAPE_SOLIDITY_WAVE_THRESHOLD) {
    const margin = (C.SHAPE_SOLIDITY_WAVE_THRESHOLD - solidity) / C.SHAPE_SOLIDITY_WAVE_THRESHOLD;
    return ["W", margin];
  }

  const dDist = Math.abs(extent - C.SHAPE_EXTENT_DIAMOND);
  const eDist = Math.abs(extent - C.SHAPE_EXTENT_ELLIPSE);
  const span = C.SHAPE_EXTENT_ELLIPSE - C.SHAPE_EXTENT_DIAMOND;
  return dDist < eDist ? ["D", (eDist - dDist) / span] : ["E", (dDist - eDist) / span];
}

interface ScanResult {
  crossings: number[];
  interiorMeans: number[];
}

/** Sample scanlines across a symbol's bbox, perpendicular to `transpose`.
 *
 * Hatching direction isn't standardized -- one deck's "striped" fill draws
 * vertical lines (crossed by a horizontal scanline), another's draws
 * horizontal lines (crossed by a vertical one). The caller tries both and
 * keeps whichever finds more crossings.
 */
function scanLines(
  signal: Float64Array,
  bufW: number,
  x: number,
  y: number,
  w: number,
  h: number,
  transpose: boolean,
): ScanResult {
  const length = transpose ? w : h;
  const lineLen = transpose ? h : w;
  const [loFrac, hiFrac] = C.FILL_SCANLINE_BAND;
  const n = C.FILL_SCANLINE_COUNT;

  const crossings: number[] = [];
  const interiorMeans: number[] = [];

  for (let i = 0; i < n; i++) {
    const posF = length * loFrac + (length * hiFrac - length * loFrac) * (n === 1 ? 0 : i / (n - 1));
    const pos = Math.min(length - 1, Math.max(0, Math.floor(posF)));
    if (lineLen < 3) continue;

    const line = new Float64Array(lineLen);
    for (let t = 0; t < lineLen; t++) {
      const sx = transpose ? x + pos : x + t;
      const sy = transpose ? y + t : y + pos;
      line[t] = signal[sy * bufW + sx];
    }

    let firstIdx = -1, lastIdx = -1, transitions = 0;
    let prevInk = false;
    for (let t = 0; t < lineLen; t++) {
      const ink = line[t] > C.INK_SIGNAL_THRESHOLD;
      if (ink) { if (firstIdx < 0) firstIdx = t; lastIdx = t; }
      if (t > 0 && ink !== prevInk) transitions++;
      prevInk = ink;
    }
    if (firstIdx < 0) continue;
    crossings.push(transitions);

    const spanLen = lastIdx - firstIdx + 1;
    const inset = Math.max(1, Math.floor(spanLen * C.FILL_INTERIOR_MARGIN));
    let segStart = firstIdx + inset, segEnd = lastIdx - inset + 1;
    if (segEnd <= segStart) { segStart = firstIdx; segEnd = lastIdx + 1; }
    let sum = 0, count = 0;
    for (let t = segStart; t < segEnd; t++) { sum += line[t]; count++; }
    interiorMeans.push(count > 0 ? sum / count : line[firstIdx]);
  }

  return { crossings, interiorMeans };
}

export function classifyFill(
  signal: Float64Array,
  bufW: number,
  bbox: [number, number, number, number],
  area: number,
  cardArea: number,
): [string, number] {
  const [x, y, w, h] = bbox;
  if (w < C.SYMBOL_MIN_DIM_FOR_FILL_PX || h < C.SYMBOL_MIN_DIM_FOR_FILL_PX || area < C.SYMBOL_MIN_AREA_FOR_FILL_FRACTION * cardArea) {
    return ["unknown", 0];
  }

  const rowScan = scanLines(signal, bufW, x, y, w, h, false);
  const colScan = scanLines(signal, bufW, x, y, w, h, true);
  if (rowScan.crossings.length === 0 && colScan.crossings.length === 0) return ["unknown", 0];

  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rowAvg = rowScan.crossings.length ? mean(rowScan.crossings) : 0;
  const colAvg = colScan.crossings.length ? mean(colScan.crossings) : 0;
  const [avgCrossings, interiorMeans] = rowAvg >= colAvg ? [rowAvg, rowScan.interiorMeans] : [colAvg, colScan.interiorMeans];
  const avgInterior = interiorMeans.length ? mean(interiorMeans) : 255;

  if (avgCrossings >= C.FILL_STRIPE_CROSSING_MIN) {
    return ["S", (avgCrossings - C.FILL_STRIPE_CROSSING_MIN) / C.FILL_STRIPE_CROSSING_MIN];
  }
  const dist = avgInterior - C.FILL_INTERIOR_INK_THRESHOLD;
  const margin = Math.abs(dist) / C.FILL_INTERIOR_INK_THRESHOLD;
  return dist >= 0 ? ["F", margin] : ["E", margin];
}

/** Area enclosed by a component's OUTER boundary, including any holes fully
 * surrounded by ink (an empty/striped symbol's un-inked interior). Mirrors
 * cv2.contourArea() on an external contour: a ring's enclosed area is the
 * whole disk it traces, not just its ink pixels. Needed because shape/fill
 * classification must not depend on which fill type produced the ink --
 * only raw ink-pixel count does that, and pixel count is what's used for
 * the initial "is this even a symbol" filter instead. */
function filledArea(pixels: number[], bbox: [number, number, number, number], bufW: number): number {
  const [x, y, bw, bh] = bbox;
  const pad = 1;
  const gw = bw + 2 * pad, gh = bh + 2 * pad;
  const isInk = new Uint8Array(gw * gh);
  for (const idx of pixels) {
    const px = idx % bufW, py = (idx / bufW) | 0;
    const lx = px - x + pad, ly = py - y + pad;
    isInk[ly * gw + lx] = 1;
  }

  const outside = new Uint8Array(gw * gh);
  const queue = new Int32Array(gw * gh);
  let head = 0, tail = 0;
  const tryPush = (gx: number, gy: number) => {
    if (gx < 0 || gy < 0 || gx >= gw || gy >= gh) return;
    const idx = gy * gw + gx;
    if (isInk[idx] || outside[idx]) return;
    outside[idx] = 1;
    queue[tail++] = idx;
  };
  for (let gx = 0; gx < gw; gx++) { tryPush(gx, 0); tryPush(gx, gh - 1); }
  for (let gy = 0; gy < gh; gy++) { tryPush(0, gy); tryPush(gw - 1, gy); }
  while (head < tail) {
    const idx = queue[head++];
    const gx = idx % gw, gy = (idx / gw) | 0;
    tryPush(gx - 1, gy); tryPush(gx + 1, gy); tryPush(gx, gy - 1); tryPush(gx, gy + 1);
  }

  let enclosedHoles = 0;
  for (let i = 0; i < gw * gh; i++) if (!isInk[i] && !outside[i]) enclosedHoles++;
  return pixels.length + enclosedHoles;
}

function mostCommon(values: string[]): string {
  const counts = new Map<string, number>();
  for (const v of values) counts.set(v, (counts.get(v) ?? 0) + 1);
  let best = values[0], bestCount = -1;
  for (const [v, c] of counts) if (c > bestCount) { best = v; bestCount = c; }
  return best;
}

export function classifyCard(cardImg: ImageBuffer): CardAttributes {
  const w = cardImg.width, h = cardImg.height;
  const [mx, my] = interiorMargins(w, h);
  const interior = interiorMaskArray(w, h, mx, my);

  // Real photos rarely expose a card's white background as literal (255,255,255) --
  // lighting and exposure shift it. The background is always the majority of the
  // card's area (1-3 symbols never cover most of it), so its per-channel median is
  // a robust first guess, refined below into a real white balance.
  const medianBg = medianColor(cardImg, interior);
  const roughSignal = distanceFrom(cardImg, medianBg);
  const roughMask = andMasks(inkMaskFrom(roughSignal), interior);
  const dilated = dilate(roughMask, w, h, 2);
  const backgroundMask = andMasks(invertMask(dilated), interior);

  const balanced = whiteBalance(cardImg, backgroundMask);
  const signal = inkSignal(balanced);
  const mask = andMasks(inkMaskFrom(signal), interior);

  const cardArea = w * h;
  const { components } = connectedComponents(mask, w, h);
  const minSymbolArea = C.SYMBOL_MIN_AREA_FRACTION * cardArea;

  const empty = (): CardAttributes => ({
    count: 0, color: null, shape: null, fill: null, colorMargin: 0, shapeMargin: 0, fillMargin: 0, symbols: [],
  });

  const symbols: SymbolMetrics[] = [];
  for (const comp of components) {
    if (comp.pixelCount < minSymbolArea) continue;
    const { x, y, w: bw, h: bh } = comp.bbox;
    if (touchesInteriorEdge([x, y, bw, bh], w, h, mx, my)) continue;

    // A quad that's slightly off can warp in a sliver of table (shadow, wood
    // grain) alongside the real card. Unlike printed ink, that sliver is
    // desaturated -- reject it here so it doesn't inflate the symbol count.
    let sumSat = 0;
    let sx = 0, sy = 0;
    for (const idx of comp.pixels) {
      const r = balanced.data[idx * 4], g = balanced.data[idx * 4 + 1], b = balanced.data[idx * 4 + 2];
      const [hue, sat] = rgbToHsv(r, g, b);
      sumSat += sat;
      const angle = (hue * 2 * Math.PI) / 180;
      sx += Math.cos(angle);
      sy += Math.sin(angle);
    }
    const meanSat = sumSat / comp.pixels.length;
    if (meanSat < C.SYMBOL_MIN_SATURATION) continue;
    const hue = circularMeanFromSums(sx, sy);

    const hull = convexHull(comp.boundary as Point[]);
    const hullArea = polygonArea(hull);
    const area = filledArea(comp.pixels, [x, y, bw, bh], w);
    const [shape, shapeMargin] = classifyShape(area, hullArea, bw, bh);
    const [fill, fillMargin] = classifyFill(signal, w, [x, y, bw, bh], area, cardArea);

    symbols.push({ bbox: [x, y, bw, bh], area, shape, shapeMargin, fill, fillMargin, hue });
  }

  if (symbols.length === 0) return empty();

  const count = symbols.length;

  // All symbols on a real card always share one shape/fill. If ours disagree
  // (usually glare or lighting thinning some symbols but not others), that
  // disagreement is itself the strongest evidence of trouble on this card --
  // stronger than any single symbol's own margin -- so it overrides toward
  // zero confidence rather than just picking the majority and moving on.
  const shapeValues = symbols.map((s) => s.shape);
  const shapeMode = mostCommon(shapeValues);
  const shapeAgrees = new Set(shapeValues).size === 1;
  const shapeMargin = shapeAgrees ? Math.min(...symbols.filter((s) => s.shape === shapeMode).map((s) => s.shapeMargin)) : 0;

  const fillValues = symbols.map((s) => s.fill).filter((f) => f !== "unknown");
  let fillMode: string, fillMargin: number;
  if (fillValues.length > 0) {
    fillMode = mostCommon(fillValues);
    const fillAgrees = new Set(fillValues).size === 1;
    fillMargin = fillAgrees ? Math.min(...symbols.filter((s) => s.fill === fillMode).map((s) => s.fillMargin)) : 0;
  } else {
    fillMode = "unknown";
    fillMargin = 0;
  }

  const meanHue = circularMeanHue(symbols.map((s) => s.hue));
  const distances: Record<string, number> = {
    R: hueDistance(meanHue, C.HUE_RED),
    G: hueDistance(meanHue, C.HUE_GREEN),
    P: hueDistance(meanHue, C.HUE_PURPLE),
  };
  const ranked = Object.entries(distances).sort((a, b) => a[1] - b[1]);
  const color = ranked[0][0];
  const colorMargin = (ranked[1][1] - ranked[0][1]) / 90;

  // A blurred card (motion blur mid-frame on a live camera, most often) can
  // still produce a confident-looking wrong shape/fill margin -- the ink
  // signal is still there, just smeared. Damping shape/fill margin by how
  // sharp the card actually was turns that into a visible orange/red
  // instead of a confident wrong answer. Colour survives blur well enough
  // that it's left alone.
  const { gray, w: gw, h: gh } = toGrayscaleSmall(cardImg, C.CANONICAL_CARD_W);
  const sharpness = laplacianVariance(gray, gw, gh);
  const sharpnessFactor = Math.min(1, sharpness / C.CARD_SHARPNESS_MIN_VARIANCE);

  return {
    count,
    color,
    shape: shapeMode,
    fill: fillMode !== "unknown" ? fillMode : null,
    colorMargin,
    shapeMargin: shapeMargin * sharpnessFactor,
    fillMargin: fillMargin * sharpnessFactor,
    symbols,
  };
}
