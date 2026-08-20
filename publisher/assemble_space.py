"""Assemble a pinned Docker Space without runtime release acquisition."""

from __future__ import annotations

import argparse
import re
import shutil
from pathlib import Path

from publisher.build import BuildError

_RELEASE_RE = re.compile(r"^fb-[0-9]{8}-[0-9a-f]{7,12}$")


def assemble_space(source: Path, output: Path, release_id: str) -> None:
    if not _RELEASE_RE.fullmatch(release_id):
        raise BuildError(f"Invalid release ID: {release_id!r}")
    api_source = source.resolve()
    root = api_source.parent
    output = output.resolve()
    if output.exists() and any(output.iterdir()):
        raise BuildError(f"Space output must be absent or empty: {output}")
    output.mkdir(parents=True, exist_ok=True)
    shutil.copytree(
        api_source, output / "api", ignore=shutil.ignore_patterns("tests", "__pycache__")
    )
    shutil.copy2(root / "pyproject.toml", output / "pyproject.toml")
    shutil.copy2(root / "uv.lock", output / "uv.lock")
    shutil.copy2(api_source / "space" / "README.md", output / "README.md")
    dockerfile = (api_source / "Dockerfile").read_text(encoding="utf-8")
    marker = 'ARG KAKARAYAN_RELEASE_MANIFEST_URL=""'
    manifest_url = (
        "https://github.com/FormosanBank/kakarayan/releases/download/"
        f"data-{release_id}/release-manifest.json"
    )
    replacement = f'ARG KAKARAYAN_RELEASE_MANIFEST_URL="{manifest_url}"'
    if dockerfile.count(marker) != 1:
        raise BuildError("API Dockerfile release marker is missing or ambiguous")
    (output / "Dockerfile").write_text(
        dockerfile.replace(marker, replacement), encoding="utf-8", newline="\n"
    )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--source", required=True, type=Path)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--release-id", required=True)
    args = parser.parse_args(argv)
    assemble_space(args.source, args.output, args.release_id)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
