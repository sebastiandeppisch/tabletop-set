import { describe, expect, it } from "vitest";
import { allLabels, labelToString, parseLabel } from "./labels";

describe("allLabels", () => {
  it("is a full 81-card deck with unique labels", () => {
    const labels = allLabels();
    expect(labels.length).toBe(81);
    expect(new Set(labels.map(labelToString)).size).toBe(81);
  });
});

describe("parseLabel", () => {
  it("roundtrips every deck label", () => {
    for (const label of allLabels()) {
      expect(parseLabel(labelToString(label))).toEqual(label);
    }
  });

  it("rejects malformed input", () => {
    expect(() => parseLabel("1RDX")).toThrow();
    expect(() => parseLabel("1RD")).toThrow();
  });
});
