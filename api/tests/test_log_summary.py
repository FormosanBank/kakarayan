import json

from api.log_summary import summarize


def test_operator_summary_distinguishes_errors_and_incomplete_responses():
    rows = ["container startup", "not JSON"]
    for status, outcome, duration in [
        (200, "completed", 10),
        (200, "failed", 900),
        (503, "completed", 1000),
        (200, "disconnected", 2000),
    ]:
        rows.append(
            "api-1 | INFO: "
            + json.dumps(
                {
                    "event": "request",
                    "route": "/readyz",
                    "status": status,
                    "outcome": outcome,
                    "duration_ms": duration,
                    "queue_wait_ms": 5,
                    "database_slot_ms": 0,
                    "response_bytes": 123,
                    "rows_serialized": 10,
                    "q": "never copy user input",
                    "client_ip": "192.0.2.1",
                }
            )
        )
    result = summarize(iter(rows))
    report = result["routes"]["/readyz"]
    assert report["requests"] == 4 and report["http_errors"] == 1 and report["incomplete"] == 2
    assert report["response_bytes"] == 492 and report["rows_serialized"] == 40
    assert report["p95_upper_bound_ms"]["duration_ms"] == 2000
    assert "never copy" not in json.dumps(result) and "192.0.2.1" not in json.dumps(result)
