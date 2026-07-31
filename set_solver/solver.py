"""Trivial brute-force Set search: all 3-combinations, per-attribute all-same or all-different."""
from __future__ import annotations

from itertools import combinations


def is_set(a: str, b: str, c: str) -> bool:
    # A "?" is a placeholder for an attribute the classifier couldn't read,
    # not a wildcard -- without this check, two unclassified cards would
    # spuriously "match" each other (every '?' compares equal) and produce a
    # Set that was never actually verified.
    if "?" in a or "?" in b or "?" in c:
        return False
    for idx in range(4):
        values = {a[idx], b[idx], c[idx]}
        if len(values) == 2:
            return False
    return True


def find_sets(labels: list[str]) -> list[tuple[int, int, int]]:
    """Indices (into `labels`) of every valid Set among all 3-combinations."""
    return [
        (i, j, k)
        for i, j, k in combinations(range(len(labels)), 3)
        if is_set(labels[i], labels[j], labels[k])
    ]
