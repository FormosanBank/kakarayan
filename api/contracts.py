"""Validated response shapes shared by cached data and HTTP routes."""

import json
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, RootModel


class RuntimeContract(BaseModel):
    api_version: Literal["v1"]
    read_model_version: int = Field(ge=1)


READ_MODEL_VERSION = RuntimeContract.model_validate_json(
    Path(__file__).with_name("contract.json").read_bytes()
).read_model_version


class CountValue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    value: str
    count: int = Field(ge=0)


class Summary(BaseModel):
    model_config = ConfigDict(
        extra="forbid", strict=True, json_schema_serialization_defaults_required=True
    )
    sentences: int = Field(default=0, ge=0)
    tokens: int = Field(default=0, ge=0)
    source_types: int = Field(default=0, ge=0)
    normalized_types: int = Field(default=0, ge=0)
    source_frequencies: list[CountValue] = Field(default_factory=list)
    normalized_frequencies: list[CountValue] = Field(default_factory=list)
    translation_frequencies: list[CountValue] = Field(default_factory=list)
    distributions: list[CountValue] = Field(default_factory=list)


class WireModel(BaseModel):
    # Known fields are strict; additional source attributes remain public.
    model_config = ConfigDict(extra="allow", strict=True)


class Ready(WireModel):
    status: Literal["ready"]
    release_id: str
    read_model_version: int


class ExportReady(WireModel):
    status: Literal["ready"]
    release_id: str


class ErrorDetail(BaseModel):
    code: str
    message: str
    status: int
    field: str | None = None


class ErrorResponse(BaseModel):
    error: ErrorDetail


class Translation(WireModel):
    text: str
    xml_lang: str
    kind: str
    version: str


class Token(WireModel):
    surface: str
    normalized: str
    position: int
    word_id: str


class SearchForm(WireModel):
    owner_type: Literal["sentence", "word", "morpheme"]
    owner_id: str
    position: int
    text: str
    unclear: int
    kind: str
    notes: str
    normalized: str


class SearchPhonology(WireModel):
    owner_type: Literal["sentence", "word", "morpheme"]
    owner_id: str
    position: int
    text: str
    unclear: int
    kind: str


class TierTranslation(Translation):
    owner_type: Literal["sentence", "word", "morpheme"]
    owner_id: str
    position: int
    unclear: int
    notes: str
    normalized: str


class SearchMorpheme(WireModel):
    id: str
    xml_id: str
    position: int
    class_: str = Field(alias="class")
    sclass: str


class SearchWord(SearchMorpheme):
    morphemes: list[SearchMorpheme]


class SearchAudio(WireModel):
    owner_type: Literal["sentence", "word", "morpheme"]
    owner_id: str
    position: int
    file: str
    url: str
    playback_urls: list[str]
    start: float | None
    end: float | None
    source: str
    duration: float | None
    availability_status: str


class SearchRecord(WireModel):
    id: str
    text_id: str
    corpus_id: str
    language_id: str
    dialect: str
    source_path: str
    xml_id: str
    standard: str
    original: str
    translations: list[Translation]
    tokens: list[Token]
    forms: list[SearchForm]
    phonology: list[SearchPhonology]
    tier_translations: list[TierTranslation]
    words: list[SearchWord]
    audio: list[SearchAudio]
    detail_truncated: bool


class MatchEvidence(WireModel):
    tier: Literal["sentence", "word", "morpheme"]
    field: Literal["form", "translation"]
    text: str
    xml_lang: str
    kind: str


class SentenceSummary(WireModel):
    id: str
    text_id: str
    corpus_id: str
    language_id: str
    language: str
    dialect: str
    source_path: str
    citation: str
    xml_id: str
    position: int
    token_count: int
    standard: str
    original: str
    translations: list[Translation]
    translation_count: int
    match_evidence: list[MatchEvidence]
    summary_truncated: bool
    audio_count: int


class Meaning(WireModel):
    text: str
    xml_lang: str


class DictionaryEntry(WireModel):
    id: str
    language_id: str
    headword: str
    display_form: str
    occurrences: int
    variant_count: int
    meanings: list[Meaning]
    pronunciations: list[str]
    variants: list[str]
    corpus_ids: list[str]
    examples: list[SentenceSummary]
    summary_truncated: bool


class DictionaryPage(WireModel):
    release_id: str
    items: list[DictionaryEntry]
    next_cursor: str | None


class ConcordancePage(WireModel):
    release_id: str
    items: list[SentenceSummary]
    next_cursor: str | None


class SummaryResponse(Summary):
    release_id: str


class TranslationLanguage(WireModel):
    xml_lang: str
    records: int


class TranslationLanguages(RootModel[list[TranslationLanguage]]):
    pass


class DatasetPreviewResult(WireModel):
    release_id: str
    record_level: Literal["sentence", "word", "morpheme"]
    complete_fields: bool
    estimated_rows: int
    selected_rows: int
    returned_rows: int
    truncated: bool
    fields: list[str]
    items: list[dict[str, str | int | float | None]]


RESPONSES = (
    Ready,
    ExportReady,
    ErrorResponse,
    DictionaryPage,
    ConcordancePage,
    SearchRecord,
    SummaryResponse,
    TranslationLanguages,
    DatasetPreviewResult,
)


def response_schema() -> dict:
    definitions: dict[str, dict] = {}
    for model in RESPONSES:
        schema = model.model_json_schema(mode="serialization")
        for name, definition in schema.pop("$defs", {}).items():
            if name in definitions and definitions[name] != definition:
                raise ValueError(f"Conflicting response definition: {name}")
            definitions[name] = definition
        definitions[model.__name__] = schema
    return {
        "$schema": "https://json-schema.org/draft/2020-12/schema",
        "$id": "https://formosanbank.github.io/kakarayan/schemas/query-api.schema.json",
        "$defs": definitions,
        "anyOf": [{"$ref": f"#/$defs/{model.__name__}"} for model in RESPONSES],
    }


if __name__ == "__main__":
    print(json.dumps(response_schema()))
