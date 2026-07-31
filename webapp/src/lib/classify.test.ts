import { describe, expect, it } from "vitest";
import { classifyCard, labelOf } from "./classify";
import { allLabels, labelToString } from "./labels";
import { renderCard } from "./testSynth";

describe("classifyCard against the synthetic deck", () => {
  it("matches the label for every one of the 81 synthetic cards", () => {
    const errors: string[] = [];
    for (const label of allLabels()) {
      const img = renderCard(label);
      const attrs = classifyCard(img);
      const predicted = labelOf(attrs);
      const expected = labelToString(label);
      if (predicted !== expected) errors.push(`${expected} -> ${predicted}`);
    }
    expect(errors, `label errors (${errors.length}/81): ${errors.join(", ")}`).toEqual([]);
  });
});
