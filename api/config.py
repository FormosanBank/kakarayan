"""Environment-backed service configuration."""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path


def _origins(value: str) -> tuple[str, ...]:
    return tuple(item.strip().rstrip("/") for item in value.split(",") if item.strip())


@dataclass(frozen=True)
class Settings:
    manifest_path: Path
    database_path: Path
    expected_sha256: str | None
    cors_origins: tuple[str, ...]
    query_step_limit: int = 200_000

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
        )

    def validate(self) -> None:
        if self.query_step_limit <= 0:
            raise ValueError("Service resource limits must be positive")
