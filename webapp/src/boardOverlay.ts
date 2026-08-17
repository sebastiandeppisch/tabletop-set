/** Canvas rendering for the "Tisch" (board) tab. Same visual language as
 * overlay.ts -- confidence-colored quad outline + a drawn reconstruction
 * instead of a text label, Set matches connected by a colored line -- but
 * driven by ResolvedSlot (which can have null fields while a slot is still
 * "uncertain", not merely low-confidence) instead of a single frame's
 * CardAttributes.
 */
import type { ResolvedSlot } from "./lib/board";
import type { Point } from "./lib/geometry";
import { drawCardReconstruction, quadAffine } from "./reconstruct";

const GREEN = "#2e9e3f";
const ORANGE = "#e08a1e";
const GRAY = "#8b8594";

const SET_LINE_COLORS = ["#2979ff", "#e91e8c", "#00bfa5", "#8e24aa", "#fb8c00", "#43a047", "#fdd835", "#6d4c41"];

function slotColor(slot: ResolvedSlot): string {
  if (slot.status === "pendingRemoval") return GRAY;
  return slot.uncertain.length === 0 ? GREEN : ORANGE;
}

export function quadCenter(quad: Point[]): Point {
  const sx = quad.reduce((s, p) => s + p[0], 0) / quad.length;
  const sy = quad.reduce((s, p) => s + p[1], 0) / quad.length;
  return [sx, sy];
}

function drawSetLines(
  ctx: CanvasRenderingContext2D,
  slotsById: Map<number, ResolvedSlot>,
  setTriples: [number, number, number][],
  lineScale: number,
): void {
  setTriples.forEach((triple, setIdx) => {
    const slots = triple.map((id) => slotsById.get(id)).filter((s): s is ResolvedSlot => s !== undefined);
    if (slots.length !== 3) return;
    const color = SET_LINE_COLORS[setIdx % SET_LINE_COLORS.length];
    const centers = slots.map((s) => quadCenter(s.quad));

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

export function drawBoardOverlay(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  slots: ResolvedSlot[],
  setTriples: [number, number, number][],
): void {
  ctx.clearRect(0, 0, width, height);
  const lineScale = Math.max(1, width / 640);
  const slotsById = new Map(slots.map((s) => [s.id, s]));

  drawSetLines(ctx, slotsById, setTriples, lineScale);

  for (const slot of slots) {
    const color = slotColor(slot);
    const quad = slot.quad;

    ctx.save();
    if (slot.status === "pendingRemoval") ctx.setLineDash([6 * lineScale, 5 * lineScale]);
    ctx.globalAlpha = slot.status === "pendingRemoval" ? 0.55 : 1;
    ctx.beginPath();
    ctx.moveTo(quad[0][0], quad[0][1]);
    for (let k = 1; k < quad.length; k++) ctx.lineTo(quad[k][0], quad[k][1]);
    ctx.closePath();
    ctx.lineWidth = 3 * lineScale;
    ctx.strokeStyle = color;
    ctx.stroke();
    ctx.restore();

    if (slot.status === "active" && slot.uncertain.length === 0) {
      ctx.save();
      ctx.globalAlpha = 0.6;
      ctx.setTransform(...quadAffine(quad));
      drawCardReconstruction(ctx, slot);
      ctx.restore();
    }
  }
}
