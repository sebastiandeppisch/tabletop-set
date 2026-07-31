# Set-Solver — Python Prototype (Phase 1)

Classical-CV detection and classification of [Set](https://en.wikipedia.org/wiki/Set_(card_game))
cards. No neural network, no templates, no training data — every attribute
is derived analytically from geometry and pixel statistics.

This is **Phase 1 only**: a Python/OpenCV prototype used to develop and tune
the algorithm and build a characterization test suite. Phase 2 (a from-scratch
TypeScript port for the browser) and Phase 3 (a live-camera web app) are not
part of this repo. Every technique used here is deliberately restricted to
what's reproducible in ~100 lines of custom TS — no feature matching, no
`cv2.ximgproc`, no ML modules.

## Pipeline

1. **Detection** (`set_solver/detection.py`): downscale → integral-image
   adaptive threshold → connected components → convex hull + `approxPolyDP`
   for 4-corner quads → filter by aspect ratio and (crucially) closeness to
   the *median* candidate area, since every card is the same size → reject
   quads touching the frame (cut-off cards) → `warpPerspective` to a
   canonical 200×130 card.
2. **Classification** (`set_solver/classify.py`), per canonical card:
   - **Count**: number of connected symbol components.
   - **Shape**: solidity (convexity) + extent (area / bounding-box area).
     Diamond ≈ 0.5, ellipse ≈ π/4, wave is simply non-convex.
   - **Color**: hue, but only after a per-card white balance against the
     card's own background — without it, artificial light shifts red/purple.
   - **Fill**: horizontal scanlines through each symbol; the number of
     ink/background zero-crossings tells full (0, dark) from empty (0,
     bright) from striped (many). Symbols below a hard minimum size are
     reported `unknown` rather than guessed.
3. **Set search** (`set_solver/solver.py`): brute-force over all 3-card
   combinations; a combination is a Set iff every attribute is all-same or
   all-different.
4. **Self-test** (`set_solver/selftest.py`): a full deck has each of the 81
   labels exactly once. Two cards with the same label in one photo is proof
   at least one is misclassified — no ground truth required to find this.

All thresholds live in one place: `set_solver/config.py`. No magic numbers
elsewhere.

## Before there were any photos

`set_solver/synth.py` renders all 81 cards analytically and composes them
into scenes with perspective distortion, brightness gradients and noise, so
the whole pipeline has deterministic, ground-truth-known smoke tests before
any real image exists. It does not replace real photos — glare and mixed
lighting aren't simulated.

Generate a demo dataset:

```
python -m set_solver.synth --out data/synthetic --scenes 5 --cards-per-scene 15
```

## CLI

```
python -m set_solver.cli <image-or-folder> [--out DIR] [--debug]
```

For each input image, writes to `--out` (default `./out`):

- `<name>.json` — detected quads + labels, spec schema (see below)
- `<name>_annotated.png` — original image with quads outlined, colored by
  confidence (green = clear, orange = close to a decision boundary, red =
  unclassified)
- `contact_sheet.png` — every detected card (real photo | re-rendered
  vector reconstruction) across the whole batch, for a fast visual check
- `selftest.txt` — duplicate-label report across all processed images
- with `--debug`: threshold mask, colorized components, each warped card,
  and its fill-classification scanlines, under `debug/<name>/`

## Data format

```json
{"img": "IMG_0042.jpg", "cards": [
  {"quad": [[120,88],[310,95],[305,340],[115,332]], "label": "2PWS"}
]}
```

`label` is 4 characters: Count (1-3), Color (R/G/P), Shape (D/E/W —
Diamond/Ellipse/Wave), Fill (S/F/E — Striped/Full/Empty). Short on purpose:
correcting one by hand should be a single keystroke away.

## Tests

This is characterization testing, not TDD: tests pin down current behavior
and guard against regressions while tuning thresholds, they don't discover
anything absent from the image material.

- `tests/test_detection_synth.py` — detection only: were all cards found,
  is the quad IoU within tolerance. Kept separate from classification so a
  slipped quad doesn't cascade into five unrelated attribute failures.
- `tests/test_classify_synth.py` — classification only, evaluated **per
  attribute** on the undistorted synthetic deck (81/81 must match).
- `tests/test_pipeline_synth.py` — end-to-end on distorted synthetic scenes;
  tolerates a small fraction of borderline misses, the way real photos will.
- `tests/test_selftest.py`, `tests/test_solver.py`, `tests/test_io_format.py`,
  `tests/test_geometry.py`, `tests/test_labels.py`, `tests/test_cli_smoke.py`.

Once real photos exist, run the CLI once, hand-correct the JSON, and that
becomes the new ground truth those tests compare against instead.

```
pip install -r requirements.txt
python -m pytest
```

## Known limitations (by design, for now)

- Glare on laminated cards is not corrected in Phase 1; the live-camera app
  will handle it with temporal voting across frames.
- Real lighting (mixed color temperature, uneven glare) will need further
  threshold tuning once real photos are available — the synthetic renderer
  simulates perspective, noise and brightness gradients, but not glare.
