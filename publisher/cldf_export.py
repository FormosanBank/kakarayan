"""Conservative CLDF Generic package using standard Example and Language tables."""

from __future__ import annotations

import csv
import json
import sqlite3
import sys
import tempfile
from collections.abc import Iterator
from pathlib import Path

from pycldf import Generic

from publisher.archive import directory_entries, write_zip
from publisher.release_db import open_release


def _language_rows(connection: sqlite3.Connection) -> list[dict[str, object]]:
    metadata = json.loads(
        connection.execute(
            "SELECT value_json FROM publication_metadata WHERE key = 'languages'"
        ).fetchone()[0]
    )
    present = {row[0] for row in connection.execute("SELECT DISTINCT language_id FROM texts")}
    return [
        {
            "ID": item["id"],
            "Name": item["name"],
            "Glottocode": item.get("glottocode") or None,
            "ISO639P3code": item.get("iso639_3") or None,
        }
        for item in metadata
        if item["id"] in present
    ]


def _examples(
    connection: sqlite3.Connection,
    stats: dict[str, int],
) -> Iterator[dict[str, object]]:
    """Stream examples so a full release does not reside in Python memory."""
    for row in connection.execute(
        """
        SELECT sentence_id, language_id, source_path, source_xml_id,
               COALESCE(standard_form, original_form, '') AS primary_text
        FROM sentence_view
        ORDER BY source_path, source_ordinal, sentence_id
        """
    ):
        words = [
            item[0]
            for item in connection.execute(
                "SELECT surface FROM tokens WHERE sentence_id = ? ORDER BY position",
                (row["sentence_id"],),
            )
        ]
        translations = [
            item[0]
            for item in connection.execute(
                "SELECT text FROM translations "
                "WHERE owner_type = 'sentence' AND owner_id = ? ORDER BY position",
                (row["sentence_id"],),
            )
        ]
        primary_text = row["primary_text"] or " ".join(words)
        if not primary_text:
            stats["excluded"] += 1
            continue
        stats["examples"] += 1
        yield {
            "ID": row["sentence_id"],
            "Language_ID": row["language_id"],
            "Primary_Text": primary_text,
            "Analyzed_Word": words or None,
            "Translated_Text": " | ".join(translations) or None,
            "Comment": (
                f"FormosanBank source {row['source_path']}"
                + (f"#{row['source_xml_id']}" if row["source_xml_id"] else "")
            ),
        }


def _validate(dataset: Generic, metadata_path: Path) -> None:
    """Validate source fields larger than Python's conservative CSV default."""
    previous_limit = csv.field_size_limit()
    try:
        csv.field_size_limit(sys.maxsize)
        loaded = Generic.from_metadata(metadata_path)
        if not loaded.validate():
            raise ValueError("Generated CLDF package did not validate")
    finally:
        csv.field_size_limit(previous_limit)


def write_cldf_package(
    database: Path,
    path: Path,
    *,
    release_id: str,
    source_commit: str,
    rights: dict[str, object],
) -> dict[str, int]:
    with tempfile.TemporaryDirectory(prefix="kakarayan-cldf-") as temporary_name:
        directory = Path(temporary_name)
        dataset = Generic.in_dir(directory)
        dataset.add_component("LanguageTable")
        dataset.add_component("ExampleTable")
        dataset.properties.update(
            {
                "dc:title": "Kakarayan FormosanBank example corpus projection",
                "dc:description": (
                    "A conservative CLDF Generic projection. Canonical FormosanBank XML "
                    "remains authoritative."
                ),
                "dc:identifier": release_id,
                "prov:wasDerivedFrom": (
                    f"https://github.com/FormosanBank/FormosanBank/commit/{source_commit}"
                ),
            }
        )
        with open_release(database) as connection:
            languages = _language_rows(connection)
            stats = {"examples": 0, "excluded": 0}
            metadata_path = dataset.write(
                LanguageTable=languages,
                ExampleTable=_examples(connection, stats),
            )
        _validate(dataset, metadata_path)
        (directory / "README.txt").write_text(
            "Kakarayan CLDF Generic projection\n\n"
            f"Release: {release_id}\n"
            f"FormosanBank source commit: {source_commit}\n"
            "ExampleTable contains sentence examples. It is not presented as a lexical "
            "wordlist or grammar dataset. Source paths are retained in Comment. Use "
            "canonical XML for archival and lossless work.\n"
            f"Sentences excluded because no source text could be represented: "
            f"{stats['excluded']}\n",
            encoding="utf-8",
        )
        (directory / "rights.json").write_text(
            json.dumps(rights, ensure_ascii=False, sort_keys=True, indent=2) + "\n",
            encoding="utf-8",
            newline="\n",
        )
        write_zip(path, directory_entries(directory))
    return {
        "languages": len(languages),
        "examples": stats["examples"],
        "excluded_without_source_text": stats["excluded"],
    }
