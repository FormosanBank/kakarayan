from __future__ import annotations

import gzip
import hashlib
import json
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any

import pytest

from clients.python.kakarayan_client.client import KakarayanClient, KakarayanError


class Handler(BaseHTTPRequestHandler):
    def do_GET(self) -> None:
        if self.path.startswith("/v1/frequencies"):
            body: Any = {"items": [{"form": "lima"}], "next_cursor": None}
            release = "release-1"
        elif self.path.endswith("/meta.json"):
            body = {"release_id": "release-1"}
            release = None
        elif self.path.endswith("/languages.json"):
            body = [{"id": "lang_amis"}]
            release = None
        elif self.path == "/artifact":
            raw = b"verified fixture"
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        elif self.path.endswith(".json.gz"):
            content = json.dumps([{"id": "sentence_fixture"}]).encode()
            raw = gzip.compress(content, mtime=0)
            self.send_response(200)
            self.send_header("Content-Length", str(len(raw)))
            self.end_headers()
            self.wfile.write(raw)
            return
        else:
            body = {"error": {"code": "missing", "message": "Missing", "status": 404}}
            self.send_response(404)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(body).encode())
            return
        raw = json.dumps(body).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        if release:
            self.send_header("X-Kakarayan-Release", release)
        self.end_headers()
        self.wfile.write(raw)

    def log_message(self, _format: str, *_arguments: object) -> None:
        pass


@pytest.fixture
def server() -> str:
    httpd = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=httpd.serve_forever, daemon=True)
    thread.start()
    try:
        host, port = httpd.server_address
        yield f"http://{host}:{port}"
    finally:
        httpd.shutdown()
        thread.join()


def test_static_release_pin_and_live_query(server: str) -> None:
    static = KakarayanClient(server, release_id="release-1")
    assert static.languages() == [{"id": "lang_amis"}]
    live = KakarayanClient(server, mode="live", release_id="release-1")
    assert live.frequencies("lang_amis")["items"][0]["form"] == "lima"


def test_structured_error(server: str) -> None:
    client = KakarayanClient(server, mode="live")
    with pytest.raises(KakarayanError) as caught:
        client._json("/missing")
    assert caught.value.code == "missing"
    assert caught.value.status == 404


def test_verified_download(server: str, tmp_path: Path) -> None:
    client = KakarayanClient(server)
    destination = tmp_path / "artifact"
    client.download(
        f"{server}/artifact",
        destination,
        "f9adb7d924ed98c558040c910600d7363d749e7d20e8d355626edd53b4fb929f",
    )
    assert destination.read_bytes() == b"verified fixture"


def test_verified_compressed_search_shard(server: str) -> None:
    content = json.dumps([{"id": "sentence_fixture"}]).encode()
    compressed = gzip.compress(content, mtime=0)
    client = KakarayanClient(server)
    assert client.search_shard(
        "search/shards/lang_amis/corpus_fixture/0000.json.gz",
        hashlib.sha256(compressed).hexdigest(),
        hashlib.sha256(content).hexdigest(),
    ) == [{"id": "sentence_fixture"}]
