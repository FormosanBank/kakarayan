"""Incremental dataset serializers for large public downloads."""

from __future__ import annotations

import csv
import io
import json
import zipfile
from collections.abc import Buffer, Iterable, Iterator
from typing import Literal

from api.store import DatasetStream


def spreadsheet_safe(value: object) -> object:
    if isinstance(value, str) and value.startswith(("=", "+", "-", "@", "\t", "\r")):
        return f"'{value}"
    return value


def dataset_chunks(
    result: DatasetStream,
    export_format: Literal["csv", "tsv", "jsonl"],
) -> Iterator[bytes]:
    fields = list(result.fields)
    output = io.StringIO(newline="")
    if export_format == "jsonl":
        for row in result.rows:
            yield (json.dumps(row, ensure_ascii=False, separators=(",", ":")) + "\n").encode()
        return

    delimiter = "\t" if export_format == "tsv" else ","
    writer = csv.DictWriter(output, fieldnames=fields, delimiter=delimiter, lineterminator="\n")
    writer.writeheader()
    yield output.getvalue().encode()
    for row in result.rows:
        output.seek(0)
        output.truncate()
        writer.writerow({field: spreadsheet_safe(row[field]) for field in fields})
        yield output.getvalue().encode()


def _zip_info(name: str) -> zipfile.ZipInfo:
    info = zipfile.ZipInfo(name, date_time=(1980, 1, 1, 0, 0, 0))
    info.compress_type = zipfile.ZIP_DEFLATED
    info.external_attr = 0o100644 << 16
    return info


class _ZipSink(io.RawIOBase):
    def __init__(self) -> None:
        super().__init__()
        self.position = 0
        self.chunks: list[bytes] = []

    def writable(self) -> bool:
        return True

    def seekable(self) -> bool:
        return False

    def write(self, value: Buffer) -> int:
        body = bytes(value)
        self.position += len(body)
        if body:
            self.chunks.append(body)
        return len(body)

    def tell(self) -> int:
        return self.position

    def seek(self, _offset: int, _whence: int = 0) -> int:
        raise io.UnsupportedOperation("stream is not seekable")

    def flush(self) -> None:
        return

    def drain(self) -> Iterator[bytes]:
        chunks, self.chunks = self.chunks, []
        yield from chunks


def zip_chunks(
    members: Iterable[tuple[str, Iterator[bytes]]],
    manifest: bytes,
) -> Iterator[bytes]:
    sink = _ZipSink()
    with zipfile.ZipFile(sink, "w", compression=zipfile.ZIP_DEFLATED, compresslevel=6) as archive:
        for name, chunks in members:
            with archive.open(_zip_info(name), "w", force_zip64=True) as member:
                for chunk in chunks:
                    member.write(chunk)
                    yield from sink.drain()
            yield from sink.drain()
        with archive.open(_zip_info("manifest.json"), "w", force_zip64=True) as member:
            member.write(manifest)
            yield from sink.drain()
    yield from sink.drain()
