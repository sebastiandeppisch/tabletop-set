"""JSON read/write for the spec's data format:

    {"img": "IMG_0042.jpg", "cards": [
        {"quad": [[120,88],[310,95],[305,340],[115,332]], "label": "2PWS"}
    ]}

Kept deliberately tiny: this is the one format humans hand-correct.
"""
from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path

import numpy as np


@dataclass
class CardRecord:
    quad: list  # 4 x [x, y]
    label: str


@dataclass
class ImageResult:
    img: str
    cards: list[CardRecord]


def to_jsonable(result: ImageResult) -> dict:
    return {
        "img": result.img,
        "cards": [
            {"quad": [[float(x), float(y)] for x, y in c.quad], "label": c.label}
            for c in result.cards
        ],
    }


def write_json(result: ImageResult, path: Path) -> None:
    path.write_text(json.dumps(to_jsonable(result), indent=2))


def write_json_many(results: list[ImageResult], path: Path) -> None:
    path.write_text(json.dumps([to_jsonable(r) for r in results], indent=2))


def read_json(path: Path) -> ImageResult:
    data = json.loads(Path(path).read_text())
    return _result_from_dict(data)


def read_json_many(path: Path) -> list[ImageResult]:
    data = json.loads(Path(path).read_text())
    if isinstance(data, dict):
        return [_result_from_dict(data)]
    return [_result_from_dict(d) for d in data]


def _result_from_dict(data: dict) -> ImageResult:
    cards = [CardRecord(quad=np.array(c["quad"], dtype=np.float32), label=c["label"]) for c in data["cards"]]
    return ImageResult(img=data["img"], cards=cards)
