"""4-character Set card label: Count(1-3) Color(R/G/P) Shape(D/E/W) Fill(S/F/E)."""
from __future__ import annotations

from dataclasses import dataclass

COLORS = ("R", "G", "P")  # Red, Green, Purple
SHAPES = ("D", "E", "W")  # Diamond, Ellipse, Wave
FILLS = ("S", "F", "E")  # Striped, Full, Empty
COUNTS = ("1", "2", "3")


@dataclass(frozen=True)
class Label:
    count: str
    color: str
    shape: str
    fill: str

    def __str__(self) -> str:
        return f"{self.count}{self.color}{self.shape}{self.fill}"

    @staticmethod
    def parse(s: str) -> "Label":
        if len(s) != 4:
            raise ValueError(f"label must be 4 chars, got {s!r}")
        count, color, shape, fill = s[0], s[1], s[2], s[3]
        if count not in COUNTS:
            raise ValueError(f"bad count in {s!r}")
        if color not in COLORS:
            raise ValueError(f"bad color in {s!r}")
        if shape not in SHAPES:
            raise ValueError(f"bad shape in {s!r}")
        if fill not in FILLS:
            raise ValueError(f"bad fill in {s!r}")
        return Label(count, color, shape, fill)


def all_labels() -> list[Label]:
    """All 81 valid combinations, one full Set deck."""
    return [
        Label(c, co, sh, f)
        for c in COUNTS
        for co in COLORS
        for sh in SHAPES
        for f in FILLS
    ]
