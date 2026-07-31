import random

import cv2

from set_solver.cli import main
from set_solver.synth import compose_scene, full_deck


def test_cli_runs_end_to_end_on_a_synthetic_image(tmp_path):
    deck = full_deck()
    rng = random.Random(11)
    sample = rng.sample(deck, 6)
    scene, _ = compose_scene(sample, seed=11)

    img_path = tmp_path / "scene.jpg"
    cv2.imwrite(str(img_path), scene)
    out_dir = tmp_path / "out"

    exit_code = main([str(img_path), "--out", str(out_dir), "--debug"])
    assert exit_code == 0

    assert (out_dir / "scene.json").exists()
    assert (out_dir / "scene_annotated.png").exists()
    assert (out_dir / "contact_sheet.png").exists()
    assert (out_dir / "selftest.txt").exists()
    assert (out_dir / "debug" / "scene" / "02_threshold_mask.png").exists()
