import { describe, expect, it } from "vitest";
import {
  approxPolyDPClosed,
  applyHomography,
  computeHomography,
  convexHull,
  makeImageBuffer,
  orderQuad,
  orderQuadLongEdgeFirst,
  polygonArea,
  quadIoU,
  warpCard,
  type Point,
} from "./geometry";

describe("orderQuad", () => {
  it("sorts shuffled corners into TL,TR,BR,BL", () => {
    const tl: Point = [0, 0], tr: Point = [10, 0], br: Point = [10, 20], bl: Point = [0, 20];
    const shuffled: Point[] = [br, tl, bl, tr];
    expect(orderQuad(shuffled)).toEqual([tl, tr, br, bl]);
  });
});

describe("orderQuadLongEdgeFirst", () => {
  it("leaves a landscape quad (already long-edge-first) unchanged", () => {
    const tl: Point = [0, 0], tr: Point = [100, 0], br: Point = [100, 60], bl: Point = [0, 60];
    expect(orderQuadLongEdgeFirst([br, tl, bl, tr])).toEqual([tl, tr, br, bl]);
  });

  it("rotates a portrait-oriented quad so TL->TR is the long edge", () => {
    // a card lying with its long edge running top-to-bottom in the image
    const topRight: Point = [0, 0], bottomRight: Point = [60, 0], bottomLeft: Point = [60, 100], topLeft: Point = [0, 100];
    const ordered = orderQuadLongEdgeFirst([topRight, bottomRight, bottomLeft, topLeft]);
    const width = Math.hypot(ordered[1][0] - ordered[0][0], ordered[1][1] - ordered[0][1]);
    const height = Math.hypot(ordered[3][0] - ordered[0][0], ordered[3][1] - ordered[0][1]);
    expect(width).toBeGreaterThan(height);
  });
});

describe("polygonArea", () => {
  it("computes a unit square's area", () => {
    expect(polygonArea([[0, 0], [10, 0], [10, 10], [0, 10]])).toBe(100);
  });
});

describe("quadIoU", () => {
  it("is 1 for identical quads", () => {
    const q: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(quadIoU(q, q)).toBeCloseTo(1);
  });

  it("is 0 for disjoint quads", () => {
    const a: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: Point[] = [[100, 100], [110, 100], [110, 110], [100, 110]];
    expect(quadIoU(a, b)).toBe(0);
  });

  it("computes a half-overlap IoU", () => {
    const a: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const b: Point[] = [[5, 0], [15, 0], [15, 10], [5, 10]];
    expect(quadIoU(a, b)).toBeCloseTo(50 / 150, 5);
  });
});

describe("convexHull", () => {
  it("drops interior points", () => {
    const pts: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10], [5, 5]];
    const hull = convexHull(pts);
    expect(hull.length).toBe(4);
    expect(hull).not.toContainEqual([5, 5]);
  });

  it("keeps all points of a triangle", () => {
    const pts: Point[] = [[0, 0], [10, 0], [5, 10]];
    expect(convexHull(pts).length).toBe(3);
  });
});

describe("approxPolyDPClosed", () => {
  it("simplifies a near-rectangle (many edge points) down to 4 corners", () => {
    const pts: Point[] = [];
    // Dense points along each edge of a 100x60 rectangle, like a traced contour.
    for (let x = 0; x <= 100; x += 5) pts.push([x, 0]);
    for (let y = 0; y <= 60; y += 5) pts.push([100, y]);
    for (let x = 100; x >= 0; x -= 5) pts.push([x, 60]);
    for (let y = 60; y >= 0; y -= 5) pts.push([0, y]);
    const approx = approxPolyDPClosed(pts, 2);
    expect(approx.length).toBe(4);
  });
});

describe("computeHomography + applyHomography", () => {
  it("maps a unit square to itself as identity", () => {
    const square: Point[] = [[0, 0], [1, 0], [1, 1], [0, 1]];
    const h = computeHomography(square, square);
    for (const [x, y] of square) {
      const [px, py] = applyHomography(h, x, y);
      expect(px).toBeCloseTo(x, 5);
      expect(py).toBeCloseTo(y, 5);
    }
  });

  it("maps a quad to a scaled rectangle correctly", () => {
    const src: Point[] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    const dst: Point[] = [[0, 0], [100, 0], [100, 100], [0, 100]];
    const h = computeHomography(src, dst);
    const [px, py] = applyHomography(h, 5, 5);
    expect(px).toBeCloseTo(50, 5);
    expect(py).toBeCloseTo(50, 5);
  });
});

describe("warpCard", () => {
  it("produces a canvas of the requested size", () => {
    const src = makeImageBuffer(100, 100);
    const quad: Point[] = [[10, 10], [90, 10], [90, 90], [10, 90]];
    const warped = warpCard(src, quad, 200, 130);
    expect(warped.width).toBe(200);
    expect(warped.height).toBe(130);
  });

  it("samples a solid-color source faithfully", () => {
    const src = makeImageBuffer(100, 100);
    for (let i = 0; i < src.data.length; i += 4) {
      src.data[i] = 200; src.data[i + 1] = 50; src.data[i + 2] = 50; src.data[i + 3] = 255;
    }
    const quad: Point[] = [[10, 10], [90, 10], [90, 90], [10, 90]];
    const warped = warpCard(src, quad, 50, 50);
    const idx = (25 * 50 + 25) * 4;
    expect(warped.data[idx]).toBeCloseTo(200, 0);
    expect(warped.data[idx + 1]).toBeCloseTo(50, 0);
    expect(warped.data[idx + 2]).toBeCloseTo(50, 0);
  });

  it("un-rotates a portrait-oriented quad into the landscape canonical box", () => {
    // Left half red, right half blue: colour varies along the source's X axis.
    const src = makeImageBuffer(100, 100);
    for (let y = 0; y < 100; y++) {
      for (let x = 0; x < 100; x++) {
        const idx = (y * 100 + x) * 4;
        const left = x < 50;
        src.data[idx] = left ? 255 : 0;
        src.data[idx + 2] = left ? 0 : 255;
        src.data[idx + 3] = 255;
      }
    }
    // A card region that's physically portrait (60 wide, 80 tall): its long
    // edge runs along source Y, its short edge (where the colour change is)
    // along source X.
    const quad: Point[] = [[20, 10], [80, 10], [80, 90], [20, 90]];
    const warped = warpCard(src, quad, 200, 130);

    const at = (x: number, y: number) => {
      const idx = (y * 200 + x) * 4;
      return [warped.data[idx], warped.data[idx + 2]];
    };

    // Long edge (source Y) now runs along canonical width -> colour should
    // be effectively constant left-to-right at a fixed height.
    const [leftR] = at(20, 65);
    const [rightR] = at(180, 65);
    expect(Math.abs(leftR - rightR)).toBeLessThan(40);

    // Short edge (source X, where red/blue actually changes) now runs along
    // canonical height -> top and bottom should land on opposite colours.
    const [topR] = at(100, 15);
    const [bottomR] = at(100, 115);
    expect(Math.abs(topR - bottomR)).toBeGreaterThan(150);
  });
});
