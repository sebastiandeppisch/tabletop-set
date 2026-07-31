/** Draws detection + classification results onto a canvas positioned over
 * the video/image element.
 *
 * Quad outline colour is a confidence readout, same idea as the Python
 * prototype's overlay.py: green is clear, orange is a close call, red is
 * unclassified. Instead of a 4-letter code (too cryptic to read at a
 * glance), each card gets its actual shape/count/color/fill re-drawn
 * semi-transparently right on top of it. Found Sets get a connecting line
 * across their three cards, one colour per set, so which cards belong
 * together is visible without reading anything.
 */
import * as C from "./lib/config";
import { confidenceOf, labelOf, type CardAttributes } from "./lib/classify";
import type { CardCandidate } from "./lib/detection";
import { drawCardReconstruction, quadAffine } from "./reconstruct";
import type { Point } from "./lib/geometry";

const GREEN = "#2e9e3f";
const ORANGE = "#e08a1e";
const RED = "#d1362f";

const SET_LINE_COLORS = ["#2979ff", "#e91e8c", "#00bfa5", "#8e24aa", "#fb8c00", "#43a047", "#fdd835", "#6d4c41"];

function confidenceColor(attrs: CardAttributes): string {
  const label = labelOf(attrs);
  if (attrs.count === 0 || label.includes("?")) return RED;
  return confidenceOf(attrs) >= C.OVERLAY_MARGIN_GREEN ? GREEN : ORANGE;
}

function quadCenter(quad: Point[]): Point {
  const sx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
  const sy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
  return [sx, sy];
}

function drawSetLines(
  ctx: CanvasRenderingContext2D,
  candidates: CardCandidate[],
  sets: [number, number, number][],
  lineScale: number,
): void {
  sets.forEach(([i, j, k], setIdx) => {
    const color = SET_LINE_COLORS[setIdx % SET_LINE_COLORS.length];
    const centers = [i, j, k].map((idx) => quadCenter(candidates[idx].quad));

    ctx.save();
    ctx.globalAlpha = 0.85;
    ctx.strokeStyle = color;
    ctx.lineWidth = 4 * lineScale;
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(centers[0][0], centers[0][1]);
    ctx.lineTo(centers[1][0], centers[1][1]);
    ctx.lineTo(centers[2][0], centers[2][1]);
    ctx.closePath();
    ctx.stroke();

    ctx.fillStyle = color;
    for (const [cx, cy] of centers) {
      ctx.beginPath();
      ctx.arc(cx, cy, 6 * lineScale, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  });
}

export function drawOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  candidates: CardCandidate[],
  attrsList: CardAttributes[],
  sets: [number, number, number][],
): void {
  ctx.clearRect(0, 0, width, height);
  // Stroke widths below are tuned for a ~640px-wide frame. A phone photo can
  // be 5000px+ wide; without scaling, a "3px" outline is thin enough,
  // relative to the image, that browsers shrinking it back down for display
  // alias it into a dashed-looking line.
  const lineScale = Math.max(1, width / 640);

  drawSetLines(ctx, candidates, sets, lineScale);

  candidates.forEach((cand, i) => {
    const attrs = attrsList[i];
    const color = confidenceColor(attrs);
    const quad = cand.quad;

    ctx.save();
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (let k = 1; k < quad.length; k++) ctx.lineTo(quad[k][0], quad[k][1]);
    ctx.closePath();
    ctx.lineWidth = 3 * lineScale;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();

    ctx.save();
    ctx.globalAlpha = 0.6;
    ctx.setTransform(...quadAffine(quad));
    drawCardReconstruction(ctx, attrs);
    ctx.restore();
  });
}
