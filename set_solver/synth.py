"""Synthetic Set-card renderer.

Generates all 81 cards analytically (no templates, no photos) so the
detection + classification pipeline is testable with known ground truth
before any real photo exists. Also composes them into "scene" images with
perspective distortion, noise and a brightness gradient, for end-to-end
detection tests. Does not replace real photos: glare and artistic light
are out of scope here.
"""
from __future__ import annotations

import random
from dataclasses import dataclass

import cv2
import numpy as np

from . import config as C
from .labels import Label, all_labels

SYNTH_CARD_W = C.CANONICAL_CARD_W * 2
SYNTH_CARD_H = C.CANONICAL_CARD_H * 2

BGR_BY_COLOR = {
    # Matched to config.HUE_RED/GREEN/PURPLE, which are calibrated from real
    # deck photos: this deck's "red" prints closer to crimson and "purple"
    # closer to navy blue than a textbook R/G/P swatch.
    "R": (81, 41, 190),
    "G": (118, 150, 44),
    "P": (150, 32, 32),
}

STRIPE_SPACING_PX = 7
OUTLINE_THICKNESS = 4


def _symbol_boxes(count: int, card_w: int, card_h: int) -> list[tuple[float, float, float, float]]:
    margin_x = card_w * 0.10
    margin_y = card_h * 0.32
    usable_w = card_w - 2 * margin_x
    slot_w = usable_w / 3
    box_w = slot_w * 0.72
    box_h = card_h - 2 * margin_y
    start = (3 - count) / 2.0
    boxes = []
    for i in range(count):
        slot_index = start + i
        cx = margin_x + slot_w * (slot_index + 0.5)
        boxes.append((cx - box_w / 2, margin_y, box_w, box_h))
    return boxes


def _diamond_polygon(bx, by, bw, bh) -> np.ndarray:
    pts = [
        (bx + bw / 2, by),
        (bx + bw, by + bh / 2),
        (bx + bw / 2, by + bh),
        (bx, by + bh / 2),
    ]
    return np.array(pts, dtype=np.float64)


def _ellipse_polygon(bx, by, bw, bh) -> np.ndarray:
    center = (bx + bw / 2, by + bh / 2)
    axes = (bw / 2, bh / 2)
    pts = cv2.ellipse2Poly((int(center[0]), int(center[1])), (int(axes[0]), int(axes[1])), 0, 0, 360, 4)
    return pts.astype(np.float64)


def _wave_polygon(bx, by, bw, bh) -> np.ndarray:
    """Constant-thickness ribbon along one sine cycle: a gentle squiggle, not a zigzag.

    A single full cycle keeps a horizontal scanline's crossing count low (as on a real
    squiggle symbol) while the S-bend still makes the convex hull noticeably bigger
    than the shape itself, so solidity still flags it as non-convex.
    """
    n = 48
    xs = np.linspace(bx, bx + bw, n)
    t = (xs - bx) / bw
    center = by + bh * 0.5 + bh * 0.22 * np.sin(2 * np.pi * t)
    half_thick = bh * 0.20
    top = center - half_thick
    bottom = center + half_thick
    top_pts = np.stack([xs, top], axis=1)
    bottom_pts = np.stack([xs[::-1], bottom[::-1]], axis=1)
    return np.concatenate([top_pts, bottom_pts], axis=0)


SHAPE_BUILDERS = {"D": _diamond_polygon, "E": _ellipse_polygon, "W": _wave_polygon}


def _draw_symbol(canvas: np.ndarray, box, shape: str, color: str, fill: str) -> None:
    poly = SHAPE_BUILDERS[shape](*box).astype(np.int32)
    bgr = BGR_BY_COLOR[color]

    if fill == "F":
        cv2.fillPoly(canvas, [poly], bgr, lineType=cv2.LINE_AA)
    elif fill == "S":
        mask = np.zeros(canvas.shape[:2], dtype=np.uint8)
        cv2.fillPoly(mask, [poly], 255)
        striped = canvas.copy()
        x, y, w, h = cv2.boundingRect(poly)
        # vertical hatching so a horizontal scanline crosses many stripes
        for lx in range(x, x + w, STRIPE_SPACING_PX):
            cv2.line(striped, (lx, y), (lx, y + h), bgr, 2, cv2.LINE_AA)
        canvas[:] = np.where(mask[:, :, None] > 0, striped, canvas)
    # 'E' (empty): outline only, drawn below for every fill type

    cv2.polylines(canvas, [poly], True, bgr, OUTLINE_THICKNESS, cv2.LINE_AA)


def render_card(label: Label, card_w: int = SYNTH_CARD_W, card_h: int = SYNTH_CARD_H) -> np.ndarray:
    """A single un-distorted card patch, white background, count/color/shape/fill from `label`."""
    canvas = np.full((card_h, card_w, 3), 255, dtype=np.uint8)
    count = int(label.count)
    for box in _symbol_boxes(count, card_w, card_h):
        _draw_symbol(canvas, box, label.shape, label.color, label.fill)
    return canvas


@dataclass
class PlacedCard:
    label: Label
    quad: np.ndarray  # 4x2 float32 in scene coordinates, ordered TL,TR,BR,BL


def _jittered_quad(cx, cy, w, h, rng: random.Random, max_jitter_frac: float, max_rotation_deg: float):
    angle = np.radians(rng.uniform(-max_rotation_deg, max_rotation_deg))
    base = np.array([[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]])
    rot = np.array([[np.cos(angle), -np.sin(angle)], [np.sin(angle), np.cos(angle)]])
    quad = base @ rot.T + np.array([cx, cy])
    jitter = np.array([[rng.uniform(-1, 1), rng.uniform(-1, 1)] for _ in range(4)]) * (max_jitter_frac * min(w, h))
    return (quad + jitter).astype(np.float32)


def compose_scene(
    labels: list[Label],
    card_w: int = 190,
    card_h: int = 124,
    seed: int = 0,
    noise_sigma: float = 6.0,
    max_jitter_frac: float = 0.03,
    max_rotation_deg: float = 12.0,
    gradient_strength: float = 40.0,
    target_aspect: float = 900 / 700,
) -> tuple[np.ndarray, list[PlacedCard]]:
    """Place `labels` as distorted cards on a synthetic table scene. Returns (image, placed_cards).

    Grid cell size is derived from the card's rotated footprint so cards never
    overlap regardless of how many are placed.
    """
    rng = random.Random(seed)
    background = rng.randint(70, 110)

    diag = float(np.hypot(card_w, card_h))
    cell = diag * 1.35  # clearance for rotation + jitter + a visible gap
    n = len(labels)
    cols = max(1, int(np.ceil(np.sqrt(n * target_aspect))))
    rows = int(np.ceil(n / cols))
    margin = cell * 0.4
    scene_w = int(cols * cell + 2 * margin)
    scene_h = int(rows * cell + 2 * margin)
    scene = np.full((scene_h, scene_w, 3), background, dtype=np.uint8)

    slack = max(0.0, (cell - diag) * 0.5 * 0.6)  # keep jitter within the clearance we budgeted

    placed: list[PlacedCard] = []
    for idx, label in enumerate(labels):
        r, c = divmod(idx, cols)
        cx = margin + cell * (c + 0.5) + rng.uniform(-slack, slack)
        cy = margin + cell * (r + 0.5) + rng.uniform(-slack, slack)
        quad = _jittered_quad(cx, cy, card_w, card_h, rng, max_jitter_frac, max_rotation_deg)

        card_img = render_card(label)
        src = np.array(
            [[0, 0], [card_img.shape[1] - 1, 0], [card_img.shape[1] - 1, card_img.shape[0] - 1], [0, card_img.shape[0] - 1]],
            dtype=np.float32,
        )
        m = cv2.getPerspectiveTransform(src, quad)
        warped = cv2.warpPerspective(card_img, m, (scene_w, scene_h), flags=cv2.INTER_LINEAR)
        mask = cv2.warpPerspective(
            np.full(card_img.shape[:2], 255, dtype=np.uint8), m, (scene_w, scene_h), flags=cv2.INTER_LINEAR
        )
        scene = np.where(mask[:, :, None] > 127, warped, scene)
        placed.append(PlacedCard(label=label, quad=quad))

    # brightness gradient, simulates uneven light across the table
    yy, xx = np.mgrid[0:scene_h, 0:scene_w]
    gradient = (xx / scene_w - 0.5) * gradient_strength + (yy / scene_h - 0.5) * (gradient_strength * 0.5)
    scene = np.clip(scene.astype(np.float64) + gradient[:, :, None], 0, 255)

    scene = scene + np.random.RandomState(seed).normal(0, noise_sigma, scene.shape)
    scene = np.clip(scene, 0, 255).astype(np.uint8)

    return scene, placed


def full_deck() -> list[Label]:
    return all_labels()


def generate_demo_dataset(out_dir, n_scenes: int = 5, cards_per_scene: int = 15) -> None:
    """Write scene_NNN.jpg + scene_NNN.json (ground truth, spec schema) for manual CLI testing."""
    from pathlib import Path

    from .io_format import CardRecord, ImageResult, write_json

    out_dir = Path(out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)
    deck = full_deck()

    for scene_idx in range(n_scenes):
        rng = random.Random(scene_idx)
        sample = rng.sample(deck, cards_per_scene)
        scene, placed = compose_scene(sample, seed=scene_idx)
        name = f"scene_{scene_idx:03d}"
        cv2.imwrite(str(out_dir / f"{name}.jpg"), scene)
        result = ImageResult(
            img=f"{name}.jpg",
            cards=[CardRecord(quad=p.quad, label=str(p.label)) for p in placed],
        )
        write_json(result, out_dir / f"{name}.json")


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Generate a synthetic demo dataset with known ground truth.")
    parser.add_argument("--out", default="data/synthetic")
    parser.add_argument("--scenes", type=int, default=5)
    parser.add_argument("--cards-per-scene", type=int, default=15)
    args = parser.parse_args()
    generate_demo_dataset(args.out, n_scenes=args.scenes, cards_per_scene=args.cards_per_scene)
    print(f"wrote {args.scenes} synthetic scene(s) to {args.out}")
