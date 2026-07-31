/** 4-character Set card label: Count(1-3) Color(R/G/P) Shape(D/E/W) Fill(S/F/E). */

export const COLORS = ["R", "G", "P"] as const;
export const SHAPES = ["D", "E", "W"] as const;
export const FILLS = ["S", "F", "E"] as const;
export const COUNTS = ["1", "2", "3"] as const;

export type Color = (typeof COLORS)[number];
export type Shape = (typeof SHAPES)[number];
export type Fill = (typeof FILLS)[number];
export type Count = (typeof COUNTS)[number];

export interface Label {
  count: Count;
  color: Color;
  shape: Shape;
  fill: Fill;
}

export function labelToString(label: Label): string {
  return `${label.count}${label.color}${label.shape}${label.fill}`;
}

export function parseLabel(s: string): Label {
  if (s.length !== 4) throw new Error(`label must be 4 chars, got ${JSON.stringify(s)}`);
  const [count, color, shape, fill] = s as unknown as [string, string, string, string];
  if (!(COUNTS as readonly string[]).includes(count)) throw new Error(`bad count in ${JSON.stringify(s)}`);
  if (!(COLORS as readonly string[]).includes(color)) throw new Error(`bad color in ${JSON.stringify(s)}`);
  if (!(SHAPES as readonly string[]).includes(shape)) throw new Error(`bad shape in ${JSON.stringify(s)}`);
  if (!(FILLS as readonly string[]).includes(fill)) throw new Error(`bad fill in ${JSON.stringify(s)}`);
  return { count: count as Count, color: color as Color, shape: shape as Shape, fill: fill as Fill };
}

/** All 81 valid combinations, one full Set deck. */
export function allLabels(): Label[] {
  const out: Label[] = [];
  for (const count of COUNTS) {
    for (const color of COLORS) {
      for (const shape of SHAPES) {
        for (const fill of FILLS) {
          out.push({ count, color, shape, fill });
        }
      }
    }
  }
  return out;
}
