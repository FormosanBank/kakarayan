"""Measure the public query contract against a running release-scoped API."""

from __future__ import annotations

import argparse
import gzip
import json
import math
import platform
import statistics
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime
from pathlib import Path
from typing import Any


class BenchmarkError(RuntimeError):
    """Raised when the benchmark input or a measured response is invalid."""


def _request(base_url: str, path: str, parameters: dict[str, object]) -> tuple[float, bytes]:
    query = urllib.parse.urlencode(parameters, doseq=True)
    url = f"{base_url.rstrip('/')}{path}"
    if query:
        url = f"{url}?{query}"
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/json", "X-Kakarayan-Client": "benchmark-v1"},
    )
    started = time.perf_counter()
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            body = response.read(10 * 1024 * 1024 + 1)
    except urllib.error.HTTPError as error:
        detail = error.read(4096).decode("utf-8", errors="replace")
        raise BenchmarkError(f"{error.code} for {path}: {detail}") from error
    except OSError as error:
        raise BenchmarkError(f"Request failed for {path}: {error}") from error
    elapsed_ms = (time.perf_counter() - started) * 1000
    if len(body) > 10 * 1024 * 1024:
        raise BenchmarkError(f"Response exceeded the benchmark safety limit for {path}")
    return elapsed_ms, body


def _percentile(values: list[float], percentile: float) -> float:
    ordered = sorted(values)
    index = max(0, math.ceil(percentile * len(ordered)) - 1)
    return ordered[index]


def _json_object(body: bytes, name: str) -> dict[str, Any]:
    try:
        value = json.loads(body)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise BenchmarkError(f"{name} did not return UTF-8 JSON") from error
    if not isinstance(value, dict):
        raise BenchmarkError(f"{name} did not return a JSON object")
    return value


def _case(
    base_url: str,
    release_id: str,
    case: dict[str, Any],
    *,
    samples: int,
    warmups: int,
) -> tuple[dict[str, Any], dict[str, Any]]:
    name = case.get("name")
    path = case.get("path")
    parameters = case.get("parameters", {})
    if not isinstance(name, str) or not name:
        raise BenchmarkError("Every benchmark case needs a name")
    if not isinstance(path, str) or not path.startswith("/"):
        raise BenchmarkError(f"Benchmark case {name!r} has an invalid path")
    if not isinstance(parameters, dict):
        raise BenchmarkError(f"Benchmark case {name!r} has invalid parameters")
    path = path.replace("{release_id}", urllib.parse.quote(release_id, safe=""))

    first_ms, first_body = _request(base_url, path, parameters)
    first_document = _json_object(first_body, name)
    if first_document.get("release_id") not in {None, release_id}:
        raise BenchmarkError(f"Benchmark case {name!r} returned a different release")
    items = first_document.get("items")
    if case.get("require_items") and (not isinstance(items, list) or not items):
        raise BenchmarkError(f"Benchmark case {name!r} returned no representative items")

    for _ in range(warmups):
        _request(base_url, path, parameters)
    timings: list[float] = []
    payloads: list[int] = []
    compressed_payloads: list[int] = []
    for _ in range(samples):
        elapsed_ms, body = _request(base_url, path, parameters)
        timings.append(elapsed_ms)
        payloads.append(len(body))
        compressed_payloads.append(len(gzip.compress(body, mtime=0)))

    result: dict[str, Any] = {
        "name": name,
        "path": path,
        "parameters": parameters,
        "samples": samples,
        "first_ms": round(first_ms, 3),
        "p50_ms": round(statistics.median(timings), 3),
        "p95_ms": round(_percentile(timings, 0.95), 3),
        "maximum_ms": round(max(timings), 3),
        "response_bytes": max(payloads),
        "gzip_bytes": max(compressed_payloads),
    }
    maximum_p95 = case.get("maximum_p95_ms")
    maximum_first = case.get("maximum_first_ms")
    maximum_gzip = case.get("maximum_gzip_bytes")
    failures = []
    p95_ms = float(result["p95_ms"])
    first_result_ms = float(result["first_ms"])
    gzip_bytes = int(result["gzip_bytes"])
    if isinstance(maximum_p95, (int, float)) and p95_ms > maximum_p95:
        failures.append(f"p95 {p95_ms} ms exceeds {maximum_p95} ms")
    if isinstance(maximum_first, (int, float)) and first_result_ms > maximum_first:
        failures.append(f"first {first_result_ms} ms exceeds {maximum_first} ms")
    if isinstance(maximum_gzip, int) and gzip_bytes > maximum_gzip:
        failures.append(f"gzip payload {gzip_bytes} exceeds {maximum_gzip} bytes")
    result["passed"] = not failures
    result["failures"] = failures
    return result, first_document


def run(
    base_url: str,
    cases_path: Path,
    *,
    samples: int,
    warmups: int,
    network_profile: str,
) -> dict[str, Any]:
    if samples < 2 or warmups < 0:
        raise BenchmarkError("Samples must be at least two and warmups cannot be negative")
    _, ready_body = _request(base_url, "/readyz", {})
    ready = _json_object(ready_body, "readyz")
    release_id = ready.get("release_id")
    if ready.get("status") != "ready" or not isinstance(release_id, str):
        raise BenchmarkError("The query service is not ready")
    try:
        specification = json.loads(cases_path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise BenchmarkError(f"Cannot read benchmark cases: {error}") from error
    cases = specification.get("cases") if isinstance(specification, dict) else None
    if not isinstance(cases, list) or not cases:
        raise BenchmarkError("The benchmark specification has no cases")

    results = []
    documents: dict[str, dict[str, Any]] = {}
    for raw_case in cases:
        if not isinstance(raw_case, dict):
            raise BenchmarkError("Every benchmark case must be an object")
        result, document = _case(base_url, release_id, raw_case, samples=samples, warmups=warmups)
        results.append(result)
        documents[str(result["name"])] = document

    detail = specification.get("detail")
    if isinstance(detail, dict):
        source_case = detail.get("source_case")
        source = documents.get(source_case) if isinstance(source_case, str) else None
        items = source.get("items") if source else None
        identifier = items[0].get("id") if isinstance(items, list) and items else None
        if not isinstance(identifier, str):
            raise BenchmarkError("The detail benchmark source returned no record identifier")
        detail_case = {
            **detail,
            "path": str(detail.get("path", "")).replace(
                "{record_id}", urllib.parse.quote(identifier, safe="")
            ),
            "parameters": {},
        }
        result, _ = _case(base_url, release_id, detail_case, samples=samples, warmups=warmups)
        results.append(result)

    return {
        "schema_version": "1.0.0",
        "measured_at": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "release_id": release_id,
        "network_profile": network_profile,
        "runtime": {"python": platform.python_version(), "platform": platform.platform()},
        "samples_per_case": samples,
        "warmups_per_case": warmups,
        "passed": all(result["passed"] for result in results),
        "cases": results,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--cases", required=True, type=Path)
    parser.add_argument("--output", type=Path)
    parser.add_argument("--samples", type=int, default=20)
    parser.add_argument("--warmups", type=int, default=2)
    parser.add_argument("--network-profile", default="local-loopback")
    args = parser.parse_args(argv)
    report = run(
        args.base_url,
        args.cases,
        samples=args.samples,
        warmups=args.warmups,
        network_profile=args.network_profile,
    )
    encoded = json.dumps(report, ensure_ascii=False, indent=2, sort_keys=True) + "\n"
    if args.output:
        args.output.write_text(encoded, encoding="utf-8", newline="\n")
    print(encoded, end="")
    return 0 if report["passed"] else 1


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except BenchmarkError as error:
        raise SystemExit(f"benchmark failed: {error}") from error
