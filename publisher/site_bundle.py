"""Create and verify the static data bundle consumed by GitHub Pages."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import tarfile
import tempfile
from pathlib import Path, PurePosixPath
from typing import Any

from publisher.build import validate_document
from publisher.verify_release import VerificationError, verify_release

SITE_BUNDLE_NAME = "site-release.tar"
SITE_BUNDLE_MEDIA_TYPE = "application/x-tar"


class SiteBundleError(RuntimeError):
    """Raised when publication bundles are missing, unsafe, or incompatible."""


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _json(path: Path) -> dict[str, Any]:
    try:
        document = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as error:
        raise SiteBundleError(f"Cannot read JSON from {path}: {error}") from error
    if not isinstance(document, dict):
        raise SiteBundleError(f"Expected a JSON object in {path}")
    return document


def _write_json(path: Path, document: dict[str, Any]) -> None:
    path.write_text(
        json.dumps(document, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _write_checksums(release: Path, manifest: dict[str, Any]) -> None:
    lines = [f"{artifact['sha256']}  {artifact['path']}" for artifact in manifest["artifacts"]]
    lines.append(f"{_sha256(release / 'release-manifest.json')}  release-manifest.json")
    (release / "SHA256SUMS").write_text(
        "\n".join(lines) + "\n",
        encoding="utf-8",
        newline="\n",
    )


def _require_compatible(data_manifest: dict[str, Any], site_manifest: dict[str, Any]) -> None:
    for field in ("release_id", "source", "kakarayan", "counts"):
        if data_manifest.get(field) != site_manifest.get(field):
            raise SiteBundleError(f"Site and data releases disagree on {field}")


def create_site_bundle(site_release: Path, output: Path) -> dict[str, Any]:
    """Pack an already verified site-only release into a deterministic tar archive."""
    site_release = site_release.resolve()
    output = output.resolve()
    manifest = verify_release(site_release, required_scopes={"site-query-data"})
    if output.exists():
        raise SiteBundleError(f"Site bundle output already exists: {output}")
    try:
        output.relative_to(site_release)
    except ValueError:
        pass
    else:
        raise SiteBundleError("Site bundle output cannot be inside the release it packages")

    output.parent.mkdir(parents=True, exist_ok=True)
    temporary = output.with_name(f".{output.name}.tmp")
    if temporary.exists():
        raise SiteBundleError(f"Temporary site bundle already exists: {temporary}")
    try:
        with tarfile.open(temporary, mode="w", format=tarfile.PAX_FORMAT) as archive:
            for path in sorted(
                (candidate for candidate in site_release.rglob("*") if candidate.is_file()),
                key=lambda candidate: candidate.relative_to(site_release).as_posix(),
            ):
                relative = path.relative_to(site_release).as_posix()
                info = tarfile.TarInfo(relative)
                info.size = path.stat().st_size
                info.mode = 0o644
                info.mtime = 0
                info.uid = 0
                info.gid = 0
                info.uname = ""
                info.gname = ""
                with path.open("rb") as stream:
                    archive.addfile(info, stream)
        temporary.replace(output)
    except Exception:
        temporary.unlink(missing_ok=True)
        raise
    return manifest


def extract_site_bundle(bundle: Path, output: Path) -> dict[str, Any]:
    """Safely extract a site bundle and verify every contained release artifact."""
    bundle = bundle.resolve()
    output = output.resolve()
    if output.exists():
        raise SiteBundleError(f"Site bundle destination already exists: {output}")
    output.mkdir(parents=True)
    names: set[str] = set()
    try:
        with tarfile.open(bundle, mode="r:") as archive:
            for member in archive:
                relative = PurePosixPath(member.name)
                if (
                    not member.isfile()
                    or relative.is_absolute()
                    or not relative.parts
                    or ".." in relative.parts
                    or member.name in names
                ):
                    raise SiteBundleError(f"Unsafe site bundle member: {member.name!r}")
                names.add(member.name)
                source = archive.extractfile(member)
                if source is None:
                    raise SiteBundleError(f"Cannot read site bundle member: {member.name}")
                destination = output.joinpath(*relative.parts)
                destination.parent.mkdir(parents=True, exist_ok=True)
                with source, destination.open("wb") as stream:
                    shutil.copyfileobj(source, stream, length=1024 * 1024)
                destination.chmod(0o644)
        return verify_release(output, required_scopes={"site-query-data"})
    except Exception:
        shutil.rmtree(output, ignore_errors=True)
        raise


def attach_site_bundle(data_release: Path, bundle: Path) -> dict[str, Any]:
    """Attach a verified site bundle to a release-only publication."""
    data_release = data_release.resolve()
    bundle = bundle.resolve()
    data_manifest = verify_release(data_release)
    with tempfile.TemporaryDirectory(prefix="kakarayan-site-bundle-") as temporary:
        site_manifest = extract_site_bundle(bundle, Path(temporary) / "site-release")
    _require_compatible(data_manifest, site_manifest)

    destination = data_release / SITE_BUNDLE_NAME
    if destination.exists():
        raise SiteBundleError(f"Data release already contains {SITE_BUNDLE_NAME}")
    shutil.copyfile(bundle, destination)

    site_artifacts = site_manifest["artifacts"]
    rights_ids = sorted(
        {str(rights_id) for artifact in site_artifacts for rights_id in artifact["rights_ids"]}
    )
    blocked_reasons = sorted(
        {str(reason) for artifact in site_artifacts for reason in artifact["blocked_reasons"]}
    )
    release_id = str(data_manifest["release_id"])
    data_manifest["artifacts"].append(
        {
            "path": SITE_BUNDLE_NAME,
            "media_type": SITE_BUNDLE_MEDIA_TYPE,
            "bytes": destination.stat().st_size,
            "sha256": _sha256(destination),
            "scope": "site-query-data",
            "rights_ids": rights_ids,
            "publishable": not blocked_reasons,
            "blocked_reasons": blocked_reasons,
            "asset_name": SITE_BUNDLE_NAME,
            "download_url": (
                "https://github.com/FormosanBank/kakarayan/releases/download/"
                f"data-{release_id}/{SITE_BUNDLE_NAME}"
            ),
        }
    )
    data_manifest["artifacts"].sort(key=lambda artifact: str(artifact["path"]))
    _write_json(data_release / "release-manifest.json", data_manifest)
    _write_checksums(data_release, data_manifest)
    return verify_release(data_release, required_scopes={"site-query-data"})


def verify_and_extract_site_bundle(
    published_manifest: Path,
    bundle: Path,
    output: Path,
) -> dict[str, Any]:
    """Verify a downloaded bundle against its published manifest, then extract it."""
    data_manifest = _json(published_manifest.resolve())
    schema = Path(__file__).resolve().parents[1] / "schemas" / "release-manifest.schema.json"
    validate_document(data_manifest, schema)
    matching = [
        artifact for artifact in data_manifest["artifacts"] if artifact["path"] == SITE_BUNDLE_NAME
    ]
    if len(matching) != 1:
        raise SiteBundleError(f"Published release must contain exactly one {SITE_BUNDLE_NAME}")
    artifact = matching[0]
    bundle = bundle.resolve()
    if (
        artifact.get("asset_name") != SITE_BUNDLE_NAME
        or artifact.get("media_type") != SITE_BUNDLE_MEDIA_TYPE
        or artifact.get("scope") != "site-query-data"
        or not artifact.get("publishable")
        or artifact.get("bytes") != bundle.stat().st_size
        or artifact.get("sha256") != _sha256(bundle)
    ):
        raise SiteBundleError("Downloaded site bundle does not match the published manifest")
    site_manifest = extract_site_bundle(bundle, output)
    _require_compatible(data_manifest, site_manifest)
    return site_manifest


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)

    pack = commands.add_parser("pack", help="Create a deterministic verified site bundle")
    pack.add_argument("--release", required=True, type=Path)
    pack.add_argument("--output", required=True, type=Path)

    attach = commands.add_parser("attach", help="Attach a site bundle to a data release")
    attach.add_argument("--release", required=True, type=Path)
    attach.add_argument("--bundle", required=True, type=Path)

    extract = commands.add_parser("extract", help="Verify and extract a published site bundle")
    extract.add_argument("--manifest", required=True, type=Path)
    extract.add_argument("--bundle", required=True, type=Path)
    extract.add_argument("--output", required=True, type=Path)

    args = parser.parse_args(argv)
    if args.command == "pack":
        manifest = create_site_bundle(args.release, args.output)
    elif args.command == "attach":
        manifest = attach_site_bundle(args.release, args.bundle)
    else:
        manifest = verify_and_extract_site_bundle(args.manifest, args.bundle, args.output)
    print(
        json.dumps(
            {"release_id": manifest["release_id"], "site_bundle_verified": True},
            sort_keys=True,
        )
    )
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except (SiteBundleError, VerificationError) as error:
        raise SystemExit(f"site bundle failed: {error}") from error
