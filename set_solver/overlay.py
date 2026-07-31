"""Validation rendering: real card next to a re-rendered vector reconstruction.

A human should be able to validate a whole photo at a glance: image-against-
image is faster to check than reading four letters per card. The frame
colour encodes distance to the nearest decision boundary so the eye goes to
the handful of shaky calls instead of scanning two hundred cards evenly.
"""
from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from . import config as C
from .classify import CardAttributes
from .labels import Label
from .pipeline import ProcessedImage
from .synth import render_card

GREEN = (60, 180, 60)
ORANGE = (0, 140, 255)
RED = (40, 40, 220)

THUMB_W = C.OVERLAY_CARD_RENDER_W
THUMB_H = C.OVERLAY_CARD_RENDER_H
FRAME = 6
GAP = 10


def confidence_color(attrs: CardAttributes) -> tuple:
    if attrs.count == 0 or "?" in attrs.label():
        return RED
    if attrs.confidence >= C.OVERLAY_MARGIN_GREEN:
        return GREEN
    return ORANGE


def draw_detection_overlay(image: np.ndarray, processed: ProcessedImage) -> np.ndarray:
    """Original image with detected quads outlined and labelled."""
    out = image.copy()
    for cand, attrs in zip(processed.candidates, processed.attributes):
        color = confidence_color(attrs)
        pts = cand.quad.astype(np.int32).reshape(-1, 1, 2)
        cv2.polylines(out, [pts], True, color, 3, cv2.LINE_AA)
        label_pos = tuple(cand.quad[0].astype(int))
        cv2.putText(out, attrs.label(), label_pos, cv2.FONT_HERSHEY_SIMPLEX, 0.9, color, 2, cv2.LINE_AA)
    return out


def _placeholder_card(w: int, h: int) -> np.ndarray:
    canvas = np.full((h, w, 3), 230, dtype=np.uint8)
    cv2.line(canvas, (0, 0), (w, h), RED, 3, cv2.LINE_AA)
    cv2.line(canvas, (w, 0), (0, h), RED, 3, cv2.LINE_AA)
    return canvas


def render_card_pair(warped_bgr: np.ndarray, attrs: CardAttributes) -> np.ndarray:
    """Real (left) vs. re-rendered vector reconstruction (right), framed by confidence."""
    real = cv2.resize(warped_bgr, (THUMB_W, THUMB_H), interpolation=cv2.INTER_AREA)
    label = attrs.label()
    if "?" in label:
        recon = _placeholder_card(THUMB_W, THUMB_H)
    else:
        recon = render_card(Label.parse(label), THUMB_W, THUMB_H)

    color = confidence_color(attrs)
    pair_w = THUMB_W * 2 + GAP
    pair_h = THUMB_H
    inner = np.full((pair_h, pair_w, 3), 255, dtype=np.uint8)
    inner[:, :THUMB_W] = real
    inner[:, THUMB_W + GAP:] = recon

    framed = np.full((pair_h + 2 * FRAME, pair_w + 2 * FRAME, 3), color, dtype=np.uint8)
    framed[FRAME:FRAME + pair_h, FRAME:FRAME + pair_w] = inner
    cv2.putText(framed, label, (FRAME, FRAME + 20), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 0, 0), 2, cv2.LINE_AA)
    return framed


def build_contact_sheet(card_pairs: list[np.ndarray], cols: int = 6) -> np.ndarray:
    if not card_pairs:
        return np.full((THUMB_H, THUMB_W, 3), 255, dtype=np.uint8)
    h, w = card_pairs[0].shape[:2]
    rows = int(np.ceil(len(card_pairs) / cols))
    sheet = np.full((rows * h, cols * w, 3), 255, dtype=np.uint8)
    for idx, pair in enumerate(card_pairs):
        r, c = divmod(idx, cols)
        sheet[r * h:r * h + h, c * w:c * w + w] = pair
    return sheet


def draw_fill_scanlines(warped_bgr: np.ndarray, attrs: CardAttributes) -> np.ndarray:
    """Debug view: shows exactly which rows the fill classifier sampled per symbol."""
    out = warped_bgr.copy()
    lo_frac, hi_frac = C.FILL_SCANLINE_BAND
    for symbol in attrs.symbols:
        x, y, w, h = symbol.bbox
        rows = np.linspace(y + h * lo_frac, y + h * hi_frac, C.FILL_SCANLINE_COUNT)
        for ry in rows.astype(int):
            cv2.line(out, (x, ry), (x + w, ry), (0, 220, 255), 1, cv2.LINE_AA)
    return out


def write_debug_artifacts(processed: ProcessedImage, out_dir: Path) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    debug = processed.debug
    if debug is not None:
        if debug.gray is not None:
            cv2.imwrite(str(out_dir / "01_gray.png"), debug.gray)
        if debug.mask is not None:
            cv2.imwrite(str(out_dir / "02_threshold_mask.png"), debug.mask)
        if debug.labels is not None:
            normalized = (debug.labels % 255).astype(np.uint8)
            colorized = cv2.applyColorMap(normalized * 37, cv2.COLORMAP_HSV)
            colorized[debug.labels == 0] = 0
            cv2.imwrite(str(out_dir / "03_components.png"), colorized)

    for idx, (cand, attrs) in enumerate(zip(processed.candidates, processed.attributes)):
        cv2.imwrite(str(out_dir / f"card_{idx:02d}_warped.png"), cand.warped)
        cv2.imwrite(str(out_dir / f"card_{idx:02d}_scanlines.png"), draw_fill_scanlines(cand.warped, attrs))
