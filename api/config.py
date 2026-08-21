"""Environment-backed service configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from api.limits import (
    DEFAULT_EXPORT_BURST,
    DEFAULT_EXPORTS_PER_MINUTE,
    DEFAULT_QUERY_CONCURRENCY,
    DEFAULT_REQUEST_BURST,
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_SQLITE_PROGRESS_CALLBACKS,
)


def _origins(value: str) -> tuple[str, ...]:
    return tuple(item.strip().rstrip("/") for item in value.split(",") if item.strip())


def _positive_integer(value: str, name: str) -> int:
    try:
        parsed = int(value)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive integer") from error
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive integer")
    return parsed


@dataclass(frozen=True)
class Settings:
    manifest_path: Path
    database_path: Path
    expected_sha256: str | None
    cors_origins: tuple[str, ...]
    query_step_limit: int = DEFAULT_SQLITE_PROGRESS_CALLBACKS
    requests_per_minute: int = DEFAULT_REQUESTS_PER_MINUTE
    request_burst: int = DEFAULT_REQUEST_BURST
    exports_per_minute: int = DEFAULT_EXPORTS_PER_MINUTE
    export_burst: int = DEFAULT_EXPORT_BURST
    query_concurrency: int = DEFAULT_QUERY_CONCURRENCY

    @classmethod
    def from_environment(cls) -> Settings:
        manifest_path = os.environ.get(
            "KAKARAYAN_RELEASE_MANIFEST_PATH", "/data/active-release.json"
        )
        return cls(
            manifest_path=Path(manifest_path).resolve(),
            database_path=Path(
                os.environ.get("KAKARAYAN_DB_PATH", "/data/formosanbank.sqlite")
            ).resolve(),
            expected_sha256=os.environ.get("KAKARAYAN_SQLITE_SHA256"),
            cors_origins=_origins(
                os.environ.get(
                    "KAKARAYAN_CORS_ORIGINS",
                    "https://formosanbank.github.io,http://localhost:5173,http://127.0.0.1:5173",
                )
            ),
            query_step_limit=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_QUERY_STEP_LIMIT",
                    str(DEFAULT_SQLITE_PROGRESS_CALLBACKS),
                ),
                "KAKARAYAN_QUERY_STEP_LIMIT",
            ),
            requests_per_minute=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_REQUESTS_PER_MINUTE",
                    str(DEFAULT_REQUESTS_PER_MINUTE),
                ),
                "KAKARAYAN_REQUESTS_PER_MINUTE",
            ),
            request_burst=_positive_integer(
                os.environ.get("KAKARAYAN_REQUEST_BURST", str(DEFAULT_REQUEST_BURST)),
                "KAKARAYAN_REQUEST_BURST",
            ),
            exports_per_minute=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_EXPORTS_PER_MINUTE",
                    str(DEFAULT_EXPORTS_PER_MINUTE),
                ),
                "KAKARAYAN_EXPORTS_PER_MINUTE",
            ),
            export_burst=_positive_integer(
                os.environ.get("KAKARAYAN_EXPORT_BURST", str(DEFAULT_EXPORT_BURST)),
                "KAKARAYAN_EXPORT_BURST",
            ),
            query_concurrency=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_QUERY_CONCURRENCY",
                    str(DEFAULT_QUERY_CONCURRENCY),
                ),
                "KAKARAYAN_QUERY_CONCURRENCY",
            ),
        )

    def validate(self) -> None:
        if any(
            value <= 0
            for value in (
                self.query_step_limit,
                self.requests_per_minute,
                self.request_burst,
                self.exports_per_minute,
                self.export_burst,
                self.query_concurrency,
            )
        ):
            raise ValueError("Service resource limits must be positive")
