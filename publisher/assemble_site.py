"""Assemble generated release data into the Vite public tree."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path
from typing import Any, cast

from jsonschema.exceptions import ValidationError

from publisher import PUBLIC_DOWNLOAD_PATHS, SCHEMA_VERSION
from publisher.build import BuildError, validate_document

_DOWNLOAD_FIELDS = {
    "path",
    "media_type",
    "bytes",
    "sha256",
    "scope",
    "rights_ids",
    "publishable",
    "blocked_reasons",
    "download_url",
    "format",
    "language_ids",
    "corpus_ids",
    "tiers",
    "compression",
    "content_media_type",
    "content_bytes",
    "content_sha256",
}


def _download_catalog(
    site_manifest: dict[str, Any],
    published_manifest: dict[str, Any],
) -> dict[str, object]:
    if published_manifest.get("release_id") != site_manifest.get("release_id"):
        raise BuildError("Published download release ID does not match the site release")
    site_source = cast(dict[str, Any], site_manifest.get("source", {}))
    published_source = cast(dict[str, Any], published_manifest.get("source", {}))
    if published_source.get("commit") != site_source.get("commit"):
        raise BuildError("Published download source commit does not match the site source")
    release_id = str(site_manifest["release_id"])
    url_prefix = f"https://github.com/FormosanBank/kakarayan/releases/download/data-{release_id}/"
    artifacts = []
    for raw in published_manifest.get("artifacts", []):
        if not isinstance(raw, dict):
            raise BuildError("Published release has a malformed artifact")
        path = str(raw.get("path", ""))
        if path not in PUBLIC_DOWNLOAD_PATHS:
            continue
        asset_name = raw.get("asset_name")
        download_url = raw.get("download_url")
        if (
            not isinstance(asset_name, str)
            or Path(path).name != asset_name
            or download_url != f"{url_prefix}{asset_name}"
        ):
            raise BuildError(f"Published artifact has an unsafe download mapping: {path}")
        artifacts.append({key: value for key, value in raw.items() if key in _DOWNLOAD_FIELDS})
    found_paths = {str(artifact["path"]) for artifact in artifacts}
    missing_paths = sorted(set(PUBLIC_DOWNLOAD_PATHS) - found_paths)
    if missing_paths:
        raise BuildError(f"Published release is missing curated downloads: {missing_paths}")
    return {
        "schema_version": SCHEMA_VERSION,
        "release_id": release_id,
        "artifacts": artifacts,
    }


def assemble(
    release: Path,
    public: Path,
    *,
    download_manifest: Path | None = None,
) -> None:
    release = release.resolve()
    public = public.resolve()
    manifest = release / "release-manifest.json"
    api = release / "api" / "v1"
    if not manifest.is_file() or not api.is_dir():
        raise BuildError(f"Not a complete release directory: {release}")
    document = json.loads(manifest.read_text(encoding="utf-8"))
    if not document.get("release_id"):
        raise BuildError("Release manifest has no release_id")
    schema_dir = Path(__file__).resolve().parents[1] / "schemas"
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
    shutil.copy2(manifest, data_target / "release-manifest.json")
    shutil.copytree(search / "shards", data_target / "search" / "shards")
    shutil.copytree(search / "indexes", data_target / "search" / "indexes")
    if download_manifest is not None:
        try:
            published = json.loads(download_manifest.read_text(encoding="utf-8"))
            validate_document(published, schema_dir / "release-manifest.schema.json")
            downloads = _download_catalog(document, published)
            validate_document(downloads, schema_dir / "downloads.schema.json")
        except (OSError, json.JSONDecodeError, ValidationError) as error:
            raise BuildError(f"Invalid published download manifest: {error}") from error
        meta = json.loads((api_target / "v1" / "meta.json").read_text(encoding="utf-8"))
        download_response = {
            **{key: value for key, value in meta.items() if key != "data"},
            "endpoint": "downloads",
            "canonical_url": ("https://formosanbank.github.io/kakarayan/api/v1/downloads.json"),
            "data": downloads,
        }
        validate_document(download_response, schema_dir / "static-api.schema.json")
        (api_target / "v1" / "downloads.json").write_text(
            json.dumps(
                download_response,
                ensure_ascii=False,
                sort_keys=True,
                separators=(",", ":"),
            )
            + "\n",
            encoding="utf-8",
            newline="\n",
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release", type=Path, required=True)
    parser.add_argument("--public", type=Path, required=True)
    parser.add_argument(
        "--download-manifest",
        type=Path,
        help="Validated published data-release manifest to expose as prepared downloads",
    )
    args = parser.parse_args(argv)
    assemble(
        args.release,
        args.public,
        download_manifest=args.download_manifest,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
