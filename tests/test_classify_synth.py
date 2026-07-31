"""Characterization test: classification accuracy on the synthetic deck.

Per-attribute assertions, not per-card -- a report like "fill: 2 errors, all
striped->full" points straight at what to retune, where a single "card
wrong" count would not.
"""
from collections import Counter

from set_solver.classify import classify_card
from set_solver.labels import Label


def _classify_all(single_card_renders):
    rows = []
    for label_str, img in single_card_renders.items():
        label = Label.parse(label_str)
        attrs = classify_card(img)
        rows.append((label, attrs))
    return rows


def test_count_is_exact_on_every_synthetic_card(single_card_renders):
    errors = []
    for label, attrs in _classify_all(single_card_renders):
        if attrs.count != int(label.count):
            errors.append((str(label), attrs.count))
    assert not errors, f"count errors: {errors}"


def test_shape_is_exact_on_every_synthetic_card(single_card_renders):
    errors = []
    for label, attrs in _classify_all(single_card_renders):
        if attrs.shape != label.shape:
            errors.append(f"{label} -> {attrs.shape}")
    assert not errors, f"shape errors ({len(errors)}): {Counter(errors)}"


def test_color_is_exact_on_every_synthetic_card(single_card_renders):
    errors = []
    for label, attrs in _classify_all(single_card_renders):
        if attrs.color != label.color:
            errors.append(f"{label} -> {attrs.color}")
    assert not errors, f"color errors ({len(errors)}): {Counter(errors)}"


def test_fill_is_exact_on_every_synthetic_card(single_card_renders):
    errors = []
    for label, attrs in _classify_all(single_card_renders):
        if attrs.fill != label.fill:
            errors.append(f"{label} -> {attrs.fill}")
    assert not errors, f"fill errors ({len(errors)}): {Counter(errors)}"


def test_full_label_matches_on_every_synthetic_card(single_card_renders):
    errors = []
    for label_str, img in single_card_renders.items():
        attrs = classify_card(img)
        if attrs.label() != label_str:
            errors.append(f"{label_str} -> {attrs.label()}")
    assert not errors, f"label errors ({len(errors)}/81): {errors}"
