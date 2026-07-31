from publisher.identifiers import dimension_id, record_id


def test_record_identifier_is_stable_and_scoped() -> None:
    first = record_id(
        "sentence",
        corpus="Example",
        source_path="Corpora/Example/XML/a.xml",
        local_id="S1",
        ordinal=0,
    )
    same = record_id(
        "sentence",
        corpus="Example",
        source_path="Corpora/Example/XML/a.xml",
        local_id="S1",
        ordinal=0,
    )
    other_file = record_id(
        "sentence",
        corpus="Example",
        source_path="Corpora/Example/XML/b.xml",
        local_id="S1",
        ordinal=0,
    )
    assert first == same
    assert first != other_file
    assert first.startswith("sentence_")


def test_dimension_identifier_is_readable() -> None:
    assert dimension_id("Language", "Traditional Name") == "language_traditional_name"
