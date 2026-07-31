"""Deterministic ZIP helpers for prepared release packages."""

from __future__ import annotations

import zipfile
from collections.abc import Iterable
from pathlib import Path

ZIP_TIMESTAMP = (1980, 1, 1, 0, 0, 0)


def _info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, ZIP_TIMESTAMP)
    info.compress_type = zipfile.ZIP_DEFLATED
    info.create_system = 3
    info.external_attr = 0o100644 << 16
    return info


def write_zip(path: Path, entries: Iterable[tuple[str, bytes]]) -> None:
    """Write sorted bytes with fixed metadata and atomic replacement."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_suffix(f"{path.suffix}.tmp")
    with zipfile.ZipFile(
        temporary,
        "w",
        compression=zipfile.ZIP_DEFLATED,
        compresslevel=9,
        strict_timestamps=True,
    ) as archive:
        for name, data in sorted(entries, key=lambda item: item[0]):
            archive.writestr(_info(name), data)
    temporary.replace(path)


def directory_entries(root: Path) -> Iterable[tuple[str, bytes]]:
    for path in sorted(root.rglob("*"), key=lambda item: item.relative_to(root).as_posix()):
        if path.is_file():
            yield path.relative_to(root).as_posix(), path.read_bytes()
