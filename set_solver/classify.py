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
        if self.count not in (1, 2, 3) or self.color is None or self.shape is None or self.fill is None:
            return "????"
        return f"{self.count}{self.color}{self.shape}{self.fill}"


def ink_signal(bgr: np.ndarray) -> np.ndarray:
    """Per-pixel distance from pure white, as a single float channel (0..441)."""
    return _distance_from(bgr, (255.0, 255.0, 255.0))


def _distance_from(bgr: np.ndarray, color) -> np.ndarray:
    diff = np.array(color, dtype=np.float64) - bgr.astype(np.float64)
    return np.sqrt(np.sum(diff * diff, axis=2))


def _ink_mask(signal: np.ndarray, threshold: float = C.INK_SIGNAL_THRESHOLD) -> np.ndarray:
    return (signal > threshold).astype(np.uint8) * 255


def _interior_margins(shape: tuple[int, int]) -> tuple[int, int]:
    h, w = shape
    return max(1, int(w * C.CARD_BORDER_MARGIN_FRACTION)), max(1, int(h * C.CARD_BORDER_MARGIN_FRACTION))


def _interior_mask(shape: tuple[int, int]) -> np.ndarray:
    """255 everywhere except a thin border, where warp/quad jitter can smear in table pixels."""
    h, w = shape
    mx, my = _interior_margins(shape)
    mask = np.zeros((h, w), dtype=np.uint8)
    mask[my:h - my, mx:w - mx] = 255
    return mask


def _touches_interior_edge(bbox, shape: tuple[int, int], tolerance: int = 2) -> bool:
    """A real symbol always sits with margin inside the card; a blob hugging the
    interior boundary is almost always a bleed-in sliver of table, not ink."""
    x, y, w, h = bbox
    mx, my = _interior_margins(shape)
    card_h, card_w = shape
    return (
        x <= mx + tolerance
        or y <= my + tolerance
        or x + w >= card_w - mx - tolerance
        or y + h >= card_h - my - tolerance
    )


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


def _scan_lines(signal: np.ndarray, x: int, y: int, w: int, h: int, transpose: bool) -> tuple[list, list]:
    """Sample scanlines across a symbol's bbox, perpendicular to `transpose`.

    Hatching direction isn't standardized -- one deck's "striped" fill draws
    vertical lines (crossed by a horizontal scanline), another's draws
    horizontal lines (crossed by a vertical one). Sampling one fixed
    direction only detects one convention, so the caller tries both and
    keeps whichever finds more crossings.
    """
    field = signal[y:y + h, x:x + w]
    if transpose:
        field = field.T
    length = field.shape[0]

    lo_frac, hi_frac = C.FILL_SCANLINE_BAND
    positions = np.linspace(length * lo_frac, length * hi_frac, C.FILL_SCANLINE_COUNT)
    positions = np.clip(positions.astype(int), 0, length - 1)

    crossings = []
    interior_means = []
    for pos in positions:
        line = field[pos, :]
        if line.size < 3:
            continue
        ink = line > C.INK_SIGNAL_THRESHOLD
        ink_idx = np.flatnonzero(ink)
        if ink_idx.size == 0:
            continue  # symbol doesn't reach this far (e.g. a curved tip or wave dip)
        transitions = int(np.sum(ink[1:] != ink[:-1]))
        crossings.append(transitions)

        # inset relative to THIS line's own ink span, not the bbox: a wave's ink
        # span shifts line to line, so a bbox-relative crop can miss it entirely.
        span_lo, span_hi = int(ink_idx[0]), int(ink_idx[-1])
        span_len = span_hi - span_lo + 1
        inset = max(1, int(span_len * C.FILL_INTERIOR_MARGIN))
        seg = line[span_lo + inset: span_hi - inset + 1]
        if seg.size == 0:
            seg = line[span_lo: span_hi + 1]
        interior_means.append(seg.mean())

    return crossings, interior_means


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

    row_crossings, row_interior = _scan_lines(signal, x, y, w, h, transpose=False)
    col_crossings, col_interior = _scan_lines(signal, x, y, w, h, transpose=True)

    if not row_crossings and not col_crossings:
        return "unknown", 0.0

    row_avg = float(np.mean(row_crossings)) if row_crossings else 0.0
    col_avg = float(np.mean(col_crossings)) if col_crossings else 0.0
    if row_avg >= col_avg:
        avg_crossings, interior_means = row_avg, row_interior
    else:
        avg_crossings, interior_means = col_avg, col_interior
    avg_interior = float(np.mean(interior_means)) if interior_means else 255.0

    if avg_crossings >= C.FILL_STRIPE_CROSSING_MIN:
        margin = (avg_crossings - C.FILL_STRIPE_CROSSING_MIN) / C.FILL_STRIPE_CROSSING_MIN
        return "S", margin

    dist = avg_interior - C.FILL_INTERIOR_INK_THRESHOLD
    margin = abs(dist) / C.FILL_INTERIOR_INK_THRESHOLD
    return ("F", margin) if dist >= 0 else ("E", margin)


def classify_card(card_bgr: np.ndarray) -> CardAttributes:
    interior = _interior_mask(card_bgr.shape[:2])

    # Real photos rarely expose a card's white background as literal (255,255,255) --
    # lighting and exposure shift it. The background is always the majority of the
    # card's area (1-3 symbols never cover most of it), so its per-channel median is
    # a robust first guess, refined below into a real white balance.
    median_bg = np.median(card_bgr[interior > 0].reshape(-1, 3), axis=0)
    rough_signal = _distance_from(card_bgr, median_bg)
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
    sat_channel = hsv[:, :, 1]

    symbols: list[SymbolMetrics] = []
    for contour in contours:
        x, y, w, h = cv2.boundingRect(contour)
        if _touches_interior_edge((x, y, w, h), mask.shape[:2]):
            continue
        area = cv2.contourArea(contour)
        filled = np.zeros(mask.shape, dtype=np.uint8)
        cv2.drawContours(filled, [contour], -1, 255, thickness=-1)
        symbol_ink_mask = cv2.bitwise_and(mask, filled)  # ink pixels only, not the white interior of empty symbols
        ink_pixels = symbol_ink_mask > 0
        if not ink_pixels.any():
            continue

        # A quad that's slightly off can warp in a sliver of table (shadow, wood
        # grain) alongside the real card. Unlike printed ink, that sliver is
        # desaturated -- reject it here so it doesn't inflate the symbol count.
        if sat_channel[ink_pixels].mean() < C.SYMBOL_MIN_SATURATION:
            continue

        hue_values = hue_channel[ink_pixels]
        hue = _circular_mean_hue(hue_values)

        shape, shape_margin = classify_shape(contour)
        fill, fill_margin = classify_fill(signal, contour)

        symbols.append(SymbolMetrics(
            contour=contour, bbox=(x, y, w, h), area=area,
            shape=shape, shape_margin=shape_margin,
            fill=fill, fill_margin=fill_margin, hue=hue,
        ))

    if not symbols:
        return CardAttributes(count=0, color=None, shape=None, fill=None)

    count = len(symbols)

    # All symbols on a real card always share one shape/fill. If ours disagree
    # (usually glare or lighting thinning some symbols but not others), that
    # disagreement is itself the strongest evidence of trouble on this card --
    # stronger than any single symbol's own margin -- so it overrides toward
    # zero confidence rather than just picking the majority and moving on.
    shape_counter = Counter(s.shape for s in symbols)
    shape_mode = shape_counter.most_common(1)[0][0]
    if len(shape_counter) > 1:
        shape_margin = 0.0
    else:
        shape_margin = min(s.shape_margin for s in symbols if s.shape == shape_mode)

    fill_values = [s.fill for s in symbols if s.fill != "unknown"]
    if fill_values:
        fill_counter = Counter(fill_values)
        fill_mode = fill_counter.most_common(1)[0][0]
        if len(fill_counter) > 1:
            fill_margin = 0.0
        else:
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
