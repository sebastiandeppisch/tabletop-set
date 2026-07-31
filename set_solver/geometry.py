"""Quad ordering, area/IoU and perspective warp — all reproducible in ~10 lines of TS each."""
from __future__ import annotations

import cv2
import numpy as np


def order_quad(pts) -> np.ndarray:
    """Return the 4 points ordered TL, TR, BR, BL."""
    pts = np.asarray(pts, dtype=np.float32).reshape(4, 2)
    s = pts.sum(axis=1)
    diff = (pts[:, 0] - pts[:, 1])
    tl = pts[np.argmin(s)]
    br = pts[np.argmax(s)]
    tr = pts[np.argmax(diff)]
    bl = pts[np.argmin(diff)]
    return np.array([tl, tr, br, bl], dtype=np.float32)


def polygon_area(pts) -> float:
    """Shoelace formula."""
    pts = np.asarray(pts, dtype=np.float64).reshape(-1, 2)
    x = pts[:, 0]
    y = pts[:, 1]
    return 0.5 * abs(np.dot(x, np.roll(y, -1)) - np.dot(y, np.roll(x, -1)))


def quad_iou(quad_a, quad_b) -> float:
    """Intersection-over-union of two convex quads. Test/eval helper only."""
    quad_a = np.asarray(quad_a, dtype=np.float32).reshape(-1, 1, 2)
    quad_b = np.asarray(quad_b, dtype=np.float32).reshape(-1, 1, 2)
    area_a = polygon_area(quad_a)
    area_b = polygon_area(quad_b)
    if area_a <= 0 or area_b <= 0:
        return 0.0
    inter_area, inter_pts = cv2.intersectConvexConvex(quad_a, quad_b)
    if inter_pts is None or inter_area <= 0:
        return 0.0
    union = area_a + area_b - inter_area
    if union <= 0:
        return 0.0
    return float(inter_area / union)


def warp_card(image, quad, out_w: int, out_h: int) -> np.ndarray:
    """Perspective-warp the quad (ordered TL,TR,BR,BL) onto an out_w x out_h canvas."""
    src = order_quad(quad)
    dst = np.array(
        [[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]],
        dtype=np.float32,
    )
    m = cv2.getPerspectiveTransform(src, dst)
    return cv2.warpPerspective(image, m, (out_w, out_h), flags=cv2.INTER_LINEAR)
