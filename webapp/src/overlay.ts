/** Draws detection + classification results onto a canvas positioned over
 * the video/image element. Confidence -> frame colour, same idea as the
 * Python prototype's overlay.py: green is clear, orange is a close call,
 * red is unclassified. Cards that are part of a found Set get a gold ring
 * on top so a real Set visibly stands out from the crowd.
 */
import * as C from "./lib/config";
import { confidenceOf, labelOf, type CardAttributes } from "./lib/classify";
import type { CardCandidate } from "./lib/detection";

const GREEN = "#2e9e3f";
const ORANGE = "#e08a1e";
const RED = "#d1362f";
const GOLD = "#e8b923";

function confidenceColor(attrs: CardAttributes): string {
  const label = labelOf(attrs);
  if (attrs.count === 0 || label.includes("?")) return RED;
  return confidenceOf(attrs) >= C.OVERLAY_MARGIN_GREEN ? GREEN : ORANGE;
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
  const inAnySet = new Set(sets.flat());

  candidates.forEach((cand, i) => {
    const attrs = attrsList[i];
    const label = labelOf(attrs);
    const color = confidenceColor(attrs);
    const highlighted = inAnySet.has(i);
    const quad = cand.quad;

    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (let k = 1; k < quad.length; k++) ctx.lineTo(quad[k][0], quad[k][1]);
    ctx.closePath();
    ctx.lineWidth = highlighted ? 7 : 3;
    ctx.strokeStyle = highlighted ? GOLD : color;
    ctx.stroke();

    const [lx, ly] = quad[0];
    ctx.font = "bold 22px system-ui, sans-serif";
    ctx.lineWidth = 4;
    ctx.strokeStyle = "rgba(0,0,0,0.75)";
    ctx.strokeText(label, lx, Math.max(20, ly - 8));
    ctx.fillStyle = color;
    ctx.fillText(label, lx, Math.max(20, ly - 8));
  });
}
