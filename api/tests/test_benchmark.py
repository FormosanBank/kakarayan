from __future__ import annotations

import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from api.benchmark import run


class _Handler(BaseHTTPRequestHandler):
    release_id = "fb-20240102-3b367525"

    def do_GET(self) -> None:  # noqa: N802
        body: dict[str, object]
        if self.path == "/readyz":
            body = {"status": "ready", "release_id": self.release_id}
        elif "/sentences/" in self.path:
            body = {"release_id": self.release_id, "id": "sentence_test"}
        else:
            body = {
                "release_id": self.release_id,
                "items": [{"id": "sentence_test", "standard": "lima waco"}],
            }
        encoded = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)

    def log_message(self, format: str, *args: object) -> None:
        return


def test_benchmark_measures_cases_and_followed_detail(tmp_path) -> None:
    specification = {
        "cases": [
            {
                "name": "sentence exact",
                "path": "/v1/releases/{release_id}/concordance",
                "parameters": {"q": "lima"},
                "require_items": True,
                "maximum_p95_ms": 1000,
                "maximum_gzip_bytes": 1024,
            }
        ],
        "detail": {
            "name": "sentence detail",
            "source_case": "sentence exact",
            "path": "/v1/releases/{release_id}/sentences/{record_id}",
            "maximum_p95_ms": 1000,
        },
    }
    cases = tmp_path / "cases.json"
    cases.write_text(json.dumps(specification), encoding="utf-8")
    server = ThreadingHTTPServer(("127.0.0.1", 0), _Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        report = run(
            f"http://127.0.0.1:{server.server_port}",
            cases,
            samples=2,
            warmups=0,
            network_profile="test-loopback",
        )
    finally:
        server.shutdown()
        thread.join()
        server.server_close()

    assert report["passed"] is True
    assert report["release_id"] == _Handler.release_id
    assert [case["name"] for case in report["cases"]] == [
        "sentence exact",
        "sentence detail",
    ]
    assert all(case["samples"] == 2 for case in report["cases"])
