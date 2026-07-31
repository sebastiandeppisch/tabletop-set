"""Characterization test: detection only (no classification) on synthetic scenes.

Kept separate from classification on purpose: a slipped quad would otherwise
cascade into five attribute errors and hide which stage actually broke.
"""
import random

import pytest

from set_solver.detection import detect_cards
from set_solver.geometry import quad_iou
from set_solver.synth import compose_scene, full_deck

MIN_IOU = 0.85


def _match_candidates(candidates, placed):
    """Greedy best-IoU matching; returns list of (candidate, placed, iou)."""
    remaining = list(range(len(placed)))
    matches = []
    for cand in candidates:
        best_iou, best_idx = 0.0, -1
        for i in remaining:
            iou = quad_iou(cand.quad, placed[i].quad)
            if iou > best_iou:
                best_iou, best_idx = iou, i
        if best_idx >= 0:
            remaining.remove(best_idx)
        matches.append((cand, best_idx, best_iou))
    return matches


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_all_placed_cards_are_found(seed):
    deck = full_deck()
    rng = random.Random(seed)
    sample = rng.sample(deck, 15)
    scene, placed = compose_scene(sample, seed=seed)

    candidates = detect_cards(scene)
    assert len(candidates) == len(placed), (
        f"seed {seed}: placed {len(placed)} cards, detected {len(candidates)}"
    )


@pytest.mark.parametrize("seed", [1, 2, 3, 4, 5])
def test_detected_quads_match_ground_truth_within_iou(seed):
    deck = full_deck()
    rng = random.Random(seed)
    sample = rng.sample(deck, 15)
    scene, placed = compose_scene(sample, seed=seed)

    candidates = detect_cards(scene)
    matches = _match_candidates(candidates, placed)
    low_iou = [(i, iou) for i, (_, _, iou) in enumerate(matches) if iou < MIN_IOU]
    assert not low_iou, f"seed {seed}: quads below IoU {MIN_IOU}: {low_iou}"


def test_no_spurious_detections_on_empty_table():
    from set_solver.synth import compose_scene

    scene, placed = compose_scene([], seed=99)
    assert placed == []
    candidates = detect_cards(scene)
    assert candidates == []
