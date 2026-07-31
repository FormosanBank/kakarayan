"""FastAPI application exposing bounded read-only corpus queries."""

from __future__ import annotations

import asyncio
import sqlite3
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Annotated

from fastapi import FastAPI, Path, Query, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import RequestResponseEndpoint

from api.config import Settings
from api.errors import ApiError, api_error_handler, validation_error_handler
from api.release import ReleaseError, load_release
from api.store import CorpusStore, FrequencySort, MatchMode, SearchField

PageSize = Annotated[int, Query(ge=1, le=100)]
LanguageId = Annotated[str, Query(min_length=1, max_length=128)]
OptionalCorpus = Annotated[str | None, Query(max_length=128)]
OptionalDialect = Annotated[str | None, Query(max_length=128)]
Cursor = Annotated[str | None, Query(max_length=512)]


def _cache(response: Response, seconds: int) -> None:
    response.headers["Cache-Control"] = f"public, max-age={seconds}"


def _query_cache(response: Response) -> None:
    response.headers["Cache-Control"] = "private, max-age=60"


def create_app(settings: Settings | None = None) -> FastAPI:
    configured = settings or Settings.from_environment()

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        app.state.store = None
        app.state.startup_error = None
        try:
            state = await asyncio.to_thread(load_release, configured)
            app.state.store = CorpusStore(state, configured.query_step_limit)
        except (OSError, ValueError, ReleaseError, sqlite3.Error) as error:
            app.state.startup_error = str(error)
        yield

    app = FastAPI(
        title="Kakarayan FormosanBank API",
        summary="Read-only access to a pinned public FormosanBank release",
        description=(
            "Bounded corpus lookup over a checksummed SQLite snapshot. "
            "The service has no write endpoints and accepts no remote resource parameters."
        ),
        version="1.0.0",
        lifespan=lifespan,
        license_info={"name": "Software license pending maintainer approval"},
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=list(configured.cors_origins),
        allow_credentials=False,
        allow_methods=["GET"],
        allow_headers=["Accept", "If-None-Match", "X-Kakarayan-Client"],
        max_age=86400,
    )
    @app.exception_handler(ApiError)
    async def handle_api_error(request: Request, error: ApiError) -> JSONResponse:
        return await api_error_handler(request, error)

    @app.exception_handler(RequestValidationError)
    async def handle_validation_error(
        request: Request,
        error: RequestValidationError,
    ) -> JSONResponse:
        return await validation_error_handler(request, error)

    @app.exception_handler(sqlite3.Error)
    async def database_error(_request: Request, _error: sqlite3.Error) -> JSONResponse:
        error = ApiError(500, "database_error", "The release query could not be completed")
        return JSONResponse(status_code=error.status, content=error.body())

    @app.middleware("http")
    async def release_header(
        request: Request,
        call_next: RequestResponseEndpoint,
    ) -> Response:
        response = await call_next(request)
        store = getattr(request.app.state, "store", None)
        if isinstance(store, CorpusStore):
            response.headers["X-Kakarayan-Release"] = str(
                store.metadata("meta")["release_id"]
            )
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "no-referrer"
        return response

    def store(request: Request) -> CorpusStore:
        current = getattr(request.app.state, "store", None)
        if not isinstance(current, CorpusStore):
            raise ApiError(
                503,
                "service_not_ready",
                "The release has not passed startup validation",
            )
        return current

    @app.get("/healthz", tags=["service"])
    async def health() -> dict[str, str]:
        return {"status": "alive"}

    @app.get("/readyz", tags=["service"])
    async def ready(request: Request, response: Response) -> dict[str, str]:
        current = store(request)
        response.headers["Cache-Control"] = "no-store"
        return {
            "status": "ready",
            "release_id": str(current.metadata("meta")["release_id"]),
        }

    @app.get("/v1/meta", tags=["catalogue"])
    async def meta(request: Request, response: Response) -> dict:
        _cache(response, 300)
        return store(request).metadata("meta")

    @app.get("/v1/languages", tags=["catalogue"])
    async def languages(request: Request, response: Response) -> list[dict]:
        _cache(response, 300)
        return store(request).metadata("languages")

    @app.get("/v1/languages/{language_id}", tags=["catalogue"])
    async def language(
        request: Request,
        response: Response,
        language_id: Annotated[str, Path(min_length=1, max_length=128)],
    ) -> dict:
        _cache(response, 300)
        return store(request).language(language_id)

    @app.get("/v1/corpora", tags=["catalogue"])
    async def corpora(request: Request, response: Response) -> list[dict]:
        _cache(response, 300)
        return store(request).metadata("corpora")

    @app.get("/v1/corpora/{corpus_id}", tags=["catalogue"])
    async def corpus(
        request: Request,
        response: Response,
        corpus_id: Annotated[str, Path(min_length=1, max_length=128)],
    ) -> dict:
        _cache(response, 300)
        return store(request).corpus(corpus_id)

    @app.get("/v1/texts/{text_id}", tags=["records"])
    async def text(
        request: Request,
        response: Response,
        text_id: Annotated[str, Path(min_length=1, max_length=128)],
    ) -> dict:
        _query_cache(response)
        return store(request).text(text_id)

    @app.get("/v1/sentences/{sentence_id}", tags=["records"])
    async def sentence(
        request: Request,
        response: Response,
        sentence_id: Annotated[str, Path(min_length=1, max_length=128)],
    ) -> dict:
        _query_cache(response)
        return store(request).sentence(sentence_id)

    @app.get("/v1/dictionary", tags=["query"])
    async def dictionary(
        request: Request,
        response: Response,
        q: Annotated[str, Query(min_length=1, max_length=256)],
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        match: MatchMode = "exact",
        limit: PageSize = 25,
        cursor: Cursor = None,
    ) -> dict:
        _query_cache(response)
        return store(request).dictionary(
            q=q,
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            match=match,
            limit=limit,
            cursor=cursor,
        )

    @app.get("/v1/concordance", tags=["query"])
    async def concordance(
        request: Request,
        response: Response,
        q: Annotated[str, Query(min_length=1, max_length=256)],
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        field: SearchField = "any",
        match: MatchMode = "exact",
        limit: PageSize = 25,
        cursor: Cursor = None,
    ) -> dict:
        _query_cache(response)
        return store(request).concordance(
            q=q,
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            field=field,
            match=match,
            limit=limit,
            cursor=cursor,
        )

    @app.get("/v1/frequencies", tags=["query"])
    async def frequencies(
        request: Request,
        response: Response,
        language_id: LanguageId,
        corpus_id: OptionalCorpus = None,
        dialect: OptionalDialect = None,
        prefix: Annotated[str | None, Query(max_length=256)] = None,
        minimum: Annotated[int, Query(ge=1, le=1_000_000)] = 1,
        sort: FrequencySort = "count",
        limit: PageSize = 25,
        cursor: Cursor = None,
    ) -> dict:
        _query_cache(response)
        return store(request).frequencies(
            language_id=language_id,
            corpus_id=corpus_id,
            dialect=dialect,
            prefix=prefix,
            minimum=minimum,
            sort=sort,
            limit=limit,
            cursor=cursor,
        )

    @app.get("/v1/downloads", tags=["catalogue"])
    async def downloads(request: Request, response: Response) -> dict:
        _cache(response, 300)
        return store(request).downloads()

    @app.get("/v1/rights", tags=["catalogue"])
    async def rights(request: Request, response: Response) -> dict:
        _cache(response, 300)
        return store(request).metadata("rights")

    @app.get("/v1/models", tags=["catalogue"])
    async def models(request: Request, response: Response) -> dict:
        _cache(response, 300)
        return store(request).metadata("models")

    return app


app = create_app()
