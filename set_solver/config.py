"""All tunable thresholds in one place. No magic numbers elsewhere."""

# --- card detection ---
DOWNSCALE_LONG_EDGE = 640

# adaptive threshold window is sized relative to expected card size, not
# symbol size: it must be large enough that a whole card is brighter than
# its local neighbourhood, even under a lighting gradient.
ADAPTIVE_THRESH_WINDOW_FRACTION = 0.22  # of the downscaled long edge
ADAPTIVE_THRESH_C = 6  # pixel must exceed local mean + C to count as "card"

MIN_COMPONENT_AREA_FRACTION = 0.004  # vs. image area, drops speckle before contour extraction
APPROX_POLY_EPSILON_FACTORS = (0.01, 0.02, 0.03, 0.045, 0.06)  # tried in order until exactly 4 vertices

CARD_ASPECT_RATIO = 200 / 130  # matches the canonical warp target below
CARD_ASPECT_TOLERANCE = 0.6  # relative; a raking camera angle foreshortens cards a lot, not just rotates them

CARD_AREA_MEDIAN_TOLERANCE = 0.8  # relative deviation from the median candidate area; cards nearer/farther from an angled camera aren't all the same size on screen
BORDER_MARGIN_PX = 3  # candidates whose quad touches the frame within this margin are cut cards, dropped

CANONICAL_CARD_W = 200
CANONICAL_CARD_H = 130

# --- symbol segmentation (on the canonical warped card) ---
# "ink signal" = distance from white per pixel; used both to find symbols
# and, at scanline resolution, to find fill transitions. Keeps colour,
# saturation and darkness on one shared axis instead of three.
INK_SIGNAL_THRESHOLD = 60  # 0..441 (max possible distance from white in BGR)

CARD_BORDER_MARGIN_FRACTION = 0.04  # ignore ink near the canonical card's edge: warp/quad jitter can smear the table in there
SYMBOL_MIN_SATURATION = 20  # mean HSV saturation of a blob's own ink pixels; below this it's a desaturated shadow/wood-grain smear, not printed ink
SYMBOL_MIN_AREA_FRACTION = 0.01  # of card area; below this a blob is noise, not a symbol
SYMBOL_MIN_AREA_FOR_FILL_FRACTION = 0.015  # stricter: below this, fill is reported as "unknown"
SYMBOL_MIN_DIM_FOR_FILL_PX = 10  # width/height guard in addition to area

# --- shape: solidity + extent ---
SHAPE_SOLIDITY_WAVE_THRESHOLD = 0.92  # below -> non-convex -> wave
SHAPE_EXTENT_DIAMOND = 0.5
SHAPE_EXTENT_ELLIPSE = 0.785

# --- color: hue centers, OpenCV 0..179 scale ---
# Calibrated from real deck photos (data/photos), not just the synthetic renderer:
# this deck's "red" prints closer to magenta/crimson and "purple" closer to navy
# blue than the synthetic placeholder colors. See data/photos hue sampling.
HUE_RED = 172  # wraps at 180
HUE_GREEN = 81
HUE_PURPLE = 120

# --- fill: horizontal scanline zero-crossing count ---
FILL_SCANLINE_COUNT = 9
FILL_SCANLINE_BAND = (0.25, 0.75)  # fraction of symbol bbox height sampled, avoids curved tips
FILL_INTERIOR_MARGIN = 0.25  # fraction of bbox width excluded on each side when averaging interior signal
FILL_STRIPE_CROSSING_MIN = 9.0  # avg crossings/row at/above this -> striped (empty tops out ~5.7, striped starts ~12.9)
FILL_INTERIOR_INK_THRESHOLD = 60  # avg interior ink-signal at/above this -> full, else empty

# --- self-test ---
DECK_SIZE = 81

# --- overlay ---
OVERLAY_MARGIN_GREEN = 0.35  # normalized margin at/above this renders a green frame
OVERLAY_CARD_RENDER_W = 200
OVERLAY_CARD_RENDER_H = 130
