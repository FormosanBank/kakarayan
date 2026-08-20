"""Deterministic ZIP helpers for prepared release packages."""

from __future__ import annotations

import shutil
import zipfile
from collections.abc import Iterable, Mapping
from pathlib import Path

ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def _info(name: str, compression: int) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.compress_type = compression
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def write_zip(
    path: Path,
    entries: Iterable[tuple[str, bytes | Path]],
    *,
    compress: bool = True,
) -> None:
    """Write sorted bytes with fixed metadata and atomic replacement."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    compression = zipfile.ZIP_DEFLATED if compress else zipfile.ZIP_STORED
    with zipfile.ZipFile(
        temporary,
        "w",
        compression=compression,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for name, data in sorted(entries, key=lambda item: item[0]):
            with archive.open(_info(name, compression), "w") as destination:
                if isinstance(data, Path):
                    with data.open("rb") as source:
                        shutil.copyfileobj(source, destination, length=1024 * 1024)
                else:
                    destination.write(data)
    temporary.replace(path)


def repack_zip(
    path: Path,
    source: Path,
    *,
    replacements: Mapping[str, bytes] | None = None,
) -> None:
    """Repack a ZIP deterministically without buffering large members."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    replacement_data = replacements or {}
    with (
        zipfile.ZipFile(source) as source_archive,
        zipfile.ZipFile(
            temporary,
            "w",
            compression=zipfile.ZIP_DEFLATED,
            compresslevel=9,
            strict_timestamps=True,
        ) as destination_archive,
    ):
        for name in sorted(source_archive.namelist()):
            with destination_archive.open(_info(name, zipfile.ZIP_DEFLATED), "w") as destination:
                if name in replacement_data:
                    destination.write(replacement_data[name])
                    continue
                with source_archive.open(name) as source_member:
                    shutil.copyfileobj(source_member, destination, length=1024 * 1024)
    temporary.replace(path)


def directory_entries(root: Path) -> Iterable[tuple[str, Path]]:
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        if path.is_file():
            yield path.relative_to(root).as_posix(), path
