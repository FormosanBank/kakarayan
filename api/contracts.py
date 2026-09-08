"""Validated response shapes shared by cached data and HTTP routes."""

from pydantic import BaseModel, ConfigDict, Field


class CountValue(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    value: str
    count: int = Field(ge=0)


class Summary(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    sentences: int = Field(default=0, ge=0)
    tokens: int = Field(default=0, ge=0)
    source_types: int = Field(default=0, ge=0)
    normalized_types: int = Field(default=0, ge=0)
    source_frequencies: list[CountValue] = Field(default_factory=list)
    normalized_frequencies: list[CountValue] = Field(default_factory=list)
    translation_frequencies: list[CountValue] = Field(default_factory=list)
    distributions: list[CountValue] = Field(default_factory=list)
