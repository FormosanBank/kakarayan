"""Command-line entry point for Kakarayan publication builds."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from publisher.build import BuildError, build_release
from publisher.model_catalog import CatalogueFetchError, build_model_catalog


def parser() -> argparse.ArgumentParser:
    result = argparse.ArgumentParser(description=__doc__)
    result.add_argument(
        "--repo", type=Path, required=True, help="Clean public FormosanBank checkout"
    )
    result.add_argument("--output", type=Path, required=True, help="New or empty output directory")
    result.add_argument("--source-commit", help="Required exact HEAD commit when supplied")
    result.add_argument(
        "--kakarayan-commit",
        help="Exact 40-character Kakarayan commit that produces the release",
    )
    result.add_argument(
        "--refresh-models",
        action="store_true",
        help="Read current public FormosanBank metadata from the official Hugging Face API",
    )
    result.add_argument(
        "--no-prepared",
        action="store_true",
        help="Skip bulk linguist formats but keep core tables and SQLite",
    )
    result.add_argument(
        "--site-only",
        action="store_true",
        help="Keep only static API and compressed search data for GitHub Pages",
    )
    result.add_argument(
        "--compress-database",
        action="store_true",
        help="Package SQLite as deterministic gzip for a GitHub data release",
    )
    result.add_argument(
        "--release-only",
        action="store_true",
        help="Keep only flat-name-safe GitHub Release assets and their manifest",
    )
    return result


def main(argv: list[str] | None = None) -> int:
    args = parser().parse_args(argv)
    models = build_model_catalog() if args.refresh_models else None
    result = build_release(
        args.repo,
        args.output,
        expected_commit=args.source_commit,
        model_catalog=models,
        include_prepared=not args.no_prepared and not args.site_only,
        site_only=args.site_only,
        compress_database=args.compress_database,
        release_only=args.release_only,
        application_commit=args.kakarayan_commit,
    )
    print(
        json.dumps(
            {
                "release_id": result.release_id,
                "output": str(result.output),
                "source_commit": result.source.commit,
                "counts": result.counts,
                "warning_count": len(result.warnings),
            },
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (BuildError, CatalogueFetchError) as exc:
        raise SystemExit(f"publication failed: {exc}") from exc
