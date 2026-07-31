from set_solver.labels import Label, all_labels


def test_all_labels_is_a_full_deck():
    labels = all_labels()
    assert len(labels) == 81
    assert len(set(str(l) for l in labels)) == 81


def test_label_parse_roundtrip():
    for label in all_labels():
        assert Label.parse(str(label)) == label


def test_label_parse_rejects_bad_input():
    import pytest

    with pytest.raises(ValueError):
        Label.parse("1RDX")
    with pytest.raises(ValueError):
        Label.parse("1RD")
