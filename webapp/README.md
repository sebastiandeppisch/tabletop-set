# Set-Solver — Web App (Phase 2 + 3)

A from-scratch TypeScript port of the Python CV prototype (`../set_solver`),
plus a live-camera browser UI. No OpenCV.js, no server: detection,
classification and set-solving all run client-side on `ImageData`.

## Structure

```
src/lib/          port of the Python pipeline, no DOM dependencies
  config.ts         all thresholds, kept in sync with set_solver/config.py by hand
  geometry.ts       quad ordering, convex hull, Douglas-Peucker, homography + warp
  cc.ts             connected component labeling (shared by detection + classify)
  detection.ts      downscale -> adaptive threshold -> CCL -> quad filter -> warp
  classify.ts       count / shape / color / fill classification
  sharpness.ts      Laplacian-variance blur score, dampens shape/fill confidence
  labels.ts         4-char label encode/decode
  solver.ts         brute-force Set search
  testSynth.ts      synthetic single-card renderer, tests only
  testScene.ts      synthetic multi-card scene composer, tests only
src/main.ts        camera + file-upload UI wiring, live vs. snapshot mode
src/overlay.ts      draws quad outlines + Set connector lines on canvas
src/reconstruct.ts  re-draws each card's shape/count/color/fill as a small
                    graphic, warped onto the card's own quad
e2e/                manual Playwright smoke scripts (see below)
```

Every technique in `src/lib` is restricted to what a from-scratch port can
express simply: box-filtering via an integral image, BFS connected
components, a monotone-chain convex hull, closed-contour Douglas-Peucker,
a 4-point homography solved directly, and bilinear-sampled warps. No
external CV library.

## Develop

```
npm install
npm run dev        # http://localhost:5173
npm run test       # vitest: geometry/labels/solver + synthetic classify/detect/pipeline
npm run typecheck
npm run build
```

`npm run test` mirrors the Python characterization tests: a synthetic
single-card renderer for classification (81/81 must match) and a synthetic
multi-card scene composer for detection (IoU + all-cards-found), plus an
end-to-end pass tolerating perspective/noise. Same rationale as the Python
side: these catch regressions while tuning thresholds, they don't discover
anything absent from the test fixtures.

## App usage

Three ways to feed it an image:

- **Live-Scan** (camera) — `getUserMedia`, processes a frame every ~600ms
  (throttled on purpose: the whole pipeline runs synchronously on the main
  thread, and firing it on every animation frame would stall the UI on
  anything but a trivial camera resolution). Fastest feedback, but a frame
  grabbed mid-motion can be locally blurred.
- **Einzelfoto** (camera) — same camera stream, but nothing is processed
  until "Foto aufnehmen" is tapped. Slower per card, but the deliberate
  pause tends to produce a sharper frame. Both modes exist side by side
  specifically so this trade-off can be compared rather than guessed at.
- **Foto hochladen** — runs the pipeline once on a picked file, useful for
  testing without a camera and for reproducing a specific photo's result.

Detected cards get a confidence-coloured quad outline (green/orange/red,
same idea as the Python prototype's overlay) plus their classified shape,
count, color and fill re-drawn semi-transparently right on the card --
faster to eyeball than decoding a 4-letter label. Cards in a found Set are
additionally connected by a line, one colour per set.

Shape/fill confidence is also dampened by how sharp the card's own warped
image is (`lib/sharpness.ts`): a motion-blurred card in a live frame reads
as an uncertain orange/red instead of a confident wrong answer. It doesn't
skip or gate frames outright -- that needs firmer calibration than a
handful of samples can give -- so it only ever pulls confidence down, never
hides a detection.

## E2E smoke tests

Not part of `npm run test` (they need a running dev server and a real
browser). Manual:

```
npm run dev &
node e2e/upload-smoke.mjs http://localhost:5173 /path/to/photo.jpg
node e2e/camera-smoke.mjs http://localhost:5173           # live mode
node e2e/snapshot-mode-smoke.mjs http://localhost:5173    # einzelfoto mode
```

`CHROMIUM_PATH` overrides the Chromium binary if the default
(`/opt/pw-browsers/chromium`) doesn't exist on your machine -- that path is
specific to this project's sandboxed dev environment.

## Known limitations (carried over from the Python prototype)

- Cards cut off at the photo edge are detected and explicitly rejected
  rather than guessed at.
- Glare on laminated cards isn't corrected for a single frame; the live
  camera path is the natural place to add temporal voting across frames
  later, but that isn't implemented yet.
- The live-processing loop runs on the main thread. A Web Worker would let
  video stay smooth while a frame is being processed and is the natural
  next step if frame rate becomes an issue on slower devices.
