"""Validate and execute finite, release-pinned export recipes."""

from __future__ import annotations

import argparse
import json
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Literal, cast

from jsonschema import Draft202012Validator

from api.config import Settings
from api.dataset_fields import DatasetField, RecordLevel
from api.exports import dataset_chunks, zip_chunks
from api.prepare_release import prepare_release
from api.release import load_release
from api.search import MatchMode
from api.store import CorpusStore, DatasetStream, SearchDirection, TierRequirement
from publisher.build import BuildError, build_release

ExportFormat = Literal["csv", "tsv", "jsonl"]


def load_recipe(path: Path, schema_path: Path) -> dict[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    schema = json.loads(schema_path.read_text(encoding="utf-8"))
    Draft202012Validator(schema).validate(value)
    return value


def _single_scope(values: list[str], name: str) -> str | None:
    if len(values) > 1:
        raise BuildError(f"Recipe {name} must contain at most one value")
    return values[0] if values else None


@contextmanager
def _release_store(release: Path) -> Iterator[CorpusStore]:
    manifest = release / "release-manifest.json"
    if not manifest.is_file():
        raise BuildError(f"Release manifest does not exist: {manifest}")
    with tempfile.TemporaryDirectory(prefix="kakarayan-recipe-db-") as temporary:
        root = Path(temporary)
        database = root / "formosanbank.sqlite"
        active_manifest = root / "active-release.json"
        prepare_release(str(manifest), database, active_manifest)
        settings = Settings(
            manifest_path=active_manifest,
            database_path=database,
            expected_sha256=None,
            cors_origins=(),
        )
        yield CorpusStore(
            load_release(settings),
            settings.query_step_limit,
            query_concurrency=1,
        )


def _recipe_streams(store: CorpusStore, recipe: dict[str, Any]) -> list[DatasetStream]:
    if store.release_id != recipe["release_id"]:
        raise BuildError(f"Recipe pins {recipe['release_id']}, release is {store.release_id}")
    selection = recipe["selection"]
    fields = cast(dict[RecordLevel, list[DatasetField]], recipe["fields"])
    levels = cast(list[RecordLevel], selection["record_units"])
    if set(levels) != set(fields):
        raise BuildError("Recipe fields must match its selected record_units")
    language_ids = cast(list[str], selection["language_ids"])
    if len(language_ids) != 1:
        raise BuildError("Recipe language_ids must contain exactly one value")
    if selection["record_ids"]:
        raise BuildError("Current recipes select records by query and scope, not explicit IDs")
    query = str(selection["query"]).strip() or None
    return [
        store.stream_dataset(
            language_id=language_ids[0],
            corpus_id=_single_scope(cast(list[str], selection["corpus_ids"]), "corpus_ids"),
            dialect=_single_scope(cast(list[str], selection["dialects"]), "dialects"),
            q=query,
            direction=cast(SearchDirection, selection["query_field"]),
            translation_language=str(selection["translation_language"]) or None,
            match=cast(MatchMode, selection["match"]),
            requirements=cast(list[TierRequirement], selection["requirements"]),
            fields=fields[level],
            record_level=level,
            complete_fields=bool(selection["complete_fields"]),
            max_rows=int(selection["max_rows"]),
        )
        for level in levels
    ]


def _write_chunks(output: Path, chunks: Iterator[bytes]) -> None:
    output.parent.mkdir(parents=True, exist_ok=True)
    with output.open("wb") as stream:
        for chunk in chunks:
            stream.write(chunk)


def execute_recipe(release: Path, recipe: dict[str, Any], output: Path) -> int:
    """Execute one recipe through the canonical SQLite dataset and export paths."""
    with _release_store(release.resolve()) as store:
        streams = _recipe_streams(store, recipe)
        export_format = cast(ExportFormat, recipe["format"])
        safe = bool(recipe["spreadsheet_safe"])
        if len(streams) == 1:
            chunks = dataset_chunks(
                streams[0],
                export_format,
                spreadsheet_safe_cells=safe,
            )
        else:
            members = (
                (
                    f"{result.record_level}s.{export_format}",
                    dataset_chunks(
                        result,
                        export_format,
                        spreadsheet_safe_cells=safe,
                    ),
                )
                for result in streams
            )
            recipe_bytes = (json.dumps(recipe, ensure_ascii=False, indent=2) + "\n").encode()
            chunks = zip_chunks(members, recipe_bytes, manifest_name="recipe.json")
        _write_chunks(output, chunks)
        return sum(result.returned_rows for result in streams)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--release", type=Path)
    source.add_argument("--repo", type=Path)
    parser.add_argument("--recipe", type=Path, required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument(
        "--schema",
        type=Path,
        default=Path(__file__).resolve().parents[1] / "schemas" / "export-recipe.schema.json",
    )
    arguments = parser.parse_args(argv)
    recipe = load_recipe(arguments.recipe, arguments.schema)
    if arguments.release:
        count = execute_recipe(arguments.release, recipe, arguments.output)
    else:
        with tempfile.TemporaryDirectory(prefix="kakarayan-recipe-") as temporary:
            release = Path(temporary) / "release"
            build_release(arguments.repo, release, include_prepared=False)
            count = execute_recipe(release, recipe, arguments.output)
    print(f"Wrote {count} records to {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
