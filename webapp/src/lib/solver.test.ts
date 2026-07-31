import { describe, expect, it } from "vitest";
import { findSets, isSet } from "./solver";

describe("isSet", () => {
  it("accepts all-same attributes", () => {
    expect(isSet("1RDF", "1RDF", "1RDF")).toBe(true);
  });

  it("accepts all-different attributes", () => {
    expect(isSet("1RDF", "2GEE", "3PWS")).toBe(true);
  });

  it("rejects two-same-one-different", () => {
    expect(isSet("1RDF", "1RDF", "2RDF")).toBe(false);
    expect(isSet("1RDF", "2RDF", "2GDF")).toBe(false);
  });
});

describe("findSets", () => {
  it("finds exactly the valid triples", () => {
    const labels = ["1RDF", "2RDF", "3RDF", "1GEF"];
    const result = findSets(labels);
    expect(result).toContainEqual([0, 1, 2]);
    expect(result.length).toBe(1);
  });
});
