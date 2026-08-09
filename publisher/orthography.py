"""Publish reviewed public FormosanBank orthography conversion tables."""

from __future__ import annotations

import csv
from pathlib import Path

from publisher import SCHEMA_VERSION
from publisher.identifiers import dimension_id


def build_orthography_catalog(repo: Path, source_commit: str) -> dict[str, object]:
    root = repo / "Orthographies" / "ConversionTables"
    tables: list[dict[str, object]] = []
    if not root.is_dir():
        return {"schema_version": SCHEMA_VERSION, "source_commit": source_commit, "tables": []}
    for path in sorted(root.glob("*.tsv"), key=lambda item: item.name.casefold()):
        if path.is_symlink():
            continue
        with path.open(encoding="utf-8-sig", newline="") as stream:
            reader = csv.DictReader(stream, delimiter="\t")
            if not reader.fieldnames or reader.fieldnames[0] != "original":
                continue
            dialects = [name.strip() for name in reader.fieldnames[1:] if name.strip()]
            rules = []
            for row in reader:
                source = (row.get("original") or "").strip()
                if not source:
                    continue
                rules.append(
                    {
                        "input": source,
                        "outputs": {
                            dialect: (row.get(dialect) or "").strip() for dialect in dialects
                        },
                    }
                )
        name = path.stem
        language = name.split("_", 1)[0]
        tables.append(
            {
                "id": dimension_id("orthography", name),
                "language": language,
                "name": name,
                "source_path": path.relative_to(repo).as_posix(),
                "dialects": dialects,
                "rules": rules,
            }
        )
    return {"schema_version": SCHEMA_VERSION, "source_commit": source_commit, "tables": tables}
