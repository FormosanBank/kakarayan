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
        "--refresh-models",
        action="store_true",
        help="Read current public FormosanBank metadata from the official Hugging Face API",
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
