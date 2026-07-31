"""Dependency-free static and live API client."""

from __future__ import annotations

import gzip
import hashlib
import json
import os
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Iterator, Mapping
from pathlib import Path
from typing import Any, Literal

Mode = Literal["static", "live"]


class KakarayanError(RuntimeError):
    def __init__(
        self,
        code: str,
        message: str,
        status: int = 0,
        field: str | None = None,
    ) -> None:
        self.code = code
        self.status = status
        self.field = field
        super().__init__(message)


class KakarayanClient:
    def __init__(
        self,
        base_url: str,
        *,
        mode: Mode = "static",
        release_id: str | None = None,
        timeout: float = 15.0,
    ) -> None:
        self.base_url = base_url.rstrip("/")
        self.mode = mode
        self.release_id = release_id
        self.timeout = timeout
        self._release_checked = False

    def _request(self, path: str) -> urllib.request.Request:
        return urllib.request.Request(
            f"{self.base_url}{path}",
            headers={
                "Accept": "application/json",
                "User-Agent": "kakarayan-python/0.1 (+https://formosanbank.github.io/kakarayan/)",
                "X-Kakarayan-Client": "python/0.1",
            },
        )

    def _json(self, path: str) -> Any:
        request = self._request(path)
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                raw = response.read()
                release_header = response.headers.get("X-Kakarayan-Release")
        except urllib.error.HTTPError as error:
            try:
                body = json.loads(error.read())
                detail = body.get("error", {})
            except (json.JSONDecodeError, UnicodeDecodeError):
                detail = {}
            raise KakarayanError(
                str(detail.get("code", "http_error")),
                str(detail.get("message", f"Kakarayan returned HTTP {error.code}")),
                int(error.code),
                detail.get("field"),
            ) from None
        except (TimeoutError, urllib.error.URLError) as error:
            message = str(error.reason) if isinstance(error, urllib.error.URLError) else str(error)
            raise KakarayanError("network_error", message, 0) from error
        try:
            value = json.loads(raw)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise KakarayanError("invalid_json", "Kakarayan returned invalid JSON") from error
        response_release = release_header
        if not response_release and isinstance(value, dict):
            response_release = value.get("release_id")
        if self.release_id and response_release and response_release != self.release_id:
            raise KakarayanError(
                "release_mismatch",
                f"Expected release {self.release_id}, received {response_release}",
                409,
            )
        return value

    def _ensure_release(self) -> None:
        if self.release_id and not self._release_checked:
            self.meta()
            self._release_checked = True

    def _live(self, endpoint: str, values: Mapping[str, object | None]) -> str:
        if self.mode != "live":
            raise KakarayanError(
                "live_api_required",
                f"{endpoint} requires a live API base URL",
                400,
            )
        query = urllib.parse.urlencode(
            {key: value for key, value in values.items() if value is not None and value != ""}
        )
        return f"/v1/{endpoint}?{query}"

    def meta(self) -> dict[str, Any]:
        path = "/api/v1/meta.json" if self.mode == "static" else "/v1/meta"
        return self._json(path)

    def languages(self) -> list[dict[str, Any]]:
        self._ensure_release()
        path = "/api/v1/languages.json" if self.mode == "static" else "/v1/languages"
        return self._json(path)

    def corpora(self) -> list[dict[str, Any]]:
        self._ensure_release()
        path = "/api/v1/corpora.json" if self.mode == "static" else "/v1/corpora"
        return self._json(path)

    def search_manifest(self) -> dict[str, Any]:
        if self.mode != "static":
            raise KakarayanError(
                "static_api_required",
                "Search shards are available from the static API",
                400,
            )
        self._ensure_release()
        return self._json("/api/v1/search/manifest.json")

    def _compressed_json(
        self,
        path: str,
        compressed_sha256: str,
        uncompressed_sha256: str,
    ) -> Any:
        request = self._request(f"/data/{path}")
        try:
            with urllib.request.urlopen(request, timeout=self.timeout) as response:
                received = response.read()
        except (TimeoutError, urllib.error.URLError) as error:
            message = str(error.reason) if isinstance(error, urllib.error.URLError) else str(error)
            raise KakarayanError("network_error", message, 0) from error
        if received.startswith(b"\x1f\x8b"):
            if hashlib.sha256(received).hexdigest() != compressed_sha256.lower():
                raise KakarayanError(
                    "checksum_mismatch",
                    "Compressed search checksum verification failed",
                    409,
                )
            try:
                content = gzip.decompress(received)
            except OSError as error:
                raise KakarayanError(
                    "invalid_compression",
                    "Search data is not valid gzip",
                    409,
                ) from error
        else:
            content = received
        if hashlib.sha256(content).hexdigest() != uncompressed_sha256.lower():
            raise KakarayanError(
                "checksum_mismatch",
                "Search content checksum verification failed",
                409,
            )
        try:
            return json.loads(content)
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise KakarayanError(
                "invalid_json", "Search data contains invalid JSON", 409
            ) from error

    def search_shard(
        self,
        path: str,
        compressed_sha256: str,
        uncompressed_sha256: str,
    ) -> list[dict[str, Any]]:
        if (
            self.mode != "static"
            or not path.startswith("search/shards/")
            or not path.endswith(".json.gz")
            or ".." in path.split("/")
        ):
            raise KakarayanError("invalid_shard", "The search shard path is invalid", 400)
        self._ensure_release()
        return self._compressed_json(path, compressed_sha256, uncompressed_sha256)

    def search_index(
        self,
        path: str,
        compressed_sha256: str,
        uncompressed_sha256: str,
    ) -> dict[str, Any]:
        if (
            self.mode != "static"
            or not path.startswith("search/indexes/")
            or not path.endswith("/vocabulary.json.gz")
            or ".." in path.split("/")
        ):
            raise KakarayanError("invalid_index", "The search index path is invalid", 400)
        self._ensure_release()
        return self._compressed_json(path, compressed_sha256, uncompressed_sha256)

    def dictionary(self, q: str, language_id: str, **options: object) -> dict[str, Any]:
        return self._json(
            self._live(
                "dictionary",
                {"q": q, "language_id": language_id, **options},
            )
        )

    def concordance(self, q: str, language_id: str, **options: object) -> dict[str, Any]:
        return self._json(
            self._live(
                "concordance",
                {"q": q, "language_id": language_id, **options},
            )
        )

    def frequencies(self, language_id: str, **options: object) -> dict[str, Any]:
        return self._json(
            self._live(
                "frequencies",
                {"language_id": language_id, **options},
            )
        )

    def pages(
        self,
        method: str,
        *,
        q: str | None = None,
        language_id: str,
        **options: object,
    ) -> Iterator[dict[str, Any]]:
        cursor: str | None = None
        while True:
            request_options = {**options, "cursor": cursor}
            if method == "frequencies":
                page = self.frequencies(language_id, **request_options)
            elif method == "dictionary" and q is not None:
                page = self.dictionary(q, language_id, **request_options)
            elif method == "concordance" and q is not None:
                page = self.concordance(q, language_id, **request_options)
            else:
                raise ValueError("method must be frequencies, dictionary, or concordance")
            yield from page["items"]
            cursor = page.get("next_cursor")
            if not cursor:
                return

    def download(self, url: str, destination: Path, expected_sha256: str) -> Path:
        base = urllib.parse.urlsplit(self.base_url)
        target = urllib.parse.urlsplit(url)
        if (target.scheme, target.netloc) != (base.scheme, base.netloc):
            raise KakarayanError(
                "invalid_download_url",
                "Downloads must use the configured Kakarayan origin",
                400,
            )
        destination = destination.resolve()
        destination.parent.mkdir(parents=True, exist_ok=True)
        request = urllib.request.Request(
            url,
            headers={"User-Agent": "kakarayan-python/0.1"},
        )
        handle, temporary_name = tempfile.mkstemp(
            prefix=f".{destination.name}-",
            dir=destination.parent,
        )
        temporary = Path(temporary_name)
        digest = hashlib.sha256()
        try:
            with (
                os.fdopen(handle, "wb") as output,
                urllib.request.urlopen(
                    request,
                    timeout=self.timeout,
                ) as response,
            ):
                while chunk := response.read(1024 * 1024):
                    digest.update(chunk)
                    output.write(chunk)
                output.flush()
                os.fsync(output.fileno())
            if digest.hexdigest() != expected_sha256.lower():
                raise KakarayanError(
                    "checksum_mismatch",
                    "Download checksum verification failed",
                    409,
                )
            temporary.replace(destination)
        finally:
            temporary.unlink(missing_ok=True)
        return destination
