"""Tests for the normalization invariants documented in CLAUDE.md."""

from corpus.ingestion.normalize import normalize_gloss, normalize_surface, tokenize


def test_casefold():
    assert normalize_surface("Kilim") == "kilim"
    assert normalize_surface("MAINU") == "mainu"


def test_edge_punctuation_stripped():
    assert normalize_surface("mainu.") == "mainu"
    assert normalize_surface(".mainu") == "mainu"
    assert normalize_surface('"kilim"') == "kilim"


def test_internal_punctuation_preserved():
    # The apostrophe in lj' is phonemically significant
    assert "'" in normalize_surface("lj'u")


def test_diacritics_preserved():
    # Phonemic diacritics must NOT be stripped
    assert normalize_surface("ʉ") == "ʉ"
    assert normalize_surface("ɬ") == "ɬ"


def test_nfc_normalization():
    # Composed vs decomposed forms should produce the same surface_norm
    import unicodedata

    composed = "á"
    decomposed = unicodedata.normalize("NFD", composed)
    assert normalize_surface(composed) == normalize_surface(decomposed)


def test_none_and_empty():
    assert normalize_surface(None) == ""
    assert normalize_surface("") == ""


def test_tokenize_basic():
    assert tokenize("Kilim ku tamdaw") == ["Kilim", "ku", "tamdaw"]


def test_tokenize_empty():
    assert tokenize("") == []
    assert tokenize(None) == []


def test_tokenize_filters_punctuation_only():
    # Chunks with no alphanumeric chars are dropped
    assert tokenize("hello . world") == ["hello", "world"]


def test_tokenize_token_count_invariant(db, sentence_with_tokens):
    """Sentence.token_count must equal len(tokenize(form_standard))."""
    sentence, _ = sentence_with_tokens
    form = sentence.form_standard or sentence.form_original
    assert sentence.token_count == len(tokenize(form))


def test_normalize_gloss():
    assert normalize_gloss("Looking for") == "looking for"
    assert normalize_gloss("  extra  spaces  ") == "extra spaces"
