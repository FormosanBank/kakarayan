"""Verify the assembled GitHub Pages tree and enforce its size budget."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

from publisher.verify_release import VerificationError


def verify_site(root: Path, *, total_limit: int, file_limit: int) -> dict[str, int]:
    root = root.resolve()
    required = (
        "index.html",
        "404.html",
        "manifest.webmanifest",
        "robots.txt",
        "sitemap.xml",
        "sw.js",
        "api/v1/meta.json",
        "api/v1/search/manifest.json",
    )
    for relative in required:
        if not (root / relative).is_file():
            raise VerificationError(f"Site output is missing {relative}")
    files = [path for path in root.rglob("*") if path.is_file()]
    total = sum(path.stat().st_size for path in files)
    largest = max((path.stat().st_size for path in files), default=0)
    if total > total_limit:
        raise VerificationError(f"Site is {total} bytes, over the {total_limit}-byte budget")
    if largest > file_limit:
        raise VerificationError(
            f"Largest site file is {largest} bytes, over the {file_limit}-byte budget"
        )
    search = json.loads(
        (root / "api" / "v1" / "search" / "manifest.json").read_text(encoding="utf-8")
    )
    expected = {f"data/{shard['path']}" for shard in search["shards"]}
    actual = {
        path.relative_to(root).as_posix()
        for path in (root / "data" / "search" / "shards").rglob("*.json.gz")
    }
    if actual != expected:
        raise VerificationError("Assembled search shard set does not match its manifest")
    expected_indexes = {f"data/{entry['path']}" for entry in search["indexes"]}
    actual_indexes = {
        path.relative_to(root).as_posix()
        for path in (root / "data" / "search" / "indexes").rglob("*.json.gz")
    }
    if actual_indexes != expected_indexes:
        raise VerificationError("Assembled search index set does not match its manifest")
    return {"files": len(files), "bytes": total, "largest_file_bytes": largest}


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--site", required=True, type=Path)
    parser.add_argument("--total-limit-mib", type=int, default=900)
    parser.add_argument("--file-limit-mib", type=int, default=50)
    args = parser.parse_args(argv)
    result = verify_site(
        args.site,
        total_limit=args.total_limit_mib * 1024 * 1024,
        file_limit=args.file_limit_mib * 1024 * 1024,
    )
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except VerificationError as error:
        raise SystemExit(f"site verification failed: {error}") from error
