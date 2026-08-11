from __future__ import annotations

import json

from api.prepare_release import prepare_release
from api.release import load_release


def test_release_is_fully_prepared_before_startup(release, settings, tmp_path) -> None:
    database = tmp_path / "data" / "formosanbank.sqlite"
    active = tmp_path / "data" / "active-release.json"
    prepare_release(str(release.output / "release-manifest.json"), database, active)
    configured = type(settings)(
        manifest_path=active,
        database_path=database,
        expected_sha256=None,
        cors_origins=(),
    )
    state = load_release(configured)
    assert state.manifest["release_id"] == release.release_id
    assert json.loads(active.read_text())["release_id"] == release.release_id
