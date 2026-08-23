"""Environment-backed service configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

from api.limits import (
    DEFAULT_ANALYTICAL_QUERY_CONCURRENCY,
    DEFAULT_DATASET_EXPORT_TIMEOUT_SECONDS,
    DEFAULT_DATASET_PREVIEW_TIMEOUT_SECONDS,
    DEFAULT_EXPORT_BURST,
    DEFAULT_EXPORTS_PER_MINUTE,
    DEFAULT_QUERY_CONCURRENCY,
    DEFAULT_QUERY_QUEUE_WAIT_SECONDS,
    DEFAULT_QUERY_TIMEOUT_SECONDS,
    DEFAULT_REQUEST_BURST,
    DEFAULT_REQUESTS_PER_MINUTE,
    DEFAULT_SQLITE_CACHE_MIB,
    DEFAULT_SQLITE_MMAP_MIB,
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


def _positive_number(value: str, name: str) -> float:
    try:
        parsed = float(value)
    except ValueError as error:
        raise ValueError(f"{name} must be a positive number") from error
    if parsed <= 0:
        raise ValueError(f"{name} must be a positive number")
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
    analytical_query_concurrency: int = DEFAULT_ANALYTICAL_QUERY_CONCURRENCY
    query_queue_wait_seconds: float = DEFAULT_QUERY_QUEUE_WAIT_SECONDS
    query_timeout_seconds: float = DEFAULT_QUERY_TIMEOUT_SECONDS
    dataset_preview_timeout_seconds: float = DEFAULT_DATASET_PREVIEW_TIMEOUT_SECONDS
    dataset_export_timeout_seconds: float = DEFAULT_DATASET_EXPORT_TIMEOUT_SECONDS
    sqlite_cache_mib: int = DEFAULT_SQLITE_CACHE_MIB
    sqlite_mmap_mib: int = DEFAULT_SQLITE_MMAP_MIB

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
            analytical_query_concurrency=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_ANALYTICAL_QUERY_CONCURRENCY",
                    str(DEFAULT_ANALYTICAL_QUERY_CONCURRENCY),
                ),
                "KAKARAYAN_ANALYTICAL_QUERY_CONCURRENCY",
            ),
            query_queue_wait_seconds=_positive_number(
                os.environ.get(
                    "KAKARAYAN_QUERY_QUEUE_WAIT_SECONDS",
                    str(DEFAULT_QUERY_QUEUE_WAIT_SECONDS),
                ),
                "KAKARAYAN_QUERY_QUEUE_WAIT_SECONDS",
            ),
            query_timeout_seconds=_positive_number(
                os.environ.get(
                    "KAKARAYAN_QUERY_TIMEOUT_SECONDS",
                    str(DEFAULT_QUERY_TIMEOUT_SECONDS),
                ),
                "KAKARAYAN_QUERY_TIMEOUT_SECONDS",
            ),
            dataset_preview_timeout_seconds=_positive_number(
                os.environ.get(
                    "KAKARAYAN_DATASET_PREVIEW_TIMEOUT_SECONDS",
                    str(DEFAULT_DATASET_PREVIEW_TIMEOUT_SECONDS),
                ),
                "KAKARAYAN_DATASET_PREVIEW_TIMEOUT_SECONDS",
            ),
            dataset_export_timeout_seconds=_positive_number(
                os.environ.get(
                    "KAKARAYAN_DATASET_EXPORT_TIMEOUT_SECONDS",
                    str(DEFAULT_DATASET_EXPORT_TIMEOUT_SECONDS),
                ),
                "KAKARAYAN_DATASET_EXPORT_TIMEOUT_SECONDS",
            ),
            sqlite_cache_mib=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_SQLITE_CACHE_MIB",
                    str(DEFAULT_SQLITE_CACHE_MIB),
                ),
                "KAKARAYAN_SQLITE_CACHE_MIB",
            ),
            sqlite_mmap_mib=_positive_integer(
                os.environ.get(
                    "KAKARAYAN_SQLITE_MMAP_MIB",
                    str(DEFAULT_SQLITE_MMAP_MIB),
                ),
                "KAKARAYAN_SQLITE_MMAP_MIB",
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
                self.analytical_query_concurrency,
                self.query_queue_wait_seconds,
                self.query_timeout_seconds,
                self.dataset_preview_timeout_seconds,
                self.dataset_export_timeout_seconds,
                self.sqlite_cache_mib,
                self.sqlite_mmap_mib,
            )
        ):
            raise ValueError("Service resource limits must be positive")
        if self.analytical_query_concurrency > self.query_concurrency:
            raise ValueError(
                "KAKARAYAN_ANALYTICAL_QUERY_CONCURRENCY cannot exceed KAKARAYAN_QUERY_CONCURRENCY"
            )
