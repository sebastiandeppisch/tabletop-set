import { describe, expect, it } from "vitest";
import { detectCards } from "./detection";
import { quadIoU } from "./geometry";
import { allLabels } from "./labels";
import { composeScene } from "./testScene";

const MIN_IOU = 0.85;

function sample<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

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

function matchCandidates(candidates: { quad: [number, number][] }[], placed: { quad: [number, number][] }[]) {
  const remaining = placed.map((_, i) => i);
  return candidates.map((cand) => {
    let bestIou = 0, bestIdx = -1;
    for (const i of remaining) {
      const iou = quadIoU(cand.quad, placed[i].quad);
      if (iou > bestIou) { bestIou = iou; bestIdx = i; }
    }
    if (bestIdx >= 0) remaining.splice(remaining.indexOf(bestIdx), 1);
    return { bestIdx, bestIou };
  });
}

describe.each([1, 2, 3, 4, 5])("detectCards on a synthetic scene (seed %i)", (seed) => {
  const deck = allLabels();
  const rng = mulberry32(seed * 1000);
  const sampled = sample(deck, 15, rng);
  const { scene, placed } = composeScene(sampled, { seed });

  it("finds every placed card", () => {
    const candidates = detectCards(scene);
    expect(candidates.length).toBe(placed.length);
  });

  it("matches detected quads to ground truth within IoU tolerance", () => {
    const candidates = detectCards(scene);
    const matches = matchCandidates(candidates, placed);
    const low = matches.filter((m) => m.bestIou < MIN_IOU);
    expect(low, `quads below IoU ${MIN_IOU}: ${JSON.stringify(low)}`).toEqual([]);
  });
});

describe("detectCards on an empty table", () => {
  it("finds nothing", () => {
    const { scene, placed } = composeScene([], { seed: 99 });
    expect(placed).toEqual([]);
    expect(detectCards(scene)).toEqual([]);
  });
});
