"""FastAPI application for one immutable FormosanBank release."""

from __future__ import annotations

import asyncio
import json
import logging
import sqlite3
import time
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated, Literal

from fastapi import FastAPI, Path, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, StreamingResponse
from starlette.middleware.base import RequestResponseEndpoint
from starlette.middleware.gzip import GZipMiddleware

from api.config import Settings
from api.dataset_fields import DatasetField, RecordLevel, default_dataset_fields
from api.errors import ApiError, api_error_handler, validation_error_handler
from api.exports import dataset_chunks, zip_chunks
from api.limits import (
    DATASET_EXPORT_MAX_ROWS,
    DATASET_PREVIEW_MAX_ROWS,
    QUERY_MAX_CHARS,
    SEARCH_PAGE_MAX_ROWS,
    SUMMARY_MAX_ROWS,
)
from api.release import ReleaseError, load_release
from api.search import MatchMode
from api.security import PerIpRateLimiter, RateDecision, RatePolicy
from api.store import CorpusStore, FrequencySort, SearchDirection, TierRequirement

LOGGER = logging.getLogger("kakarayan.api")
_FAILURE_HEADER = "X-Kakarayan-Internal-Failure"
PageSize = Annotated[int, Query(ge=1, le=SEARCH_PAGE_MAX_ROWS)]
QueryText = Annotated[str, Query(min_length=1, max_length=QUERY_MAX_CHARS)]
OptionalQueryText = Annotated[str | None, Query(min_length=1, max_length=QUERY_MAX_CHARS)]
LanguageId = Annotated[str, Query(min_length=1, max_length=128)]
OptionalCorpus = Annotated[str | None, Query(max_length=128)]
OptionalDialect = Annotated[str | None, Query(max_length=128)]
Cursor = Annotated[str | None, Query(max_length=512)]
ReleaseId = Annotated[str, Path(min_length=1, max_length=128)]


def _cache(response: Response, *, immutable: bool = False) -> None:
    response.headers["Cache-Control"] = (
        "public, max-age=31536000, immutable" if immutable else "public, max-age=300"
    )


def _record(event: str, **values: object) -> None:
    LOGGER.info(json.dumps({"event": event, **values}, separators=(",", ":"), sort_keys=True))


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or Settings.from_environment()
    rate_limiter = PerIpRateLimiter(
        RatePolicy(configured.requests_per_minute, configured.request_burst),
        RatePolicy(configured.exports_per_minute, configured.export_burst),
    )

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.store = None
        app.state.startup_error = None
        started = time.perf_counter()
        try:
            state = await asyncio.to_thread(load_release, configured)
            app.state.store = CorpusStore(
                state,
                configured.query_step_limit,
                configured.query_concurrency,
            )
            _record(
                "startup",
                status="ready",
                release_id=state.manifest["release_id"],
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
        except (OSError, ValueError, ReleaseError, sqlite3.Error) as error:
            app.state.startup_error = str(error)
            _record(
                "startup",
                status="failed",
                failure_code=type(error).__name__,
                duration_ms=round((time.perf_counter() - started) * 1000),
            )
        yield

    app = FastAPI(
        title="Kakarayan FormosanBank API",
        summary="Read-only access to one pinned public FormosanBank release",
        version="1.0.0",
        lifespan=lifespan,
        license_info={
            "name": "CC BY-NC 4.0",
            "url": "https://creativecommons.org/licenses/by-nc/4.0/",
        },
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured.cors_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "If-None-Match", "X-Kakarayan-Client"],
        expose_headers=[
            "Retry-After",
            "X-Kakarayan-Release",
            "X-RateLimit-Limit",
            "X-RateLimit-Remaining",
            "X-RateLimit-Scope",
        ],
        max_age=86400,
    )
    app.add_middleware(GZipMiddleware, minimum_size=500, compresslevel=6)

    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, error: ApiError) -> JSONResponse:
        response = await api_error_handler(request, error)
        response.headers[_FAILURE_HEADER] = error.code
        return response

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request, error: RequestValidationError
    ) -> JSONResponse:
        response = await validation_error_handler(request, error)
        response.headers[_FAILURE_HEADER] = "invalid_parameter"
        return response

    @app.exception_handler(sqlite3.Error)
    async def database_error(_request: Request, _error: sqlite3.Error) -> JSONResponse:
        error = ApiError(500, "database_error", "The release query could not be completed")
        return JSONResponse(
            status_code=error.status,
            content=error.body(),
            headers={_FAILURE_HEADER: error.code},
        )

    @app.middleware("http")
    async def request_record(request: Request, call_next: RequestResponseEndpoint) -> Response:
        started = time.perf_counter()
        decision: RateDecision | None = None
        path = request.url.path
        if request.method != "OPTIONS" and path not in {"/healthz", "/readyz"}:
            client_ip = request.client.host.casefold() if request.client else "unknown"
            decision = rate_limiter.check(
                client_ip,
                is_export=path.endswith(("/datasets/export", "/datasets/export-package")),
            )
        response: Response
        if decision is not None and not decision.allowed:
            error = ApiError(429, "rate_limited", "Too many requests. Try again shortly.")
            response = JSONResponse(
                status_code=error.status,
                content=error.body(),
                headers={
                    _FAILURE_HEADER: error.code,
                    "Cache-Control": "no-store",
                    "Retry-After": str(decision.retry_after),
                },
            )
            origin = request.headers.get("origin")
            if origin in configured.cors_origins:
                response.headers["Access-Control-Allow-Origin"] = origin
                response.headers["Access-Control-Expose-Headers"] = (
                    "Retry-After, X-Kakarayan-Release, X-RateLimit-Limit, "
                    "X-RateLimit-Remaining, X-RateLimit-Scope"
                )
                response.headers.add_vary_header("Origin")
        else:
            response = await call_next(request)
        if decision is not None:
            response.headers["X-RateLimit-Limit"] = str(decision.limit)
            response.headers["X-RateLimit-Remaining"] = str(decision.remaining)
            response.headers["X-RateLimit-Scope"] = decision.scope
        current = getattr(request.app.state, "store", None)
        release_id = current.release_id if isinstance(current, CorpusStore) else None
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        failure_code = response.headers.get(_FAILURE_HEADER)
        if failure_code:
            del response.headers[_FAILURE_HEADER]
        if release_id:
            response.headers["X-Kakarayan-Release"] = release_id
        route = request.scope.get("route")
        route_path = getattr(route, "path", request.url.path)
        duration_ms = round((time.perf_counter() - started) * 1000)
        _record(
            "request",
            method=request.method,
            route=route_path,
            status=response.status_code,
            duration_ms=duration_ms,
            duration_bucket="lt100"
            if duration_ms < 100
            else "lt500"
            if duration_ms < 500
            else "gte500",
            response_bytes=int(response.headers.get("content-length", 0)),
            release_id=release_id,
            failure_code=failure_code,
        )
        return response

    def store(request: Request) -> CorpusStore:
        current = getattr(request.app.state, "store", None)
        if not isinstance(current, CorpusStore):
            raise ApiError(
                503, "service_not_ready", "The release has not passed startup validation"
            )
        return current

    def release_store(request: Request, release_id: str) -> CorpusStore:
        current = store(request)
        current.require_release(release_id)
        return current

    @app.get("/healthz", tags=["service"])
    def health() -> dict[str, str]:
        return {"status": "alive"}

    @app.get("/readyz", tags=["service"])
    def ready(request: Request, response: Response) -> dict[str, str]:
        current = store(request)
        current.check_ready()
        response.headers["Cache-Control"] = "no-store"
        return {"status": "ready", "release_id": current.release_id}

    @app.get("/v1/meta", tags=["catalogue"])
    def meta(request: Request, response: Response) -> dict:
        _cache(response)
        return store(request).metadata("meta")

    @app.get("/v1/languages", tags=["catalogue"])
    def languages(request: Request, response: Response) -> list[dict]:
        _cache(response)
        return store(request).metadata("languages")

    @app.get("/v1/corpora", tags=["catalogue"])
    def corpora(request: Request, response: Response) -> list[dict]:
        _cache(response)
        return store(request).metadata("corpora")

    @app.get("/v1/downloads", tags=["catalogue"])
    def downloads(request: Request, response: Response) -> dict:
        _cache(response)
        return store(request).downloads()

    @app.get("/v1/rights", tags=["catalogue"])
    def rights(request: Request, response: Response) -> dict:
        _cache(response)
        return store(request).metadata("rights")

    @app.get("/v1/models", tags=["catalogue"])
    def models(request: Request, response: Response) -> dict:
        _cache(response)
        return store(request).metadata("models")

    @app.get("/v1/releases/{release_id}/languages/{language_id}", tags=["catalogue"])
    def language(
        request: Request, response: Response, release_id: ReleaseId, language_id: str
    ) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).language(language_id)

    @app.get("/v1/releases/{release_id}/corpora/{corpus_id}", tags=["catalogue"])
    def corpus(request: Request, response: Response, release_id: ReleaseId, corpus_id: str) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).corpus(corpus_id)

    @app.get("/v1/releases/{release_id}/texts/{text_id}", tags=["records"])
    def text(request: Request, response: Response, release_id: ReleaseId, text_id: str) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).text(text_id)

    @app.get("/v1/releases/{release_id}/sentences/{sentence_id}", tags=["records"])
    def sentence(
        request: Request, response: Response, release_id: ReleaseId, sentence_id: str
    ) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).sentence(sentence_id)

    @app.get("/v1/releases/{release_id}/translation-languages", tags=["query"])
    def translation_languages(
        request: Request,
        response: Response,
        release_id: ReleaseId,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
    ) -> list[dict]:
        _cache(response, immutable=True)
        return release_store(request, release_id).translation_languages(
            language_id=language_id, corpus_id=corpus_id
        )

    @app.get("/v1/releases/{release_id}/dictionary", tags=["query"])
    def dictionary(
        request: Request,
        response: Response,
        release_id: ReleaseId,
        q: QueryText,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        direction: SearchDirection = "formosan",
        translation_language: Annotated[str | None, Query(max_length=32)] = None,
        match: MatchMode = "exact",
        limit: PageSize = 25,
        cursor: Cursor = None,
    ) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).dictionary(
            q=q,
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            direction=direction,
            translation_language=translation_language,
            match=match,
            limit=limit,
            cursor=cursor,
        )

    @app.get("/v1/releases/{release_id}/concordance", tags=["query"])
    def concordance(
        request: Request,
        response: Response,
        release_id: ReleaseId,
        q: QueryText,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        direction: SearchDirection = "formosan",
        translation_language: Annotated[str | None, Query(max_length=32)] = None,
        match: MatchMode = "exact",
        requirement: Annotated[list[TierRequirement] | None, Query()] = None,
        limit: PageSize = 25,
        cursor: Cursor = None,
    ) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).concordance(
            q=q,
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirement or (),
            limit=limit,
            cursor=cursor,
        )

    @app.get("/v1/releases/{release_id}/frequencies", tags=["query"])
    def frequencies(
        request: Request,
        response: Response,
        release_id: ReleaseId,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        prefix: Annotated[str | None, Query(max_length=QUERY_MAX_CHARS)] = None,
        minimum: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
        sort: FrequencySort = "count",
        limit: PageSize = 25,
        cursor: Cursor = None,
    ) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).frequencies(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            prefix=prefix,
            minimum=minimum,
            sort=sort,
            limit=limit,
            cursor=cursor,
        )

    @app.get("/v1/releases/{release_id}/summaries", tags=["query"])
    def summaries(
        request: Request,
        response: Response,
        release_id: ReleaseId,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        limit: Annotated[int, Query(ge=1, le=SUMMARY_MAX_ROWS)] = 25,
    ) -> dict:
        _cache(response, immutable=True)
        return release_store(request, release_id).summaries(
            language_id=language_id, corpus_id=corpus_id, dialect=dialect, limit=limit
        )

    def dataset_result(
        request: Request,
        release_id: str,
        language_id: str,
        corpus_id: str | None,
        dialect: str | None,
        q: str | None,
        direction: SearchDirection,
        translation_language: str | None,
        match: MatchMode,
        requirement: list[TierRequirement] | None,
        field: list[DatasetField] | None,
        record_level: RecordLevel,
        complete_fields: bool,
        max_rows: int,
    ) -> dict:
        return release_store(request, release_id).dataset(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            q=q,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirement or (),
            fields=field or default_dataset_fields(record_level),
            record_level=record_level,
            complete_fields=complete_fields,
            max_rows=max_rows,
        )

    @app.get("/v1/releases/{release_id}/datasets/preview", tags=["datasets"])
    def dataset_preview(
        request: Request,
        response: Response,
        release_id: ReleaseId,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        q: OptionalQueryText = None,
        direction: SearchDirection = "formosan",
        translation_language: Annotated[str | None, Query(max_length=32)] = None,
        match: MatchMode = "exact",
        requirement: Annotated[list[TierRequirement] | None, Query()] = None,
        field: Annotated[list[DatasetField] | None, Query()] = None,
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
        max_rows: Annotated[int, Query(ge=1, le=DATASET_PREVIEW_MAX_ROWS)] = 12,
    ) -> dict:
        _cache(response, immutable=True)
        return dataset_result(
            request,
            release_id,
            language_id,
            corpus_id,
            dialect,
            q,
            direction,
            translation_language,
            match,
            requirement,
            field,
            record_level,
            complete_fields,
            max_rows,
        )

    @app.get(
        "/v1/releases/{release_id}/datasets/export",
        tags=["datasets"],
        response_model=None,
    )
    def dataset_export(
        request: Request,
        release_id: ReleaseId,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        q: OptionalQueryText = None,
        direction: SearchDirection = "formosan",
        translation_language: Annotated[str | None, Query(max_length=32)] = None,
        match: MatchMode = "exact",
        requirement: Annotated[list[TierRequirement] | None, Query()] = None,
        field: Annotated[list[DatasetField] | None, Query()] = None,
        record_level: RecordLevel = "sentence",
        complete_fields: bool = False,
        max_rows: Annotated[int, Query(ge=1, le=DATASET_EXPORT_MAX_ROWS)] = 1000,
        format: Literal["csv", "tsv", "jsonl"] = "csv",
    ) -> Response:
        current = release_store(request, release_id)
        current.assert_export_allowed(language_id, corpus_id)
        result = current.stream_dataset(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            q=q,
            direction=direction,
            translation_language=translation_language,
            match=match,
            requirements=requirement or (),
            fields=field or default_dataset_fields(record_level),
            record_level=record_level,
            complete_fields=complete_fields,
            max_rows=max_rows,
        )
        media_type = {
            "csv": "text/csv",
            "tsv": "text/tab-separated-values",
            "jsonl": "application/x-ndjson",
        }[format]
        filename = f"kakarayan-{release_id}-{record_level}s.{format}"
        return StreamingResponse(
            dataset_chunks(result, format),
            media_type=media_type,
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Disposition": f'attachment; filename="{filename}"',
                "X-Kakarayan-Row-Count": str(result.returned_rows),
            },
        )

    @app.get(
        "/v1/releases/{release_id}/datasets/export-package",
        tags=["datasets"],
        response_model=None,
    )
    def dataset_export_package(
        request: Request,
        release_id: ReleaseId,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        q: OptionalQueryText = None,
        direction: SearchDirection = "formosan",
        translation_language: Annotated[str | None, Query(max_length=32)] = None,
        match: MatchMode = "exact",
        requirement: Annotated[list[TierRequirement] | None, Query()] = None,
        record_level: Annotated[list[RecordLevel] | None, Query()] = None,
        sentence_field: Annotated[list[DatasetField] | None, Query()] = None,
        word_field: Annotated[list[DatasetField] | None, Query()] = None,
        morpheme_field: Annotated[list[DatasetField] | None, Query()] = None,
        complete_fields: bool = True,
        max_rows: Annotated[int, Query(ge=1, le=DATASET_EXPORT_MAX_ROWS)] = 1000,
        format: Literal["csv", "tsv", "jsonl"] = "csv",
    ) -> Response:
        current = release_store(request, release_id)
        current.assert_export_allowed(language_id, corpus_id)
        levels = list(dict.fromkeys(record_level or ()))
        if not levels:
            raise ApiError(422, "invalid_parameter", "Choose at least one XML record level")
        field_map = {
            "sentence": sentence_field,
            "word": word_field,
            "morpheme": morpheme_field,
        }
        results = [
            current.stream_dataset(
                language_id=language_id,
                corpus_id=corpus_id,
                dialect=dialect,
                q=q,
                direction=direction,
                translation_language=translation_language,
                match=match,
                requirements=requirement or (),
                fields=field_map[level] or default_dataset_fields(level),
                record_level=level,
                complete_fields=complete_fields,
                max_rows=max_rows,
            )
            for level in levels
        ]
        manifest = {
            "release_id": release_id,
            "complete_fields": complete_fields,
            "max_rows_per_level": max_rows,
            "format": format,
            "tables": [
                {
                    "record_level": result.record_level,
                    "fields": result.fields,
                    "estimated_rows": result.estimated_rows,
                    "returned_rows": result.returned_rows,
                    "truncated": result.truncated,
                }
                for result in results
            ],
        }
        members = (
            (f"{result.record_level}s.{format}", dataset_chunks(result, format))
            for result in results
        )
        return StreamingResponse(
            zip_chunks(
                members,
                (json.dumps(manifest, ensure_ascii=False, indent=2) + "\n").encode(),
            ),
            media_type="application/zip",
            headers={
                "Cache-Control": "public, max-age=31536000, immutable",
                "Content-Encoding": "identity",
                "Content-Disposition": (
                    f'attachment; filename="kakarayan-{release_id}-xml-levels.zip"'
                ),
                "X-Kakarayan-Row-Count": str(sum(result.returned_rows for result in results)),
            },
        )

    return app


app = create_app()
