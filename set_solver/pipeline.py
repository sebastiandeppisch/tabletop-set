"""End-to-end: image/directory -> detect -> classify -> solve -> ImageResult(+attrs for overlays)."""
from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path

import cv2

from .classify import CardAttributes, classify_card
from .detection import CardCandidate, DetectionDebug, detect_cards
from .io_format import CardRecord, ImageResult
from .solver import find_sets

IMAGE_EXTENSIONS = {".jpg", ".jpeg", ".png", ".bmp", ".tif", ".tiff"}


@dataclass
class ProcessedImage:
    result: ImageResult
    candidates: list[CardCandidate]
    attributes: list[CardAttributes]
    sets: list[tuple[int, int, int]]
    debug: DetectionDebug | None = None


def process_image(path: Path, debug: bool = False) -> ProcessedImage:
    image = cv2.imread(str(path))
    if image is None:
        raise FileNotFoundError(f"could not read image: {path}")

    debug_obj = DetectionDebug() if debug else None
    candidates = detect_cards(image, debug=debug_obj)
    attributes = [classify_card(c.warped) for c in candidates]
    labels = [a.label() for a in attributes]
    sets = find_sets(labels)

    cards = [CardRecord(quad=c.quad, label=label) for c, label in zip(candidates, labels)]
    result = ImageResult(img=path.name, cards=cards)
    return ProcessedImage(result=result, candidates=candidates, attributes=attributes, sets=sets, debug=debug_obj)


def iter_image_paths(input_path: Path) -> list[Path]:
    if input_path.is_dir():
        return sorted(p for p in input_path.iterdir() if p.suffix.lower() in IMAGE_EXTENSIONS)
    return [input_path]


def process_path(input_path: Path, debug: bool = False) -> list[ProcessedImage]:
    return [process_image(p, debug=debug) for p in iter_image_paths(input_path)]
