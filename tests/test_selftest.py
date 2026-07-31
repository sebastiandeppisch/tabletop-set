from set_solver.io_format import CardRecord, ImageResult
from set_solver.labels import all_labels
from set_solver.selftest import run_selftest


def test_full_unique_deck_has_no_duplicates():
    results = [
        ImageResult(img="a.jpg", cards=[CardRecord(quad=[[0, 0]] * 4, label=str(l)) for l in all_labels()])
    ]
    report = run_selftest(results, expect_full_deck=True)
    assert report.ok
    assert report.total_cards == 81
    assert report.missing_labels == []


def test_duplicate_label_across_images_is_caught():
    results = [
        ImageResult(img="a.jpg", cards=[CardRecord(quad=[[0, 0]] * 4, label="1RDF")]),
        ImageResult(img="b.jpg", cards=[CardRecord(quad=[[0, 0]] * 4, label="1RDF")]),
    ]
    report = run_selftest(results)
    assert not report.ok
    assert "1RDF" in report.duplicates
    assert report.duplicates["1RDF"] == [("a.jpg", 0), ("b.jpg", 0)]


def test_unclassified_cards_are_reported_separately_not_as_duplicates():
    results = [
        ImageResult(img="a.jpg", cards=[
            CardRecord(quad=[[0, 0]] * 4, label="????"),
            CardRecord(quad=[[0, 0]] * 4, label="????"),
        ]),
    ]
    report = run_selftest(results)
    assert report.ok  # unclassified cards must not count as duplicates of each other
    assert len(report.unclassified) == 2
