"""Assemble generated release data into the Vite public tree."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path

from publisher.build import BuildError


def assemble(release: Path, public: Path) -> None:
    release = release.resolve()
    public = public.resolve()
    manifest = release / "release-manifest.json"
    api = release / "api" / "v1"
    if not manifest.is_file() or not api.is_dir():
        raise BuildError(f"Not a complete release directory: {release}")
    document = json.loads(manifest.read_text(encoding="utf-8"))
    if not document.get("release_id"):
        raise BuildError("Release manifest has no release_id")
    api_target = public / "api"
    data_target = public / "data"
    if api_target.exists() or data_target.exists():
        raise BuildError("Generated site API/data targets already exist; remove them explicitly")
    public.mkdir(parents=True, exist_ok=True)
    search = release / "search"
    if not search.is_dir():
        raise BuildError("Release has no static search data")
    shutil.copytree(release / "api", api_target)
    data_target.mkdir()
    shutil.copytree(search, data_target / "search")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    args = parser.parse_args(argv)
    assemble(args.release, args.public)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
