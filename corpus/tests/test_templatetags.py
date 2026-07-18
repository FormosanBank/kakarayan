"""Tests for custom template filters."""

from corpus.templatetags.search_extras import highlight


class TestHighlight:
    def test_wraps_match_in_mark(self):
        result = highlight("looking for a person", "looking for")
        assert '<mark class="kk-highlight">looking for</mark>' in result

    def test_case_insensitive(self):
        result = highlight("I am Looking For someone", "looking for")
        assert '<mark class="kk-highlight">Looking For</mark>' in result

    def test_cjk_match(self):
        result = highlight("我在找一個人。", "找")
        assert '<mark class="kk-highlight">找</mark>' in result

    def test_no_match_returns_escaped_text(self):
        result = highlight("hello world", "xyz")
        assert "<mark" not in result
        assert "hello world" in result

    def test_empty_query_returns_text(self):
        result = highlight("hello", "")
        assert "hello" in result
        assert "<mark" not in result

    def test_empty_text_returns_empty(self):
        assert highlight("", "query") == ""

    def test_html_in_text_is_escaped(self):
        result = highlight("<script>alert(1)</script>", "script")
        # Raw <script> tag must not appear; < is escaped to &lt;
        assert "<script>" not in result
        assert "&lt;" in result

    def test_multiple_occurrences(self):
        result = highlight("cat and cat", "cat")
        assert result.count("<mark") == 2
