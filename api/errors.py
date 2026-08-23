"""Stable public error responses."""

from __future__ import annotations

from typing import Any

from fastapi import Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class ApiError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        *,
        field: str | None = None,
        headers: dict[str, str] | None = None,
    ) -> None:
        self.status = status
        self.code = code
        self.message = message
        self.field = field
        self.headers = headers or {}
        super().__init__(message)

    def body(self) -> dict[str, dict[str, Any]]:
        error: dict[str, Any] = {
            "code": self.code,
            "message": self.message,
            "status": self.status,
        }
        if self.field:
            error["field"] = self.field
        return {"error": error}


async def api_error_handler(_request: Request, error: ApiError) -> JSONResponse:
    return JSONResponse(status_code=error.status, content=error.body(), headers=error.headers)


async def validation_error_handler(
    _request: Request,
    error: RequestValidationError,
) -> JSONResponse:
    detail = error.errors()[0] if error.errors() else {}
    location = detail.get("loc", ())
    field = str(location[-1]) if location else None
    api_error = ApiError(
        422,
        "invalid_parameter",
        str(detail.get("msg", "Request validation failed")),
        field=field,
    )
    return JSONResponse(status_code=api_error.status, content=api_error.body())
