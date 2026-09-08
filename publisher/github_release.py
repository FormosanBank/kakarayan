"""GitHub publication gates and resumable, immutable draft uploads."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
from pathlib import Path
from typing import Any


def gh(*arguments: str) -> str:
    return subprocess.run(["gh", *arguments], check=True, capture_output=True, text=True).stdout


def api(path: str, *, paginate: bool = False) -> Any:
    flags = ("--paginate", "--slurp") if paginate else ()
    return json.loads(gh("api", path, *flags))


def require_main_ci(repository: str, commit: str) -> int:
    if not re.fullmatch(r"[0-9a-f]{40}", commit):
        raise ValueError("An exact main commit is required")
    comparison = api(f"repos/{repository}/compare/{commit}...main")
    if comparison.get("status") not in {"ahead", "identical"}:
        raise ValueError("The requested commit is not on main")
    pages = api(
        f"repos/{repository}/actions/workflows/ci.yml/runs?head_sha={commit}&event=push&branch=main&per_page=100",
        paginate=True,
    )
    runs = [
        run
        for page in pages
        for run in page["workflow_runs"]
        if run.get("head_sha") == commit
        and run.get("head_branch") == "main"
        and run.get("event") == "push"
        and run.get("head_repository", {}).get("full_name") == repository
    ]
    latest = max(runs, key=lambda item: item["id"], default=None)
    if not latest or latest.get("conclusion") != "success" or latest.get("status") != "completed":
        raise ValueError("The exact main commit has not passed its latest CI run")
    return int(latest["id"])


def digest(path: Path) -> str:
    with path.open("rb") as stream:
        return hashlib.file_digest(stream, "sha256").hexdigest()


def missing_assets(remote: dict, expected: dict[str, tuple[int, str]]) -> list[str]:
    assets = remote["assets"]
    actual = {asset["name"]: asset for asset in assets}
    if len(actual) != len(assets) or set(actual) - set(expected):
        raise ValueError("The draft contains duplicate or unexpected assets")
    for name, asset in actual.items():
        size, sha256 = expected[name]
        if (
            asset.get("state") != "uploaded"
            or asset["size"] != size
            or asset.get("digest") != f"sha256:{sha256}"
        ):
            raise ValueError(f"Existing asset cannot be verified unchanged: {name}")
    return sorted(set(expected) - set(actual))


def publish_draft(directory: Path, repository: str, commit: str) -> None:
    require_main_ci(repository, commit)
    manifest_path = directory / "release-manifest.json"
    manifest = json.loads(manifest_path.read_text())
    if manifest["kakarayan"]["commit"] != commit:
        raise ValueError("The data publisher commit differs from the approved main commit")
    tag = f"data-{manifest['release_id']}"
    upload = directory.parent / "release-upload"
    upload.mkdir(exist_ok=True)
    files = {"release-manifest.json": manifest_path, "SHA256SUMS": upload / "SHA256SUMS"}
    expected = {}
    for artifact in manifest["artifacts"]:
        name = artifact["asset_name"]
        path = directory / artifact["path"]
        if (
            not path.resolve().is_relative_to(directory.resolve())
            or path.is_symlink()
            or path.name != name
            or name in files
        ):
            raise ValueError(f"Unsafe or duplicate release asset: {name}")
        if path.stat().st_size != artifact["bytes"] or digest(path) != artifact["sha256"]:
            raise ValueError(f"Local asset differs from the verified manifest: {name}")
        files[name] = path
        expected[name] = (artifact["bytes"], artifact["sha256"])
    files["SHA256SUMS"].write_text(
        "".join(f"{sha256}  {name}\n" for name, (_size, sha256) in sorted(expected.items()))
        + f"{digest(manifest_path)}  release-manifest.json\n"
    )
    for name in ("release-manifest.json", "SHA256SUMS"):
        expected[name] = (files[name].stat().st_size, digest(files[name]))
    releases = [
        release
        for page in api(f"repos/{repository}/releases?per_page=100", paginate=True)
        for release in page
    ]
    remote = next((release for release in releases if release["tag_name"] == tag), None)
    if remote is None:
        gh(
            "release",
            "create",
            tag,
            "--repo",
            repository,
            "--draft",
            "--target",
            commit,
            "--title",
            f"FormosanBank data {manifest['release_id']}",
            "--notes",
            f"Immutable public data from FormosanBank {manifest['source']['commit']}; "
            f"publisher {commit}. Requires maintainer review before publication.",
        )
        remote = api(f"repos/{repository}/releases/tags/{tag}")
    if not remote["draft"] or remote.get("prerelease") or remote["target_commitish"] != commit:
        raise ValueError("Only a draft pinned to this exact publisher commit can be resumed")
    # Inventory refs as well: a pre-existing tag must not point somewhere else.
    refs = [
        ref
        for page in api(f"repos/{repository}/git/matching-refs/tags/{tag}", paginate=True)
        for ref in page
    ]
    if any(
        ref["ref"] == f"refs/tags/{tag}"
        and api(f"repos/{repository}/commits/{tag}")["sha"] != commit
        for ref in refs
    ):
        raise ValueError("Existing data tag points to another commit")
    missing = missing_assets(remote, expected)
    if remote["assets"] and "release-manifest.json" in missing:
        raise ValueError("A partially uploaded draft must already have its matching manifest")
    for name in sorted(missing, key=lambda name: (name != "release-manifest.json", name)):
        gh("release", "upload", tag, str(files[name]), "--repo", repository)
    remote = api(f"repos/{repository}/releases/{remote['id']}")
    if missing_assets(remote, expected):
        raise ValueError("Draft upload is incomplete")
    print(f"Verified {len(expected)} immutable draft assets for {tag}")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--repository", required=True)
    parser.add_argument("--commit", required=True)
    parser.add_argument("--release", type=Path)
    args = parser.parse_args()
    if args.release:
        publish_draft(args.release, args.repository, args.commit)
    else:
        print(require_main_ci(args.repository, args.commit))


if __name__ == "__main__":
    main()
