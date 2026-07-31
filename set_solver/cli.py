"""solve <bild-oder-ordner> [--out DIR] [--debug]"""
from __future__ import annotations

import argparse
import sys
from pathlib import Path

import cv2

from .io_format import write_json
from .overlay import build_contact_sheet, draw_detection_overlay, render_card_pair, write_debug_artifacts
from .pipeline import iter_image_paths, process_image
from .selftest import run_selftest


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="solve", description="Classical-CV Set card detector and solver")
    parser.add_argument("input", type=Path, help="image file or a directory of images")
    parser.add_argument("--out", type=Path, default=Path("out"), help="output directory (default: ./out)")
    parser.add_argument("--debug", action="store_true", help="dump intermediate pipeline stages")
    return parser


def main(argv: list[str] | None = None) -> int:
    args = build_parser().parse_args(argv)
    input_path: Path = args.input
    out_dir: Path = args.out
    out_dir.mkdir(parents=True, exist_ok=True)

    image_paths = iter_image_paths(input_path)
    if not image_paths:
        print(f"no images found at {input_path}", file=sys.stderr)
        return 1

    results = []
    card_pairs = []
    for path in image_paths:
        processed = process_image(path, debug=args.debug)
        results.append(processed.result)

        stem = path.stem
        write_json(processed.result, out_dir / f"{stem}.json")

        original = cv2.imread(str(path))
        annotated = draw_detection_overlay(original, processed)
        cv2.imwrite(str(out_dir / f"{stem}_annotated.png"), annotated)

        for cand, attrs in zip(processed.candidates, processed.attributes):
            card_pairs.append(render_card_pair(cand.warped, attrs))

        if args.debug:
            write_debug_artifacts(processed, out_dir / "debug" / stem)

        n_cards = len(processed.result.cards)
        n_sets = len(processed.sets)
        print(f"{path.name}: {n_cards} card(s), {n_sets} set(s)")

    if card_pairs:
        cv2.imwrite(str(out_dir / "contact_sheet.png"), build_contact_sheet(card_pairs))

    report = run_selftest(results, expect_full_deck=False)
    (out_dir / "selftest.txt").write_text(report.format())
    print(report.format())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
