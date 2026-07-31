/** Synthetic card renderer for tests only -- not part of the shipped app.
 *
 * Analytic per-pixel shape predicates instead of polygon rasterization: far
 * less code than a generic scanline-fill + polygon-offset pipeline, and all
 * we need here is to exercise classify.ts's code paths with recognizable
 * diamond/ellipse/wave + striped/full/empty combinations.
 */
import { makeImageBuffer, type ImageBuffer } from "./geometry";
import type { Label } from "./labels";

export const RGB_BY_COLOR: Record<string, [number, number, number]> = {
  // Matches config.HUE_RED/GREEN/PURPLE, calibrated from real deck photos.
  R: [190, 41, 81],
  G: [44, 150, 118],
  P: [32, 32, 150],
};

const STRIPE_SPACING_FRACTION = 0.023; // of card height, so stripe count scales with render size like the stroke width
const STRIPE_WIDTH_FRACTION = STRIPE_SPACING_FRACTION * (2 / 6);

interface Box {
  cx: number;
  cy: number;
  halfW: number;
  halfH: number;
}

function symbolBoxes(count: number, w: number, h: number): Box[] {
  const marginX = w * 0.1;
  const marginY = h * 0.32;
  const usableW = w - 2 * marginX;
  const slotW = usableW / 3;
  const boxW = slotW * 0.72;
  const boxH = h - 2 * marginY;
  const start = (3 - count) / 2;
  const boxes: Box[] = [];
  for (let i = 0; i < count; i++) {
    const slotIndex = start + i;
    const cx = marginX + slotW * (slotIndex + 0.5);
    boxes.push({ cx, cy: h / 2, halfW: boxW / 2, halfH: boxH / 2 });
  }
  return boxes;
}

function insideDiamond(x: number, y: number, b: Box, shrink: number): boolean {
  const hw = b.halfW - shrink, hh = b.halfH - shrink;
  if (hw <= 0 || hh <= 0) return false;
  return Math.abs(x - b.cx) / hw + Math.abs(y - b.cy) / hh <= 1;
}

function insideEllipse(x: number, y: number, b: Box, shrink: number): boolean {
  const hw = b.halfW - shrink, hh = b.halfH - shrink;
  if (hw <= 0 || hh <= 0) return false;
  const dx = (x - b.cx) / hw, dy = (y - b.cy) / hh;
  return dx * dx + dy * dy <= 1;
}

function waveCenterY(x: number, b: Box): number {
  const t = (x - (b.cx - b.halfW)) / (2 * b.halfW);
  return b.cy + b.halfH * 0.45 * Math.sin(2 * Math.PI * t);
}

function insideWave(x: number, y: number, b: Box, shrink: number): boolean {
  if (x < b.cx - b.halfW || x > b.cx + b.halfW) return false;
  const halfThick = b.halfH * 0.5 - shrink;
  if (halfThick <= 0) return false;
  return Math.abs(y - waveCenterY(x, b)) <= halfThick;
}

function insideShape(shape: string, x: number, y: number, b: Box, shrink: number): boolean {
  if (shape === "D") return insideDiamond(x, y, b, shrink);
  if (shape === "E") return insideEllipse(x, y, b, shrink);
  return insideWave(x, y, b, shrink);
}

function onRing(shape: string, x: number, y: number, b: Box, strokePx: number): boolean {
  const inner = insideShape(shape, x, y, b, strokePx);
  if (!inner) return true;
  // the wave ribbon's ends are open (cut by the bbox, not rounded), so an
  // outline-only ring would leak its hollow interior out through them --
  // cap the ends so the interior stays fully enclosed, same as a real
  // printed outline symbol.
  return shape === "W" && (x - (b.cx - b.halfW) < strokePx || b.cx + b.halfW - x < strokePx);
}

function symbolInk(
  shape: string,
  fill: string,
  x: number,
  y: number,
  b: Box,
  strokePx: number,
  stripeSpacingPx: number,
  stripeWidthPx: number,
): boolean {
  const outer = insideShape(shape, x, y, b, 0);
  if (!outer) return false;
  if (fill === "F") return true;
  if (fill === "E") return onRing(shape, x, y, b, strokePx);

  // striped: outline ring (like empty) plus horizontal interior hatching --
  // real cards print both, and the ring is what keeps the separate hatch
  // bands one connected symbol instead of several disconnected specks.
  if (onRing(shape, x, y, b, strokePx)) return true;
  const bandPos = ((y % stripeSpacingPx) + stripeSpacingPx) % stripeSpacingPx;
  return bandPos < stripeWidthPx;
}

// Rendered larger than the 200x130 canonical size: classifyCard is
// resolution-agnostic (fraction-based thresholds), and the extra pixels give
// the fill scanlines enough stripe cycles to cross reliably, same as the
// Python prototype's synthetic renderer (which also renders at 2x canonical).
export function renderCard(label: Label, w = 400, h = 260): ImageBuffer {
  const img = makeImageBuffer(w, h);
  img.data.fill(255);
  const boxes = symbolBoxes(Number(label.count), w, h);
  const [r, g, b] = RGB_BY_COLOR[label.color];
  // Stroke/stripe geometry scales with render size -- a fixed pixel width
  // would grow proportionally thinner (and eventually vanish below the
  // symbol-area filter) the larger the card is rendered.
  const strokePx = Math.max(2, h * 0.03);
  const stripeSpacingPx = Math.max(3, h * STRIPE_SPACING_FRACTION);
  const stripeWidthPx = Math.max(1, h * STRIPE_WIDTH_FRACTION);

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      for (const box of boxes) {
        if (symbolInk(label.shape, label.fill, x, y, box, strokePx, stripeSpacingPx, stripeWidthPx)) {
          const idx = (y * w + x) * 4;
          img.data[idx] = r;
          img.data[idx + 1] = g;
          img.data[idx + 2] = b;
          img.data[idx + 3] = 255;
          break;
        }
      }
    }
  }
  return img;
}
