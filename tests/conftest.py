import random

import pytest

from set_solver.labels import all_labels
from set_solver.synth import compose_scene, render_card


@pytest.fixture(scope="session")
def deck():
    return all_labels()


@pytest.fixture(scope="session")
def single_card_renders(deck):
    return {str(label): render_card(label) for label in deck}


@pytest.fixture(scope="session")
def synthetic_scene(deck):
    rng = random.Random(7)
    sample = rng.sample(deck, 15)
    scene, placed = compose_scene(sample, seed=7)
    return scene, placed
