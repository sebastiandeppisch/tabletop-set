import json

from set_solver.io_format import CardRecord, ImageResult, read_json, write_json


def test_write_json_matches_spec_schema(tmp_path):
    result = ImageResult(
        img="IMG_0042.jpg",
        cards=[CardRecord(quad=[[120, 88], [310, 95], [305, 340], [115, 332]], label="2PWS")],
    )
    path = tmp_path / "IMG_0042.json"
    write_json(result, path)

    data = json.loads(path.read_text())
    assert data["img"] == "IMG_0042.jpg"
    assert data["cards"][0]["label"] == "2PWS"
    assert data["cards"][0]["quad"] == [[120.0, 88.0], [310.0, 95.0], [305.0, 340.0], [115.0, 332.0]]


def test_read_json_roundtrip(tmp_path):
    result = ImageResult(
        img="foo.jpg",
        cards=[CardRecord(quad=[[0, 0], [1, 0], [1, 1], [0, 1]], label="1RDF")],
    )
    path = tmp_path / "foo.json"
    write_json(result, path)

    loaded = read_json(path)
    assert loaded.img == "foo.jpg"
    assert loaded.cards[0].label == "1RDF"
