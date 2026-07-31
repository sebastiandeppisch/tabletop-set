"""Attribute classification on a canonical warped card: count, shape, color, fill.

Everything here operates on one shared per-pixel signal — "distance from
white" — so segmentation, shape metrics and fill scanlines all agree on
what counts as "ink" versus background. Colour is the only place hue is
needed, and even that is computed after a per-card white balance.
"""
from __future__ import annotations

from collections import Counter
from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from . import config as C


@dataclass
class SymbolMetrics:
    contour: np.ndarray
    bbox: tuple  # x, y, w, h
    area: float
    shape: str
    shape_margin: float
    fill: str
    fill_margin: float
    hue: float  # opencv hue units, 0..179


@dataclass
class CardAttributes:
    count: int
    color: Optional[str]
    shape: Optional[str]
    fill: Optional[str]
    color_margin: float = 0.0
    shape_margin: float = 0.0
    fill_margin: float = 0.0
    symbols: list = field(default_factory=list)

    @property
    def confidence(self) -> float:
        """Normalized 0..1 margin to the weakest decision boundary among all attributes."""
        margins = [self.color_margin, self.shape_margin, self.fill_margin]
        return max(0.0, min(1.0, min(margins)))

    def label(self) -> str:
        if self.count == 0 or self.color is None or self.shape is None or self.fill is None:
            return "????"
        return f"{self.count}{self.color}{self.shape}{self.fill}"


def ink_signal(bgr: np.ndarray) -> np.ndarray:
    """Per-pixel distance from pure white, as a single float channel (0..441)."""
    diff = 255.0 - bgr.astype(np.float64)
    return np.sqrt(np.sum(diff * diff, axis=2))


def _ink_mask(signal: np.ndarray, threshold: float = C.INK_SIGNAL_THRESHOLD) -> np.ndarray:
    return (signal > threshold).astype(np.uint8) * 255


def _interior_mask(shape: tuple[int, int]) -> np.ndarray:
    """255 everywhere except a thin border, where warp/quad jitter can smear in table pixels."""
    h, w = shape
    mx = max(1, int(w * C.CARD_BORDER_MARGIN_FRACTION))
    my = max(1, int(h * C.CARD_BORDER_MARGIN_FRACTION))
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[my:h - my, mx:w - mx] = 255
    return mask


def _find_symbol_contours(mask: np.ndarray, card_area: float) -> list[np.ndarray]:
    num_labels, labels_im = cv2.connectedComponentsWithStats(mask, connectivity=8)[:2]
    min_area = C.SYMBOL_MIN_AREA_FRACTION * card_area
    contours = []
    for label in range(1, num_labels):
        component_mask = (labels_im == label).astype(np.uint8) * 255
        area = int(cv2.countNonZero(component_mask))
        if area < min_area:
            continue
        found, _ = cv2.findContours(component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not found:
            continue
        contours.append(max(found, key=cv2.contourArea))
    contours.sort(key=lambda c: cv2.boundingRect(c)[0])
    return contours


def white_balance(bgr: np.ndarray, background_mask: np.ndarray) -> np.ndarray:
    bg_mean = cv2.mean(bgr, mask=background_mask)[:3]
    gains = [255.0 / max(m, 1.0) for m in bg_mean]
    balanced = bgr.astype(np.float64) * np.array(gains, dtype=np.float64)
    return np.clip(balanced, 0, 255).astype(np.uint8)


def _circular_mean_hue(hue_values: np.ndarray) -> float:
    """Mean of OpenCV hues (0..179, wraps) via averaging unit vectors."""
    angles = hue_values.astype(np.float64) * (2 * np.pi / 180.0)
    mean_angle = np.arctan2(np.sin(angles).mean(), np.cos(angles).mean())
    mean_deg = np.degrees(mean_angle) % 360.0
    return (mean_deg / 2.0) % 180.0


def _hue_distance(h1: float, h2: float) -> float:
    d = abs(h1 - h2) % 180.0
    return min(d, 180.0 - d)


def classify_shape(contour) -> tuple[str, float]:
    area = cv2.contourArea(contour)
    hull = cv2.convexHull(contour)
    hull_area = cv2.contourArea(hull)
    solidity = area / hull_area if hull_area > 0 else 0.0

    _, _, rw, rh = cv2.boundingRect(contour)
    rect_area = rw * rh
    extent = area / rect_area if rect_area > 0 else 0.0

    if solidity < C.SHAPE_SOLIDITY_WAVE_THRESHOLD:
        margin = (C.SHAPE_SOLIDITY_WAVE_THRESHOLD - solidity) / C.SHAPE_SOLIDITY_WAVE_THRESHOLD
        return "W", margin

    d_dist = abs(extent - C.SHAPE_EXTENT_DIAMOND)
    e_dist = abs(extent - C.SHAPE_EXTENT_ELLIPSE)
    span = C.SHAPE_EXTENT_ELLIPSE - C.SHAPE_EXTENT_DIAMOND
    if d_dist < e_dist:
        return "D", (e_dist - d_dist) / span
    return "E", (d_dist - e_dist) / span


def classify_fill(signal: np.ndarray, contour) -> tuple[str, float]:
    x, y, w, h = cv2.boundingRect(contour)
    area = cv2.contourArea(contour)
    card_area = signal.shape[0] * signal.shape[1]

    if (
        w < C.SYMBOL_MIN_DIM_FOR_FILL_PX
        or h < C.SYMBOL_MIN_DIM_FOR_FILL_PX
        or area < C.SYMBOL_MIN_AREA_FOR_FILL_FRACTION * card_area
    ):
        return "unknown", 0.0

    lo_frac, hi_frac = C.FILL_SCANLINE_BAND
    rows = np.linspace(y + h * lo_frac, y + h * hi_frac, C.FILL_SCANLINE_COUNT)
    rows = np.clip(rows.astype(int), 0, signal.shape[0] - 1)

    crossings = []
    interior_means = []
    for ry in rows:
        row = signal[ry, x:x + w]
        if row.size < 3:
            continue
        ink = row > C.INK_SIGNAL_THRESHOLD
        ink_idx = np.flatnonzero(ink)
        if ink_idx.size == 0:
            continue  # symbol doesn't reach this height (e.g. a curved tip or wave dip)
        transitions = int(np.sum(ink[1:] != ink[:-1]))
        crossings.append(transitions)

        # inset relative to THIS row's own ink span, not the bbox: a wave's ink
        # span shifts row to row, so a bbox-relative crop can miss it entirely.
        span_lo, span_hi = int(ink_idx[0]), int(ink_idx[-1])
        span_len = span_hi - span_lo + 1
        inset = max(1, int(span_len * C.FILL_INTERIOR_MARGIN))
        seg = row[span_lo + inset: span_hi - inset + 1]
        if seg.size == 0:
            seg = row[span_lo: span_hi + 1]
        interior_means.append(seg.mean())

    if not crossings:
        return "unknown", 0.0

    avg_crossings = float(np.mean(crossings))
    avg_interior = float(np.mean(interior_means))

    if avg_crossings >= C.FILL_STRIPE_CROSSING_MIN:
        margin = (avg_crossings - C.FILL_STRIPE_CROSSING_MIN) / C.FILL_STRIPE_CROSSING_MIN
        return "S", margin

    dist = avg_interior - C.FILL_INTERIOR_INK_THRESHOLD
    margin = abs(dist) / C.FILL_INTERIOR_INK_THRESHOLD
    return ("F", margin) if dist >= 0 else ("E", margin)


def classify_card(card_bgr: np.ndarray) -> CardAttributes:
    interior = _interior_mask(card_bgr.shape[:2])

    rough_signal = ink_signal(card_bgr)
    rough_mask = cv2.bitwise_and(_ink_mask(rough_signal), interior)
    dilated = cv2.dilate(rough_mask, np.ones((5, 5), np.uint8))
    background_mask = cv2.bitwise_and(cv2.bitwise_not(dilated), interior)

    balanced = white_balance(card_bgr, background_mask)
    signal = ink_signal(balanced)
    mask = cv2.bitwise_and(_ink_mask(signal), interior)

    card_area = card_bgr.shape[0] * card_bgr.shape[1]
    contours = _find_symbol_contours(mask, card_area)

    if not contours:
        return CardAttributes(count=0, color=None, shape=None, fill=None)

    hsv = cv2.cvtColor(balanced, cv2.COLOR_BGR2HSV)
    hue_channel = hsv[:, :, 0]

    symbols: list[SymbolMetrics] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        area = cv2.contourArea(contour)
        filled = np.zeros(mask.shape, dtype=np.uint8)
        cv2.drawContours(filled, [contour], -1, 255, thickness=-1)
        symbol_ink_mask = cv2.bitwise_and(mask, filled)  # ink pixels only, not the white interior of empty symbols
        hue_values = hue_channel[symbol_ink_mask > 0]
        hue = _circular_mean_hue(hue_values) if hue_values.size else 0.0

        shape, shape_margin = classify_shape(contour)
        fill, fill_margin = classify_fill(signal, contour)

        symbols.append(SymbolMetrics(
            contour=contour, bbox=(x, y, w, h), area=area,
            shape=shape, shape_margin=shape_margin,
            fill=fill, fill_margin=fill_margin, hue=hue,
        ))

    count = len(symbols)

    shape_counter = Counter(s.shape for s in symbols)
    shape_mode = shape_counter.most_common(1)[0][0]
    shape_margin = min(s.shape_margin for s in symbols if s.shape == shape_mode)

    fill_values = [s.fill for s in symbols if s.fill != "unknown"]
    if fill_values:
        fill_counter = Counter(fill_values)
        fill_mode = fill_counter.most_common(1)[0][0]
        fill_margin = min(s.fill_margin for s in symbols if s.fill == fill_mode)
    else:
        fill_mode = "unknown"
        fill_margin = 0.0

    mean_hue = _circular_mean_hue(np.array([s.hue for s in symbols]))
    distances = {
        "R": _hue_distance(mean_hue, C.HUE_RED),
        "G": _hue_distance(mean_hue, C.HUE_GREEN),
        "P": _hue_distance(mean_hue, C.HUE_PURPLE),
    }
    ranked = sorted(distances.items(), key=lambda kv: kv[1])
    color = ranked[0][0]
    color_margin = (ranked[1][1] - ranked[0][1]) / 90.0

    return CardAttributes(
        count=count,
        color=color,
        shape=shape_mode,
        fill=fill_mode if fill_mode != "unknown" else None,
        color_margin=color_margin,
        shape_margin=shape_margin,
        fill_margin=fill_margin,
        symbols=symbols,
    )
