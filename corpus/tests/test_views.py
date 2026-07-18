"""Tests for the dictionary views — HTTP and HTMX response behaviour."""

import pytest


HTMX_HEADERS = {"HTTP_HX_REQUEST": "true"}


@pytest.mark.django_db
class TestDictionaryIndex:
    def test_200(self, client):
        response = client.get("/")
        assert response.status_code == 200

    def test_full_page_html(self, client):
        response = client.get("/")
        assert b"<html" in response.content

    def test_search_form_present(self, client):
        content = client.get("/").content.decode()
        assert 'id="search-input"' in content

    def test_language_options_populated(self, client, amis):
        content = client.get("/").content.decode()
        assert amis.name in content

    def test_corpus_options_populated(self, client, corpus_a):
        content = client.get("/").content.decode()
        assert corpus_a.name in content

    def test_bookmarked_url_returns_results(self, client, sentence_with_tokens):
        response = client.get("/?q=ki&lang=Amis")
        assert response.status_code == 200
        content = response.content.decode()
        assert "<html" in content
        assert "dict-card" in content

    def test_bookmarked_url_short_query_shows_empty(self, client, sentence_with_tokens):
        content = client.get("/?q=k").content.decode()
        assert "kk-empty-state" in content

    def test_weave_divider_present(self, client):
        content = client.get("/").content.decode()
        assert "kk-weave-divider" in content

    def test_view_toggle_always_visible(self, client):
        # View toggle must appear on the page even without a search query
        content = client.get("/").content.decode()
        assert 'id="view-dict"' in content

    def test_force_search_trigger_in_input(self, client):
        content = client.get("/").content.decode()
        assert "force-search" in content


@pytest.mark.django_db
class TestDictionarySearch:
    def test_non_htmx_redirects(self, client):
        response = client.get("/search/?q=kilim")
        assert response.status_code == 302

    def test_htmx_returns_partial(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki", **HTMX_HEADERS)
        assert response.status_code == 200
        content = response.content.decode()
        assert "<html" not in content
        assert "dict-card" in content

    def test_short_query_empty_state(self, client, sentence_with_tokens):
        response = client.get("/search/?q=k", **HTMX_HEADERS)
        assert "kk-empty-state" in response.content.decode()

    def test_no_results(self, client, db):
        response = client.get("/search/?q=zzzzz", **HTMX_HEADERS)
        assert response.status_code == 200
        assert "kk-empty-state" in response.content.decode()

    def test_language_filter_match(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki&lang=Amis", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()

    def test_language_filter_no_match(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki&lang=Atayal", **HTMX_HEADERS)
        assert "kk-empty-state" in response.content.decode()

    def test_corpus_filter_match(self, client, sentence_with_tokens, corpus_a):
        response = client.get(f"/search/?q=ki&corpus={corpus_a.name}", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()

    def test_corpus_filter_no_match(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki&corpus=Nonexistent", **HTMX_HEADERS)
        assert "kk-empty-state" in response.content.decode()

    def test_concordance_view(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki&view=kwic", **HTMX_HEADERS)
        assert "concordance-row" in response.content.decode()

    def test_meaning_search_en(self, client, sentence_with_tokens):
        # fixture has xml_lang='eng' matching _XML_LANG_EN constant
        response = client.get("/search/?q=looking+for&dir=en", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()

    def test_meaning_search_zh(self, client, sentence_with_tokens):
        # Single CJK char is valid (min_len=1 for CJK); fixture has xml_lang='zho'
        # Must send zh Accept-Language so direction coercion allows dir=zh.
        response = client.get("/search/?q=找&dir=zh", **HTMX_HEADERS,
                              HTTP_ACCEPT_LANGUAGE="zh-Hant,zh;q=0.9")
        assert "dict-card" in response.content.decode()

    def test_meaning_short_query_empty(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ab&dir=en", **HTMX_HEADERS)
        assert "kk-empty-state" in response.content.decode()

    def test_result_includes_translation_text(self, client, sentence_with_tokens):
        # Cards should show the translation text, not just the word
        response = client.get("/search/?q=ki", **HTMX_HEADERS)
        assert "looking for a person" in response.content.decode()

    def test_pagination_shows_result_count(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki", **HTMX_HEADERS)
        content = response.content.decode()
        # Result count is shown above the list
        assert "kk-results-count" in content


@pytest.mark.django_db
class TestPagination:
    def _create_many_tokens(self, db, amis, dialect_amis, corpus_a, run, n):
        from corpus.models import Sentence, Text, Token
        text = Text.objects.create(
            corpus=corpus_a, language=amis, dialect=dialect_amis,
            ingestion_run=run, text_xml_id="pg-test", source_path="pg/test.xml", xml_lang="ami",
        )
        for i in range(n):
            surface = f"pgwd{i:04d}"
            sentence = Sentence.objects.create(text=text, sentence_xml_id=f"pg.s{i}", position=i, token_count=1)
            Token.objects.create(
                sentence=sentence, surface_norm=surface, surface_standard=surface,
                language=amis, dialect=dialect_amis, corpus=corpus_a, position=0,
            )

    def test_no_pagination_for_small_result_set(self, client, sentence_with_tokens):
        response = client.get("/search/?q=ki", **HTMX_HEADERS)
        content = response.content.decode()
        # Only 2 tokens in fixture, below page size — pagination nav absent
        assert "kk-pagination" not in content

    def test_pagination_nav_shown_for_large_result_set(
        self, client, db, amis, dialect_amis, corpus_a, run
    ):
        from corpus.views.dictionary import PAGE_SIZE_DICT
        self._create_many_tokens(db, amis, dialect_amis, corpus_a, run, PAGE_SIZE_DICT + 5)
        response = client.get("/search/?q=pgwd", **HTMX_HEADERS)
        assert "kk-pagination" in response.content.decode()

    def test_page_2_returns_different_results(
        self, client, db, amis, dialect_amis, corpus_a, run
    ):
        from corpus.views.dictionary import PAGE_SIZE_DICT
        self._create_many_tokens(db, amis, dialect_amis, corpus_a, run, PAGE_SIZE_DICT + 5)
        p1 = client.get("/search/?q=pgwd&page=1", **HTMX_HEADERS).content.decode()
        p2 = client.get("/search/?q=pgwd&page=2", **HTMX_HEADERS).content.decode()
        # The two pages render different word tokens
        assert p1 != p2

    def test_current_page_highlighted(
        self, client, db, amis, dialect_amis, corpus_a, run
    ):
        from corpus.views.dictionary import PAGE_SIZE_DICT
        self._create_many_tokens(db, amis, dialect_amis, corpus_a, run, PAGE_SIZE_DICT + 5)
        response = client.get("/search/?q=pgwd&page=2", **HTMX_HEADERS)
        assert "kk-pagination__page--current" in response.content.decode()


@pytest.mark.django_db
class TestWordExpand:
    def test_non_htmx_redirects(self, client, sentence_with_tokens):
        _, token = sentence_with_tokens
        response = client.get(f"/word/{token.pk}/expand/")
        assert response.status_code == 302

    def test_htmx_returns_expanded_card(self, client, sentence_with_tokens):
        _, token = sentence_with_tokens
        response = client.get(f"/word/{token.pk}/expand/", **HTMX_HEADERS)
        assert response.status_code == 200
        content = response.content.decode()
        assert "dict-card--expanded" in content

    def test_expanded_card_contains_occurrence_count(self, client, sentence_with_tokens):
        _, token = sentence_with_tokens
        response = client.get(f"/word/{token.pk}/expand/", **HTMX_HEADERS)
        assert "occurrence" in response.content.decode()

    def test_expanded_card_has_both_translations(self, client, sentence_with_tokens):
        _, token = sentence_with_tokens
        response = client.get(f"/word/{token.pk}/expand/", **HTMX_HEADERS)
        content = response.content.decode()
        assert "looking for a person" in content
        assert "找" in content

    def test_404_for_invalid_token(self, client):
        response = client.get("/word/999999/expand/", **HTMX_HEADERS)
        assert response.status_code == 404

    def test_no_audio_section_when_absent(self, client, sentence_with_tokens):
        _, token = sentence_with_tokens
        response = client.get(f"/word/{token.pk}/expand/", **HTMX_HEADERS)
        # fixture has no AudioSegment rows — audio section must be absent
        assert "kk-audio-player" not in response.content.decode()

    def test_audio_player_rendered_for_url_segment(self, client, sentence_with_tokens):
        from corpus.models import AudioSegment
        sentence, token = sentence_with_tokens
        AudioSegment.objects.create(sentence=sentence, url="https://example.com/test.mp3")
        response = client.get(f"/word/{token.pk}/expand/", **HTMX_HEADERS)
        content = response.content.decode()
        assert "kk-audio-player" in content
        assert "https://example.com/test.mp3" in content

    def test_audio_filename_shown_for_file_only_segment(self, client, sentence_with_tokens):
        from corpus.models import AudioSegment
        sentence, token = sentence_with_tokens
        AudioSegment.objects.create(sentence=sentence, file="corpora/Amis/audio/test.wav")
        response = client.get(f"/word/{token.pk}/expand/", **HTMX_HEADERS)
        content = response.content.decode()
        assert "kk-audio-filename" in content
        assert "test.wav" in content


@pytest.mark.django_db
class TestFilterReSearch:
    def test_filter_change_includes_query(self, client, sentence_with_tokens):
        # When q is present, changing lang filter must still return results (not empty)
        response = client.get("/search/?q=ki&lang=Amis", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()

    def test_filter_narrows_results(self, client, sentence_with_tokens):
        # Filtering to a non-existent language returns empty state even with a valid q
        response = client.get("/search/?q=ki&lang=Atayal", **HTMX_HEADERS)
        assert "kk-empty-state" in response.content.decode()

    def test_translation_filter_eng_returns_results(self, client, sentence_with_tokens):
        # Fixture sentence has an English translation so eng filter must return results
        response = client.get("/search/?q=ki&translation=eng", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()

    def test_translation_filter_zho_returns_results(self, client, sentence_with_tokens):
        # Fixture sentence has a Chinese translation so zho filter must return results
        response = client.get("/search/?q=ki&translation=zho", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()

    def test_translation_filter_invalid_ignored(self, client, sentence_with_tokens):
        # Invalid translation value is silently coerced to '' (no filter)
        response = client.get("/search/?q=ki&translation=bad", **HTMX_HEADERS)
        assert "dict-card" in response.content.decode()


@pytest.mark.django_db
class TestMeaningHighlight:
    def test_highlight_in_en_results(self, client, sentence_with_tokens):
        response = client.get("/search/?q=looking+for&dir=en", **HTMX_HEADERS)
        content = response.content.decode()
        assert "kk-highlight" in content
        assert "<mark" in content

    def test_highlight_in_zh_results(self, client, sentence_with_tokens):
        response = client.get("/search/?q=找&dir=zh", **HTMX_HEADERS,
                              HTTP_ACCEPT_LANGUAGE="zh-Hant,zh;q=0.9")
        content = response.content.decode()
        assert "kk-highlight" in content

    def test_word_chips_shown_in_meaning_results(self, client, sentence_with_tokens):
        response = client.get("/search/?q=looking+for&dir=en", **HTMX_HEADERS)
        content = response.content.decode()
        # Fixture sentence has two tokens (kilim, tamdaw) — word chips should appear
        assert "kk-word-chip" in content
