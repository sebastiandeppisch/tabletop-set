from set_solver.solver import find_sets, is_set


def test_is_set_all_same():
    assert is_set("1RDF", "1RDF", "1RDF") is True  # all attributes identical is a valid Set pattern
    assert is_set("1RDF", "2RDF", "3RDF") is True  # count differs, rest same


def test_is_set_all_different():
    assert is_set("1RDF", "2GEE", "3PWS") is True


def test_is_set_two_same_one_different_is_not_a_set():
    assert is_set("1RDF", "1RDF", "2RDF") is False
    assert is_set("1RDF", "2RDF", "2GDF") is False


def test_find_sets_counts_all_valid_triples():
    labels = ["1RDF", "2RDF", "3RDF", "1GEF"]
    result = find_sets(labels)
    assert (0, 1, 2) in result
    assert len(result) == 1
