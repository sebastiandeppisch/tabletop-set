import { describe, expect, it } from "vitest";
import { laplacianVariance } from "./sharpness";

function checkerboard(w: number, h: number, cell: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const on = (Math.floor(x / cell) + Math.floor(y / cell)) % 2 === 0;
      out[y * w + x] = on ? 220 : 30;
    }
  }
  return out;
}

// crude box blur, enough to simulate "this frame is out of focus"
function blur(gray: Float64Array, w: number, h: number, radius: number): Float64Array {
  const out = new Float64Array(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let sum = 0, count = 0;
      for (let dy = -radius; dy <= radius; dy++) {
        for (let dx = -radius; dx <= radius; dx++) {
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
          sum += gray[ny * w + nx];
          count++;
        }
      }
      out[y * w + x] = sum / count;
    }
  }
  return out;
}

describe("laplacianVariance", () => {
  it("is near zero for a flat image", () => {
    const flat = new Float64Array(40 * 40).fill(128);
    expect(laplacianVariance(flat, 40, 40)).toBeCloseTo(0, 5);
  });

  it("is much higher for a sharp pattern than a blurred version of it", () => {
    const w = 60, h = 60;
    const sharp = checkerboard(w, h, 6);
    const blurred = blur(sharp, w, h, 3);

    const sharpVar = laplacianVariance(sharp, w, h);
    const blurredVar = laplacianVariance(blurred, w, h);

    expect(sharpVar).toBeGreaterThan(blurredVar * 5);
  });
});
