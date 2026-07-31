"""Ground-truth-free self-test: a Set deck has 81 cards, each label exactly once.

Two identically-labelled cards in the same deck are proof that at least one
of them was misclassified — no manual labelling needed to find this, and it
catches exactly the confusions that slip past visual review.
"""
from __future__ import annotations

from collections import defaultdict
from dataclasses import dataclass, field

from .io_format import ImageResult
from .labels import all_labels


@dataclass
class SelfTestReport:
    total_cards: int
    duplicates: dict = field(default_factory=dict)  # label -> [(img, card_index), ...]
    unclassified: list = field(default_factory=list)  # [(img, card_index)]
    missing_labels: list = field(default_factory=list)  # labels never seen, only useful for a full 81-card deck

    @property
    def ok(self) -> bool:
        return not self.duplicates

    def format(self) -> str:
        lines = [f"Self-test over {self.total_cards} cards:"]
        if self.duplicates:
            lines.append(f"  {len(self.duplicates)} duplicate label(s) -- at least one misclassification each:")
            for label, occurrences in sorted(self.duplicates.items()):
                where = ", ".join(f"{img}#{idx}" for img, idx in occurrences)
                lines.append(f"    {label}: {where}")
        else:
            lines.append("  no duplicate labels.")
        if self.unclassified:
            lines.append(f"  {len(self.unclassified)} card(s) left unclassified:")
            for img, idx in self.unclassified:
                lines.append(f"    {img}#{idx}")
        if self.missing_labels:
            lines.append(f"  {len(self.missing_labels)} deck label(s) never observed: {', '.join(self.missing_labels)}")
        return "\n".join(lines)


def run_selftest(results: list[ImageResult], expect_full_deck: bool = False) -> SelfTestReport:
    occurrences = defaultdict(list)
    unclassified = []
    total = 0

    for result in results:
        for idx, card in enumerate(result.cards):
            total += 1
            if "?" in card.label:
                unclassified.append((result.img, idx))
                continue
            occurrences[card.label].append((result.img, idx))

    duplicates = {label: locs for label, locs in occurrences.items() if len(locs) > 1}

    missing = []
    if expect_full_deck:
        seen = set(occurrences.keys())
        missing = [str(l) for l in all_labels() if str(l) not in seen]

    return SelfTestReport(
        total_cards=total,
        duplicates=duplicates,
        unclassified=unclassified,
        missing_labels=missing,
    )
