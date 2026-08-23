from __future__ import annotations

import json
import os
import subprocess

import pytest

from api.errors import ApiError
from api.prepare_release import prepare_release
from api.release import load_release
from api.store import CorpusStore
from publisher.build import build_release


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


def test_previous_immutable_release_can_be_reactivated(
    release, settings, public_repo, tmp_path
) -> None:
    source = next(public_repo.glob("Corpora/*/XML/*.xml"))
    source.write_text(source.read_text().replace("toki rima", "toki rima o"))
    subprocess.run(["git", "-C", str(public_repo), "add", "."], check=True)
    environment = {
        **os.environ,
        "GIT_AUTHOR_DATE": "2024-01-03T03:04:05+00:00",
        "GIT_COMMITTER_DATE": "2024-01-03T03:04:05+00:00",
    }
    subprocess.run(
        ["git", "-C", str(public_repo), "commit", "-qm", "second fixture"],
        check=True,
        env=environment,
    )
    second = build_release(public_repo, tmp_path / "second-release")
    database = tmp_path / "active" / "formosanbank.sqlite"
    active = tmp_path / "active" / "release-manifest.json"
    prepare_release(str(second.output / "release-manifest.json"), database, active)
    assert json.loads(active.read_text())["release_id"] == second.release_id
    second_state = load_release(
        type(settings)(
            manifest_path=active,
            database_path=database,
            expected_sha256=None,
            cors_origins=(),
        )
    )
    with CorpusStore(second_state, query_step_limit=200_000) as running_store:
        prepare_release(str(release.output / "release-manifest.json"), database, active)
        configured = type(settings)(
            manifest_path=active,
            database_path=database,
            expected_sha256=None,
            cors_origins=(),
        )
        with pytest.raises(ApiError, match="active query database changed") as mismatch:
            running_store.check_ready()
        assert mismatch.value.code == "release_mismatch"
        assert load_release(configured).manifest["release_id"] == release.release_id
