"""End-to-end integration: detect + classify + solve on a synthetic scene."""
import random

from set_solver.classify import classify_card
from set_solver.detection import detect_cards
from set_solver.geometry import quad_iou
from set_solver.solver import find_sets
from set_solver.synth import compose_scene, full_deck

MIN_LABEL_ACCURACY = 0.9  # perspective + noise degrade a small minority of borderline symbols


def test_pipeline_labels_mostly_match_ground_truth_end_to_end():
    deck = full_deck()
    rng = random.Random(7)
    sample = rng.sample(deck, 15)
    scene, placed = compose_scene(sample, seed=7)

    candidates = detect_cards(scene)
    assert len(candidates) == len(placed)

    remaining = list(range(len(placed)))
    correct = 0
    for cand in candidates:
        best_iou, best_idx = 0.0, -1
        for i in remaining:
            iou = quad_iou(cand.quad, placed[i].quad)
            if iou > best_iou:
                best_iou, best_idx = iou, i
        remaining.remove(best_idx)
        attrs = classify_card(cand.warped)
        if attrs.label() == str(placed[best_idx].label):
            correct += 1

    accuracy = correct / len(placed)
    assert accuracy >= MIN_LABEL_ACCURACY, f"end-to-end label accuracy {accuracy:.2f} below {MIN_LABEL_ACCURACY}"


def test_solver_finds_known_set_planted_in_a_scene():
    # 1RDF, 2GDF, 3PDF: count all-different, color all-different, shape all-same, fill all-same -> valid Set
    from set_solver.labels import Label

    planted = [Label.parse("1RDF"), Label.parse("2GDF"), Label.parse("3PDF"), Label.parse("1GES")]
    scene, placed = compose_scene(planted, seed=3)
    candidates = detect_cards(scene)
    labels = [classify_card(c.warped).label() for c in candidates]

    sets_found = find_sets(labels)
    label_sets = [tuple(sorted(labels[i] for i in triple)) for triple in sets_found]
    assert tuple(sorted(["1RDF", "2GDF", "3PDF"])) in label_sets
