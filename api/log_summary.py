"""Summarize bounded request logs from stdin without retaining request content."""

import json
import math
import sys
from collections import Counter
from collections.abc import Iterable

_BOUNDS = (5, 10, 25, 50, 100, 250, 500, 1000, 2000, 5000, 10000, 30000, 60000, 120000)
_TIMINGS = ("duration_ms", "queue_wait_ms", "database_slot_ms")


def summarize(lines: Iterable[str]) -> dict:
    groups: dict[str, dict] = {}
    ignored = 0
    for line in lines:
        try:
            event = json.loads(line[line.index("{") :])
        except (ValueError, json.JSONDecodeError):
            ignored += 1
            continue
        if not isinstance(event, dict) or event.get("event") != "request":
            continue
        route = event.get("route")
        if not isinstance(route, str) or len(route) > 128 or "?" in route:
            ignored += 1
            continue
        if route not in groups and len(groups) == 64:
            ignored += 1
            continue
        group = groups.setdefault(
            route,
            {
                "requests": 0,
                "http_errors": 0,
                "incomplete": 0,
                "response_bytes": 0,
                "rows_serialized": 0,
                "outcomes": Counter(),
                "status": Counter(),
                "timings": {name: Counter() for name in _TIMINGS},
            },
        )
        status = event.get("status")
        outcome = event.get("outcome")
        if (
            not isinstance(status, int)
            or not 100 <= status < 600
            or outcome not in {"completed", "failed", "disconnected"}
        ):
            ignored += 1
            continue
        group["requests"] += 1
        group["http_errors"] += status >= 400
        group["incomplete"] += outcome != "completed"
        group["status"][str(status)] += 1
        group["outcomes"][outcome] += 1
        for key in ("response_bytes", "rows_serialized"):
            value = event.get(key)
            if isinstance(value, int) and value >= 0:
                group[key] += value
        for name in _TIMINGS:
            value = event.get(name)
            if isinstance(value, (int, float)) and math.isfinite(value) and value >= 0:
                bucket = next((bound for bound in _BOUNDS if value <= bound), "over_120000")
                group["timings"][name][bucket] += 1
    for group in groups.values():
        group["p95_upper_bound_ms"] = {}
        for name, histogram in group.pop("timings").items():
            threshold = math.ceil(sum(histogram.values()) * 0.95)
            cumulative = 0
            upper = None
            for bucket in (*_BOUNDS, "over_120000"):
                cumulative += histogram[bucket]
                if cumulative >= threshold and threshold:
                    upper = bucket
                    break
            group["p95_upper_bound_ms"][name] = upper
    return {
        "routes": groups,
        "ignored_lines": ignored,
        "meaning": (
            "Requests are not unique people. Completed means the server sent the final body, "
            "not that a user saved the file. Timings are histogram upper bounds; "
            "database slot time includes serialization."
        ),
    }


if __name__ == "__main__":
    print(json.dumps(summarize(sys.stdin), indent=2))
