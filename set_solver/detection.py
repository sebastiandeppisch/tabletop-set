"""Card detection: downscale -> adaptive threshold -> CCL -> quad filter -> warp.

Every step here must stay reproducible in ~100 lines of TS: no exotic OpenCV
calls, just box-filtering via an integral image, connected components,
convex hull, approxPolyDP and a perspective warp.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Optional

import cv2
import numpy as np

from . import config as C
from .geometry import order_quad, polygon_area, warp_card


@dataclass
class CardCandidate:
    quad: np.ndarray  # 4x2 float32, ordered TL,TR,BR,BL, in ORIGINAL image coordinates
    area: float  # in downscaled-image pixel units, used only for median filtering
    warped: Optional[np.ndarray] = None


@dataclass
class DetectionDebug:
    small_bgr: np.ndarray = None
    gray: np.ndarray = None
    mask: np.ndarray = None
    labels: np.ndarray = None
    all_candidates: list = field(default_factory=list)  # quads (downscaled coords) before median filter
    rejected_border: list = field(default_factory=list)
    rejected_aspect: list = field(default_factory=list)
    rejected_median: list = field(default_factory=list)


def downscale(image: np.ndarray, long_edge: int = C.DOWNSCALE_LONG_EDGE):
    h, w = image.shape[:2]
    scale = long_edge / max(h, w)
    if scale >= 1.0:
        return image.copy(), 1.0
    out_w, out_h = int(round(w * scale)), int(round(h * scale))
    small = cv2.resize(image, (out_w, out_h), interpolation=cv2.INTER_AREA)
    return small, scale


def box_mean(gray: np.ndarray, window: int) -> np.ndarray:
    """Local mean via a summed-area table (integral image)."""
    h, w = gray.shape
    r = window // 2
    integral = cv2.integral(gray.astype(np.float64))  # (h+1, w+1)
    ys = np.arange(h)
    xs = np.arange(w)
    y0 = np.clip(ys - r, 0, h)[:, None]
    y1 = np.clip(ys + r + 1, 0, h)[:, None]
    x0 = np.clip(xs - r, 0, w)[None, :]
    x1 = np.clip(xs + r + 1, 0, w)[None, :]
    total = integral[y1, x1] - integral[y0, x1] - integral[y1, x0] + integral[y0, x0]
    count = (y1 - y0) * (x1 - x0)
    return total / count


def adaptive_card_mask(gray: np.ndarray) -> np.ndarray:
    """Bright-relative-to-neighbourhood mask: cards are brighter than the table around them."""
    long_edge = max(gray.shape)
    window = max(3, int(long_edge * C.ADAPTIVE_THRESH_WINDOW_FRACTION))
    if window % 2 == 0:
        window += 1
    local_mean = box_mean(gray, window)
    mask = (gray.astype(np.float64) > (local_mean + C.ADAPTIVE_THRESH_C)).astype(np.uint8) * 255
    return mask


def _approx_quad(contour) -> Optional[np.ndarray]:
    hull = cv2.convexHull(contour)
    perimeter = cv2.arcLength(hull, True)
    if perimeter <= 0:
        return None
    for factor in C.APPROX_POLY_EPSILON_FACTORS:
        approx = cv2.approxPolyDP(hull, factor * perimeter, True)
        if len(approx) == 4:
            return approx.reshape(4, 2).astype(np.float32)
    return None


def _touches_border(quad: np.ndarray, w: int, h: int, margin: int = C.BORDER_MARGIN_PX) -> bool:
    x = quad[:, 0]
    y = quad[:, 1]
    return bool(
        np.any(x <= margin) or np.any(y <= margin)
        or np.any(x >= w - 1 - margin) or np.any(y >= h - 1 - margin)
    )


def _aspect_ok(quad: np.ndarray) -> bool:
    ordered = order_quad(quad)
    tl, tr, br, bl = ordered
    width = (np.linalg.norm(tr - tl) + np.linalg.norm(br - bl)) / 2
    height = (np.linalg.norm(bl - tl) + np.linalg.norm(br - tr)) / 2
    if width <= 0 or height <= 0:
        return False
    ratio = max(width, height) / min(width, height)
    lo = C.CARD_ASPECT_RATIO * (1 - C.CARD_ASPECT_TOLERANCE)
    hi = C.CARD_ASPECT_RATIO * (1 + C.CARD_ASPECT_TOLERANCE)
    return lo <= ratio <= hi


def find_card_candidates(mask: np.ndarray, debug: Optional[DetectionDebug] = None) -> list[CardCandidate]:
    h, w = mask.shape
    num_labels, labels, stats, _ = cv2.connectedComponentsWithStats(mask, connectivity=8)
    if debug is not None:
        debug.labels = labels

    min_area = C.MIN_COMPONENT_AREA_FRACTION * (w * h)
    pre_median: list[CardCandidate] = []

    for label in range(1, num_labels):
        area_px = stats[label, cv2.CC_STAT_AREA]
        if area_px < min_area:
            continue
        component_mask = (labels == label).astype(np.uint8) * 255
        contours, _ = cv2.findContours(component_mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        if not contours:
            continue
        contour = max(contours, key=cv2.contourArea)
        quad = _approx_quad(contour)
        if quad is None:
            continue
        if debug is not None:
            debug.all_candidates.append(quad)
        if _touches_border(quad, w, h):
            if debug is not None:
                debug.rejected_border.append(quad)
            continue
        if not _aspect_ok(quad):
            if debug is not None:
                debug.rejected_aspect.append(quad)
            continue
        pre_median.append(CardCandidate(quad=order_quad(quad), area=polygon_area(quad)))

    if not pre_median:
        return []

    areas = np.array([c.area for c in pre_median])
    median_area = float(np.median(areas))
    lo = median_area * (1 - C.CARD_AREA_MEDIAN_TOLERANCE)
    hi = median_area * (1 + C.CARD_AREA_MEDIAN_TOLERANCE)

    result = []
    for cand in pre_median:
        if lo <= cand.area <= hi:
            result.append(cand)
        elif debug is not None:
            debug.rejected_median.append(cand.quad)
    return result


def detect_cards(image_bgr: np.ndarray, debug: Optional[DetectionDebug] = None) -> list[CardCandidate]:
    """Full pipeline: returns candidates with quads in ORIGINAL image coordinates and warped canonical cards."""
    small, scale = downscale(image_bgr)
    gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
    mask = adaptive_card_mask(gray)

    if debug is not None:
        debug.small_bgr = small
        debug.gray = gray
        debug.mask = mask

    candidates = find_card_candidates(mask, debug=debug)

    out = []
    for cand in candidates:
        full_res_quad = cand.quad / scale
        warped = warp_card(image_bgr, full_res_quad, C.CANONICAL_CARD_W, C.CANONICAL_CARD_H)
        out.append(CardCandidate(quad=full_res_quad, area=cand.area, warped=warped))
    return out
