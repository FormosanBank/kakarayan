import json
from pathlib import Path

from publisher.audio_sources import load_audio_sources
from publisher.xml_records import discover_xml, project_xml


def test_projection_preserves_tiers_and_canonical_counting(public_repo: Path) -> None:
    [path] = list(discover_xml(public_repo))
    projection = project_xml(path, public_repo, load_audio_sources(public_repo))

    assert projection.source_path == "Corpora/TestCorpus/XML/fixture.xml"
    assert projection.counts == {
        "texts": 1,
        "sentences": 2,
        "words": 2,
        "morphemes": 1,
        "forms": 6,
        "phonology": 1,
        "translations": 4,
        "audio": 2,
        "tokens": 4,
    }
    text = projection.rows["texts"][0]
    assert text["language"] == "Amis"
    assert text["dialect"] == "Xiuguluan"
    assert len(str(text["source_sha256"])) == 64

    original = next(row for row in projection.rows["forms"] if row["kind"] == "original")
    assert original["text"] == "Lima waco"
    assert original["unclear"] is True

    sentence = projection.rows["sentences"][0]
    assert sentence["token_count"] == 2
    assert json.loads(projection.rows["audio"][1]["playback_urls"]) == [
        "https://huggingface.co/datasets/FormosanBank/TestCorpusAudio/resolve/"
        "1111111111111111111111111111111111111111/sentence.wav"
    ]
    assert [row["surface"] for row in projection.rows["tokens"]] == [
        "lima",
        "waco",
        "toki",
        "rima",
    ]
    assert {(row["owner_type"], row["text"]) for row in projection.rows["translations"]} == {
        ("sentence", "A fictional translated line."),
        ("sentence", "虛構測試句"),
        ("word", "five.word"),
        ("morpheme", "FIVE"),
    }


def test_truku_resolution_matches_canonical_rule(public_repo: Path) -> None:
    [path] = list(discover_xml(public_repo))
    text = path.read_text(encoding="utf-8")
    path.write_text(
        text.replace('xml:lang="ami"', 'xml:lang="trv"').replace(
            'dialect="Xiuguluan"', 'dialect="Truku"'
        ),
        encoding="utf-8",
    )
    projection = project_xml(path, public_repo)
    assert projection.rows["texts"][0]["language"] == "Truku"


def test_projection_preserves_display_punctuation_but_normalizes_frequency_tokens(
    public_repo: Path,
) -> None:
    [path] = list(discover_xml(public_repo))
    text = path.read_text(encoding="utf-8")
    path.write_text(
        text.replace(
            '<W id="w-one" class="noun">\n      <FORM kindOf="standard">lima</FORM>',
            '<W id="w-one" class="noun">\n      <FORM kindOf="standard">lima,</FORM>',
        ),
        encoding="utf-8",
    )

    projection = project_xml(path, public_repo)
    word = projection.rows["words"][0]
    form = next(
        row
        for row in projection.rows["forms"]
        if row["owner_id"] == word["id"] and row["kind"] == "standard"
    )
    token = next(row for row in projection.rows["tokens"] if row["word_id"] == word["id"])

    assert form["text"] == "lima,"
    assert form["normalized"] == "lima"
    assert token["surface"] == "lima,"
    assert token["normalized"] == "lima"
