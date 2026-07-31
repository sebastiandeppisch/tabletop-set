/** Draws a card's classified attributes as an actual small graphic (diamond /
 * ellipse / wave, in the right count, color and fill) instead of a 4-letter
 * code -- meant to be drawn semi-transparently right over the real card so a
 * glance confirms what the pipeline saw, no decoding required.
 */
import * as C from "./lib/config";
import type { CardAttributes } from "./lib/classify";
import type { Point } from "./lib/geometry";

const SYMBOL_COLOR: Record<string, string> = {
  R: "#d6294a",
  G: "#1f9660",
  P: "#6c3fb7",
};

function symbolCenters(count: number, w: number, h: number): Point[] {
  const marginX = w * 0.12;
  const usableW = w - 2 * marginX;
  const slotW = usableW / 3;
  const start = (3 - count) / 2;
  const centers: Point[] = [];
  for (let i = 0; i < count; i++) {
    const slotIndex = start + i;
    centers.push([marginX + slotW * (slotIndex + 0.5), h / 2]);
  }
  return centers;
}

function waveRibbonPoints(cx: number, cy: number, halfW: number, halfH: number): Point[] {
  const n = 24;
  const amp = halfH * 0.45;
  const thick = halfH * 0.45;
  const top: Point[] = [];
  const bottom: Point[] = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = cx - halfW + 2 * halfW * t;
    const center = cy + amp * Math.sin(2 * Math.PI * t);
    top.push([x, center - thick]);
    bottom.push([x, center + thick]);
  }
  bottom.reverse();
  return [...top, ...bottom];
}

function tracePath(ctx: CanvasRenderingContext2D, shape: string, cx: number, cy: number, halfW: number, halfH: number): void {
  ctx.beginPath();
  if (shape === "D") {
    ctx.moveTo(cx, cy - halfH);
    ctx.lineTo(cx + halfW, cy);
    ctx.lineTo(cx, cy + halfH);
    ctx.lineTo(cx - halfW, cy);
    ctx.closePath();
  } else if (shape === "E") {
    ctx.ellipse(cx, cy, halfW, halfH, 0, 0, Math.PI * 2);
  } else {
    const pts = waveRibbonPoints(cx, cy, halfW, halfH);
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();
  }
}

function drawSymbol(
  ctx: CanvasRenderingContext2D,
  shape: string,
  fill: string,
  color: string,
  cx: number,
  cy: number,
  halfW: number,
  halfH: number,
): void {
  tracePath(ctx, shape, cx, cy, halfW, halfH);
  if (fill === "F") {
    ctx.fillStyle = color;
    ctx.fill();
  } else if (fill === "S") {
    ctx.fillStyle = color;
    ctx.fill();
    ctx.save();
    tracePath(ctx, shape, cx, cy, halfW, halfH);
    ctx.clip();
    ctx.strokeStyle = "rgba(255,255,255,0.8)";
    ctx.lineWidth = Math.max(2, halfH * 0.13);
    const top = cy - halfH * 1.3, bottom = cy + halfH * 1.3;
    for (let y = top; y <= bottom; y += ctx.lineWidth * 2.2) {
      ctx.beginPath();
      ctx.moveTo(cx - halfW * 1.4, y);
      ctx.lineTo(cx + halfW * 1.4, y);
      ctx.stroke();
    }
    ctx.restore();
  }
  // outline on every fill type, incl. empty
  tracePath(ctx, shape, cx, cy, halfW, halfH);
  ctx.strokeStyle = color;
  ctx.lineWidth = Math.max(2, halfH * 0.09);
  ctx.stroke();
}

/** Draws into a CANONICAL_CARD_W x CANONICAL_CARD_H box at the origin --
 * the caller sets up a transform mapping that box onto the card's quad. */
export function drawCardReconstruction(ctx: CanvasRenderingContext2D, attrs: CardAttributes): void {
  if (![1, 2, 3].includes(attrs.count) || !attrs.color || !attrs.shape || !attrs.fill) return;
  const w = C.CANONICAL_CARD_W, h = C.CANONICAL_CARD_H;
  const halfW = (w / 3) * 0.3, halfH = h * 0.32;
  const color = SYMBOL_COLOR[attrs.color];
  for (const [cx, cy] of symbolCenters(attrs.count, w, h)) {
    drawSymbol(ctx, attrs.shape, attrs.fill, color, cx, cy, halfW, halfH);
  }
}

/** Affine transform (canvas setTransform args) mapping the canonical
 * CANONICAL_CARD_W x CANONICAL_CARD_H box onto quad[TL,TR,BR,BL]. Only an
 * approximation of the true perspective (canvas has no native perspective
 * transform), built from three of the four corners -- plenty close for a
 * quick-glance overlay. */
export function quadAffine(quad: Point[]): [number, number, number, number, number, number] {
  const [tl, tr, , bl] = quad;
  const a = (tr[0] - tl[0]) / C.CANONICAL_CARD_W;
  const b = (tr[1] - tl[1]) / C.CANONICAL_CARD_W;
  const c = (bl[0] - tl[0]) / C.CANONICAL_CARD_H;
  const d = (bl[1] - tl[1]) / C.CANONICAL_CARD_H;
  return [a, b, c, d, tl[0], tl[1]];
}
