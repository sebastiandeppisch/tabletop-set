/** All tunable thresholds in one place. No magic numbers elsewhere.
 *
 * Mirrors set_solver/config.py -- kept in sync by hand since this is a
 * from-scratch TS port (Phase 2), not a transpile. Every numeric constant is
 * annotated `: number` so TS doesn't narrow it to a literal type and then
 * flag ordinary comparisons against it as "always false".
 */

// --- card detection ---
export const DOWNSCALE_LONG_EDGE: number = 640;

export const ADAPTIVE_THRESH_WINDOW_FRACTION: number = 0.22;
export const ADAPTIVE_THRESH_C: number = 6;

export const MIN_COMPONENT_AREA_FRACTION: number = 0.004;
export const APPROX_POLY_EPSILON_FACTORS: number[] = [0.01, 0.02, 0.03, 0.045, 0.06];

export const CARD_ASPECT_RATIO: number = 200 / 130;
export const CARD_ASPECT_TOLERANCE: number = 0.6;

export const CARD_AREA_MEDIAN_TOLERANCE: number = 0.8;
export const BORDER_MARGIN_PX: number = 3;

export const CANONICAL_CARD_W: number = 200;
export const CANONICAL_CARD_H: number = 130;

// --- symbol segmentation (on the canonical warped card) ---
export const INK_SIGNAL_THRESHOLD: number = 60;

export const CARD_BORDER_MARGIN_FRACTION: number = 0.04;
export const SYMBOL_MIN_SATURATION: number = 20;
export const SYMBOL_MIN_AREA_FRACTION: number = 0.01;
export const SYMBOL_MIN_AREA_FOR_FILL_FRACTION: number = 0.015;
export const SYMBOL_MIN_DIM_FOR_FILL_PX: number = 10;

// --- shape: solidity + extent ---
export const SHAPE_SOLIDITY_WAVE_THRESHOLD: number = 0.92;
export const SHAPE_EXTENT_DIAMOND: number = 0.5;
export const SHAPE_EXTENT_ELLIPSE: number = 0.785;

// --- color: hue centers, 0..179 scale (matches OpenCV convention used in the Python prototype) ---
export const HUE_RED: number = 172;
export const HUE_GREEN: number = 81;
export const HUE_PURPLE: number = 120;

// --- fill: scanline zero-crossing count ---
export const FILL_SCANLINE_COUNT: number = 9;
export const FILL_SCANLINE_BAND: [number, number] = [0.25, 0.75];
export const FILL_INTERIOR_MARGIN: number = 0.25;
export const FILL_STRIPE_CROSSING_MIN: number = 9.0;
export const FILL_INTERIOR_INK_THRESHOLD: number = 60;

// --- self-test ---
export const DECK_SIZE: number = 81;

// --- overlay ---
export const OVERLAY_MARGIN_GREEN: number = 0.35;
