"""Shared pytest fixtures for corpus tests."""

import pytest

from corpus.models import (
    Corpus,
    Dialect,
    IngestionRun,
    Language,
    Sentence,
    Text,
    Token,
    Translation,
)


@pytest.fixture
def amis(db):
    return Language.objects.create(name="Amis", iso639_3="ami")


@pytest.fixture
def atayal(db):
    return Language.objects.create(name="Atayal", iso639_3="tay")


@pytest.fixture
def dialect_amis(db, amis):
    return Dialect.objects.create(language=amis, name="Northern Amis")


@pytest.fixture
def corpus_a(db):
    return Corpus.objects.create(name="TestCorpus", slug="testcorpus")


@pytest.fixture
def run(db):
    return IngestionRun.objects.create(status="succeeded")


@pytest.fixture
def sentence_with_tokens(db, amis, dialect_amis, corpus_a, run):
    """One Text → one Sentence with two Tokens and EN + zh-Hant translations."""
    text = Text.objects.create(
        corpus=corpus_a,
        language=amis,
        dialect=dialect_amis,
        ingestion_run=run,
        text_xml_id="s001",
        source_path="TestCorpus/s001.xml",
        xml_lang="ami",
    )
    sentence = Sentence.objects.create(
        text=text,
        sentence_xml_id="s001.s1",
        position=0,
        form_standard="Kilim ku tamdaw.",
        token_count=3,
    )
    Translation.objects.create(
        sentence=sentence,
        xml_lang="eng",
        text="I am looking for a person.",
        text_norm="i am looking for a person",
    )
    Translation.objects.create(
        sentence=sentence,
        xml_lang="zho",
        text="我在找一個人。",
        text_norm="我在找一個人",
    )
    token = Token.objects.create(
        sentence=sentence,
        surface_standard="Kilim",
        surface_original="kilim",
        surface_norm="kilim",
        language=amis,
        dialect=dialect_amis,
        corpus=corpus_a,
        position=0,
    )
    Token.objects.create(
        sentence=sentence,
        surface_standard="tamdaw",
        surface_original="tamdaw",
        surface_norm="tamdaw",
        language=amis,
        dialect=dialect_amis,
        corpus=corpus_a,
        position=2,
    )
    return sentence, token
