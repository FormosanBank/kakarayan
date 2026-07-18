"""Tests for language switching and bilingual UI."""

import pytest


@pytest.mark.django_db
class TestLanguageSwitching:
    def test_default_language_is_english(self, client):
        response = client.get("/")
        assert response.status_code == 200
        # The language attribute on <html> defaults to 'en'
        assert b'lang="en"' in response.content

    def test_set_language_to_zh_hant(self, client):
        response = client.post(
            "/i18n/set-language/",
            {"language": "zh-hant", "next": "/"},
            follow=True,
        )
        assert response.status_code == 200
        content = response.content.decode()
        assert 'lang="zh-hant"' in content or 'lang="zh_Hant"' in content

    def test_zh_hant_ui_uses_chinese_preferred_translation(
        self, client, sentence_with_tokens
    ):
        """When UI is zh-hant, the result card should prefer the zh-Hant translation."""
        # Set language cookie
        client.post("/i18n/set-language/", {"language": "zh-hant", "next": "/"})
        response = client.get(
            "/search/?q=ki",
            HTTP_HX_REQUEST="true",
        )
        content = response.content.decode()
        # The zh-Hant translation text should appear in the result
        assert "找" in content
