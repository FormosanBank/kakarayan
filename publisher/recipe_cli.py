"""Execute a validated Kakarayan export recipe."""

from __future__ import annotations

import argparse
import tempfile
from pathlib import Path

from publisher.build import build_release
from publisher.recipes import load_recipe, resolve_recipe, write_recipe_export


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
        records = resolve_recipe(arguments.release.resolve(), recipe)
    else:
        with tempfile.TemporaryDirectory(prefix="kakarayan-recipe-") as temporary:
            release = Path(temporary) / "release"
            build_release(arguments.repo, release, include_prepared=False)
            records = resolve_recipe(release, recipe)
    write_recipe_export(records, recipe, arguments.output)
    count = (
        sum(len(rows) for rows in records.values()) if isinstance(records, dict) else len(records)
    )
    print(f"Wrote {count} records to {arguments.output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
