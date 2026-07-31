from __future__ import annotations

from typing import cast

from publisher.assemble_site import assemble
from publisher.build import build_release
from publisher.reconcile import reconcile_release


def test_fixture_reconciles_across_primary_representations(public_repo, tmp_path) -> None:
    release = build_release(public_repo, tmp_path / "release")
    site = tmp_path / "site"
    assemble(release.output, site)
    result = reconcile_release(release.output, source_repo=public_repo, site=site)
    counts = cast(dict[str, int], result["counts"])

    assert counts["sentences"] == 2
    assert counts["tokens"] == 4
    assert result["representations"] == [
        "csv",
        "flat_jsonl",
        "hierarchical_jsonl",
        "parquet",
        "sqlite",
        "tsv",
        "xlsx",
    ]
    assert result["canonical_files_verified"] == 1
    assert result["browser"] == {"sentences": 2, "tokens": 4}
