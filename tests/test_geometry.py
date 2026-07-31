import numpy as np

from set_solver.geometry import order_quad, polygon_area, quad_iou, warp_card


def test_order_quad_sorts_shuffled_corners():
    tl, tr, br, bl = [0, 0], [10, 0], [10, 20], [0, 20]
    shuffled = np.array([br, tl, bl, tr], dtype=np.float32)
    ordered = order_quad(shuffled)
    np.testing.assert_allclose(ordered, [tl, tr, br, bl])


def test_polygon_area_unit_square():
    square = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert polygon_area(square) == 100.0


def test_quad_iou_identical_is_one():
    quad = [[0, 0], [10, 0], [10, 10], [0, 10]]
    assert quad_iou(quad, quad) == 1.0


def test_quad_iou_disjoint_is_zero():
    a = [[0, 0], [10, 0], [10, 10], [0, 10]]
    b = [[100, 100], [110, 100], [110, 110], [100, 110]]
    assert quad_iou(a, b) == 0.0


def test_quad_iou_half_overlap():
    a = [[0, 0], [10, 0], [10, 10], [0, 10]]
    b = [[5, 0], [15, 0], [15, 10], [5, 10]]
    # intersection is a 5x10 rect = 50, union = 100+100-50 = 150
    assert abs(quad_iou(a, b) - 50 / 150) < 1e-6


def test_warp_card_produces_requested_canvas_size():
    image = np.zeros((100, 100, 3), dtype=np.uint8)
    quad = [[10, 10], [90, 10], [90, 90], [10, 90]]
    warped = warp_card(image, quad, 200, 130)
    assert warped.shape == (130, 200, 3)
