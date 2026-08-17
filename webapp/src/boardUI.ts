/** Interactive HTML layer over the board canvas: an "X" chip to confirm a
 * card that's been missing for a while is actually gone, and small picker
 * chips for whichever attribute a slot's vote history couldn't agree on
 * (fill/shape are the common case, but any field can end up uncertain).
 * Canvas can't take clicks cleanly, so these are real DOM buttons
 * positioned on top of it each render.
 */
import type { Field, ResolvedSlot } from "./lib/board";
import { quadCenter } from "./boardOverlay";

export interface BoardUICallbacks {
  onPick(slotId: number, field: Field, value: string | number): void;
  onConfirmRemoval(slotId: number): void;
}

const FIELD_CHOICES: Record<Field, { value: string | number; label: string }[]> = {
  count: [1, 2, 3].map((n) => ({ value: n, label: String(n) })),
  color: [
    { value: "R", label: "Rot" },
    { value: "G", label: "Grün" },
    { value: "P", label: "Lila" },
  ],
  shape: [
    { value: "D", label: "Raute" },
    { value: "E", label: "Oval" },
    { value: "W", label: "Welle" },
  ],
  fill: [
    { value: "F", label: "Voll" },
    { value: "S", label: "Schraffiert" },
    { value: "E", label: "Leer" },
  ],
};

const FIELD_TITLE: Record<Field, string> = {
  count: "Anzahl?",
  color: "Farbe?",
  shape: "Form?",
  fill: "Füllung?",
};

/** Maps a canvas-internal pixel (the coordinate space quads are drawn in)
 * to a CSS position within the canvas's own box, accounting for the
 * object-fit: contain letterboxing between the canvas's backing
 * resolution and its displayed size. */
function canvasToStageXY(canvas: HTMLCanvasElement, x: number, y: number): [number, number] {
  const stageW = canvas.clientWidth;
  const stageH = canvas.clientHeight;
  if (stageW === 0 || stageH === 0 || canvas.width === 0 || canvas.height === 0) return [0, 0];
  const scale = Math.min(stageW / canvas.width, stageH / canvas.height);
  const offsetX = (stageW - canvas.width * scale) / 2;
  const offsetY = (stageH - canvas.height * scale) / 2;
  return [offsetX + x * scale, offsetY + y * scale];
}

function positionChip(el: HTMLElement, canvas: HTMLCanvasElement, quad: ResolvedSlot["quad"]): void {
  const [cx, cy] = quadCenter(quad);
  const [left, top] = canvasToStageXY(canvas, cx, cy);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;
}

export function syncBoardChips(
  container: HTMLElement,
  canvas: HTMLCanvasElement,
  slots: ResolvedSlot[],
  callbacks: BoardUICallbacks,
): void {
  container.innerHTML = "";

  for (const slot of slots) {
    if (slot.status === "pendingRemoval") {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "chip chip-remove";
      btn.textContent = "✕";
      btn.title = "Karte entfernen bestätigen";
      btn.addEventListener("click", () => callbacks.onConfirmRemoval(slot.id));
      positionChip(btn, canvas, slot.quad);
      container.appendChild(btn);
      continue;
    }

    if (slot.uncertain.length === 0) continue;

    const panel = document.createElement("div");
    panel.className = "chip chip-picker";
    positionChip(panel, canvas, slot.quad);

    for (const field of slot.uncertain) {
      const row = document.createElement("div");
      row.className = "chip-picker-row";
      const title = document.createElement("span");
      title.className = "chip-picker-title";
      title.textContent = FIELD_TITLE[field];
      row.appendChild(title);
      for (const choice of FIELD_CHOICES[field]) {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.textContent = choice.label;
        btn.addEventListener("click", () => callbacks.onPick(slot.id, field, choice.value));
        row.appendChild(btn);
      }
      panel.appendChild(row);
    }
    container.appendChild(panel);
  }
}
