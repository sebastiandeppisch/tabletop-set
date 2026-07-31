from set_solver.solver import find_sets, is_set


def test_is_set_all_same():
    assert is_set("1RDF", "1RDF", "1RDF") is True  # all attributes identical is a valid Set pattern
    assert is_set("1RDF", "2RDF", "3RDF") is True  # count differs, rest same


def test_is_set_all_different():
    assert is_set("1RDF", "2GEE", "3PWS") is True


def test_is_set_two_same_one_different_is_not_a_set():
    assert is_set("1RDF", "1RDF", "2RDF") is False
    assert is_set("1RDF", "2RDF", "2GDF") is False


def test_is_set_rejects_any_triple_involving_an_unclassified_card():
    # every attribute position has 3 distinct values ('?' counts as a third),
    # which the naive all-different check would wrongly accept
    assert is_set("????", "1GDF", "2PWE") is False
    assert is_set("1RDF", "????", "2GEE") is False
    assert is_set("????", "????", "1RDF") is False


def test_find_sets_counts_all_valid_triples():
    labels = ["1RDF", "2RDF", "3RDF", "1GEF"]
    result = find_sets(labels)
    assert (0, 1, 2) in result
    assert len(result) == 1


def test_find_sets_never_returns_a_triple_containing_an_unclassified_card():
    labels = ["1RDF", "2GEE", "3PWS", "????"]
    assert find_sets(labels) == [(0, 1, 2)]
