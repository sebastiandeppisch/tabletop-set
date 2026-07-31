import { describe, expect, it } from "vitest";
import { classifyCard, labelOf } from "./classify";
import { detectCards } from "./detection";
import { quadIoU } from "./geometry";
import { allLabels, labelToString, parseLabel } from "./labels";
import { findSets } from "./solver";
import { composeScene } from "./testScene";

const MIN_LABEL_ACCURACY = 0.9;

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

function sample<T>(arr: T[], n: number, rng: () => number): T[] {
  const copy = [...arr];
  const out: T[] = [];
  for (let i = 0; i < n && copy.length > 0; i++) {
    const idx = Math.floor(rng() * copy.length);
    out.push(copy.splice(idx, 1)[0]);
  }
  return out;
}

describe("end-to-end: detect + classify + solve on a synthetic scene", () => {
  it("labels match ground truth for most cards despite perspective + noise", () => {
    const deck = allLabels();
    const rng = mulberry32(7000);
    const sampled = sample(deck, 15, rng);
    const { scene, placed } = composeScene(sampled, { seed: 7 });

    const candidates = detectCards(scene);
    expect(candidates.length).toBe(placed.length);

    const remaining = placed.map((_, i) => i);
    let correct = 0;
    for (const cand of candidates) {
      let bestIou = 0, bestIdx = -1;
      for (const i of remaining) {
        const iou = quadIoU(cand.quad, placed[i].quad);
        if (iou > bestIou) { bestIou = iou; bestIdx = i; }
      }
      remaining.splice(remaining.indexOf(bestIdx), 1);
      const attrs = classifyCard(cand.warped);
      if (labelOf(attrs) === labelToString(placed[bestIdx].label)) correct++;
    }

    const accuracy = correct / placed.length;
    expect(accuracy, `end-to-end accuracy ${accuracy.toFixed(2)} below ${MIN_LABEL_ACCURACY}`).toBeGreaterThanOrEqual(
      MIN_LABEL_ACCURACY,
    );
  });

  it("finds a Set planted among the detected cards", () => {
    const planted = [parseLabel("1RDF"), parseLabel("2GDF"), parseLabel("3PDF"), parseLabel("1GES")];
    const { scene } = composeScene(planted, { seed: 3 });
    const candidates = detectCards(scene);
    const labels = candidates.map((c) => labelOf(classifyCard(c.warped)));

    const sets = findSets(labels);
    const asSets = sets.map(([i, j, k]) => [labels[i], labels[j], labels[k]].sort());
    expect(asSets).toContainEqual(["1RDF", "2GDF", "3PDF"].sort());
  });
});
