"""Shared immutable SQLite connection helper for generated releases."""

from __future__ import annotations

import sqlite3
import urllib.parse
from contextlib import AbstractContextManager, closing
from pathlib import Path


def open_release(path: Path) -> AbstractContextManager[sqlite3.Connection]:
    uri_path = urllib.parse.quote(str(path.resolve()), safe="/")
    connection = sqlite3.connect(
        f"file:{uri_path}?mode=ro&immutable=1",
        uri=True,
    )
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA query_only=ON")
    return closing(connection)
