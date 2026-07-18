"""Tests for the dictionary query helper functions."""

import pytest

from corpus.models import Token, Translation
from corpus.views.dictionary import (
    MIN_Q_MEANING,
    MIN_Q_WORD,
    _XML_LANG_EN,
    _XML_LANG_ZH,
    _assemble_dict_results,
    _run_search_meaning,
    _run_search_word,
)


@pytest.mark.django_db
class TestRunSearchWord:
    def test_prefix_match(self, sentence_with_tokens):
        _, token = sentence_with_tokens
        qs = _run_search_word("kili", "", "")
        assert qs.filter(pk=token.pk).exists()

    def test_exact_match(self, sentence_with_tokens):
        _, token = sentence_with_tokens
        qs = _run_search_word("kilim", "", "")
        assert qs.filter(pk=token.pk).exists()

    def test_no_match(self, sentence_with_tokens):
        qs = _run_search_word("zzzzz", "", "")
        assert not qs.exists()

    def test_short_query_returns_none(self, sentence_with_tokens):
        q = "k" * (MIN_Q_WORD - 1)
        assert not _run_search_word(q, "", "").exists()

    def test_empty_query_returns_none(self, db):
        assert not _run_search_word("", "", "").exists()

    def test_language_filter_match(self, sentence_with_tokens, amis):
        _, token = sentence_with_tokens
        qs = _run_search_word("ki", amis.name, "")
        assert qs.filter(pk=token.pk).exists()

    def test_language_filter_no_match(self, sentence_with_tokens, atayal):
        qs = _run_search_word("ki", atayal.name, "")
        assert not qs.exists()

    def test_corpus_filter_match(self, sentence_with_tokens, corpus_a):
        _, token = sentence_with_tokens
        qs = _run_search_word("ki", "", corpus_a.name)
        assert qs.filter(pk=token.pk).exists()

    def test_corpus_filter_no_match(self, sentence_with_tokens):
        qs = _run_search_word("ki", "", "NonexistentCorpus")
        assert not qs.exists()


@pytest.mark.django_db
class TestRunSearchMeaning:
    def test_english_match(self, sentence_with_tokens):
        # xml_lang='eng' matches ISO 639-3 code stored in the corpus
        qs = _run_search_meaning("looking for", "", "", _XML_LANG_EN)
        assert qs.exists()

    def test_chinese_match(self, sentence_with_tokens):
        qs = _run_search_meaning("找", "", "", _XML_LANG_ZH)
        assert qs.exists()

    def test_short_query_returns_none(self, db):
        q = "a" * (MIN_Q_MEANING - 1)
        assert not _run_search_meaning(q, "", "", _XML_LANG_EN).exists()

    def test_wrong_lang_returns_none(self, sentence_with_tokens):
        # Searching "looking for" in zho scope won't match the eng translation
        qs = _run_search_meaning("looking for", "", "", _XML_LANG_ZH)
        assert not qs.exists()

    def test_language_filter(self, sentence_with_tokens, amis, atayal):
        qs_match = _run_search_meaning("looking for", amis.name, "", _XML_LANG_EN)
        assert qs_match.exists()
        qs_no_match = _run_search_meaning("looking for", atayal.name, "", _XML_LANG_EN)
        assert not qs_no_match.exists()


@pytest.mark.django_db
class TestDistinctOnDict:
    def test_two_tokens_same_surface_norm_gives_one_result(
        self, sentence_with_tokens, amis, dialect_amis, corpus_a
    ):
        """DISTINCT ON (surface_norm, language_id) must deduplicate identical keys."""
        sentence, token = sentence_with_tokens
        Token.objects.create(
            sentence=sentence,
            surface_norm="kilim",
            surface_standard="kilim",
            language=amis,
            dialect=dialect_amis,
            corpus=corpus_a,
            position=5,
        )
        qs = _run_search_word("kilim", "", "")
        results, total_count, total_pages = _assemble_dict_results(qs, page=1, preferred_lang=_XML_LANG_EN)
        kilim_results = [r for r in results if r['token'].surface_norm == "kilim"]
        assert len(kilim_results) == 1

    def test_pagination_returns_different_rows(self, db, amis, dialect_amis, corpus_a, run):
        """Page 2 must not overlap with page 1."""
        from corpus.models import Sentence as S
        from corpus.models import Text
        from corpus.views.dictionary import PAGE_SIZE_DICT

        text = Text.objects.create(
            corpus=corpus_a, language=amis, dialect=dialect_amis,
            ingestion_run=run, text_xml_id="p-test", source_path="p/test.xml", xml_lang="ami",
        )
        for i in range(PAGE_SIZE_DICT + 5):
            surface = f"word{i:03d}"
            sentence = S.objects.create(text=text, sentence_xml_id=f"p.s{i}", position=i, token_count=1)
            Token.objects.create(
                sentence=sentence, surface_norm=surface, surface_standard=surface,
                language=amis, dialect=dialect_amis, corpus=corpus_a, position=0,
            )

        qs = _run_search_word("word", "", "")
        p1, total_count, total_pages = _assemble_dict_results(qs, page=1, preferred_lang=_XML_LANG_EN)
        p2, _, _ = _assemble_dict_results(qs, page=2, preferred_lang=_XML_LANG_EN)

        assert total_count == PAGE_SIZE_DICT + 5
        assert total_pages == 2
        p1_ids = {r['token'].pk for r in p1}
        p2_ids = {r['token'].pk for r in p2}
        assert p1_ids.isdisjoint(p2_ids)

