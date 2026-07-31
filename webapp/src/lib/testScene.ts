/** Synthetic multi-card scene composer for detection tests only -- mirrors
 * set_solver/synth.py's compose_scene. Places rendered cards with a random
 * rotation/jitter and mild noise onto a background, and hands back the exact
 * placed quad per card as ground truth (no detection involved in producing
 * it, so it's trustworthy as a reference for IoU checks).
 */
import { applyHomography, computeHomography, makeImageBuffer, type ImageBuffer, type Point } from "./geometry";
import type { Label } from "./labels";
import { labelToString } from "./labels";
import { renderCard } from "./testSynth";

export interface PlacedCard {
  label: Label;
  quad: Point[];
}

// Small deterministic PRNG (mulberry32) so tests are reproducible without a
// library dependency.
function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pasteWarped(dest: ImageBuffer, src: ImageBuffer, quad: Point[]): void {
  const srcRect: Point[] = [[0, 0], [src.width - 1, 0], [src.width - 1, src.height - 1], [0, src.height - 1]];
  const h = computeHomography(quad, srcRect);

  const xs = quad.map((p) => p[0]);
  const ys = quad.map((p) => p[1]);
  const minX = Math.max(0, Math.floor(Math.min(...xs)));
  const maxX = Math.min(dest.width - 1, Math.ceil(Math.max(...xs)));
  const minY = Math.max(0, Math.floor(Math.min(...ys)));
  const maxY = Math.min(dest.height - 1, Math.ceil(Math.max(...ys)));

  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const [sx, sy] = applyHomography(h, x, y);
      if (sx < 0 || sy < 0 || sx > src.width - 1 || sy > src.height - 1) continue;
      const sxi = Math.min(src.width - 1, Math.round(sx));
      const syi = Math.min(src.height - 1, Math.round(sy));
      const srcIdx = (syi * src.width + sxi) * 4;
      const destIdx = (y * dest.width + x) * 4;
      dest.data[destIdx] = src.data[srcIdx];
      dest.data[destIdx + 1] = src.data[srcIdx + 1];
      dest.data[destIdx + 2] = src.data[srcIdx + 2];
      dest.data[destIdx + 3] = 255;
    }
  }
}

function jitteredQuad(
  cx: number,
  cy: number,
  w: number,
  h: number,
  rng: () => number,
  maxJitterFrac: number,
  maxRotationDeg: number,
): Point[] {
  const angle = ((rng() * 2 - 1) * maxRotationDeg * Math.PI) / 180;
  const cos = Math.cos(angle), sin = Math.sin(angle);
  const base: Point[] = [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
  const jitterMag = maxJitterFrac * Math.min(w, h);
  return base.map(([x, y]) => {
    const rx = x * cos - y * sin + cx + (rng() * 2 - 1) * jitterMag;
    const ry = x * sin + y * cos + cy + (rng() * 2 - 1) * jitterMag;
    return [rx, ry] as Point;
  });
}

export interface ComposeSceneOptions {
  cardW?: number;
  cardH?: number;
  seed?: number;
  noiseSigma?: number;
  maxJitterFrac?: number;
  maxRotationDeg?: number;
  targetAspect?: number;
}

export function composeScene(labels: Label[], opts: ComposeSceneOptions = {}): { scene: ImageBuffer; placed: PlacedCard[] } {
  const {
    cardW = 190,
    cardH = 124,
    seed = 0,
    noiseSigma = 5,
    maxJitterFrac = 0.03,
    maxRotationDeg = 12,
    targetAspect = 900 / 700,
  } = opts;

  const rng = mulberry32(seed + 1);
  const background = 70 + Math.floor(rng() * 40);

  const diag = Math.hypot(cardW, cardH);
  const cell = diag * 1.35;
  const n = labels.length;
  const cols = Math.max(1, Math.ceil(Math.sqrt(n * targetAspect)));
  const rows = Math.ceil(n / cols);
  const margin = cell * 0.4;
  const sceneW = Math.round(cols * cell + 2 * margin);
  const sceneH = Math.round(rows * cell + 2 * margin);

  const scene = makeImageBuffer(sceneW, sceneH);
  scene.data.fill(background);
  for (let i = 3; i < scene.data.length; i += 4) scene.data[i] = 255;

  const slack = Math.max(0, (cell - diag) * 0.5 * 0.6);
  const placed: PlacedCard[] = [];

  for (let idx = 0; idx < n; idx++) {
    const label = labels[idx];
    const r = Math.floor(idx / cols), c = idx % cols;
    const cx = margin + cell * (c + 0.5) + (rng() * 2 - 1) * slack;
    const cy = margin + cell * (r + 0.5) + (rng() * 2 - 1) * slack;
    const quad = jitteredQuad(cx, cy, cardW, cardH, rng, maxJitterFrac, maxRotationDeg);

    const cardImg = renderCard(label, cardW * 2, cardH * 2);
    pasteWarped(scene, cardImg, quad);
    placed.push({ label, quad });
  }

  for (let i = 0; i < scene.data.length; i += 4) {
    const noise = (rng() * 2 - 1) * noiseSigma;
    scene.data[i] = scene.data[i] + noise;
    scene.data[i + 1] = scene.data[i + 1] + noise;
    scene.data[i + 2] = scene.data[i + 2] + noise;
  }

  return { scene, placed };
}

export function placedLabelStrings(placed: PlacedCard[]): string[] {
  return placed.map((p) => labelToString(p.label));
}
