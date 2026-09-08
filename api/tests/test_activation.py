from __future__ import annotations

import fcntl
import json
import os
import subprocess
from collections import namedtuple

import pytest
from fastapi.testclient import TestClient

from api.app import create_app
from api.prepare_release import prepare_release
from api.release import ReleaseError, load_release
from api.store import CorpusStore
from publisher.build import build_release


def test_release_is_fully_prepared_before_startup(release, settings, tmp_path) -> None:
    root = tmp_path / "data"
    database = root / "current" / "formosanbank.sqlite"
    active = root / "current" / "release-manifest.json"
    prepare_release(str(release.output / "release-manifest.json"), root)
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
    root = tmp_path / "active"
    database = root / "current" / "formosanbank.sqlite"
    active = root / "current" / "release-manifest.json"
    prepare_release(str(second.output / "release-manifest.json"), root)
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
        prepare_release(str(release.output / "release-manifest.json"), root)
        configured = type(settings)(
            manifest_path=active,
            database_path=database,
            expected_sha256=None,
            cors_origins=(),
        )
        running_store.check_ready()
        assert running_store.release_id == second.release_id
        assert running_store.state.database_path.parent.name == second.release_id
        assert load_release(configured).manifest["release_id"] == release.release_id


def test_activation_rejects_low_disk_wrong_owner_and_concurrent_writer(
    release, tmp_path, monkeypatch
):
    root = tmp_path / "data"
    root.mkdir()
    source = str(release.output / "release-manifest.json")
    usage = namedtuple("Usage", "total used free")
    with monkeypatch.context() as patch:
        patch.setattr("api.prepare_release.shutil.disk_usage", lambda _root: usage(100, 99, 1))
        with pytest.raises(ReleaseError, match="Not enough free disk"):
            prepare_release(source, root)
    assert not (root / "current").exists()
    with monkeypatch.context() as patch:
        patch.setattr("api.prepare_release.os.geteuid", lambda: root.stat().st_uid + 1)
        with pytest.raises(ReleaseError, match="owned by"):
            prepare_release(source, root)
    with (root / ".activation.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        with pytest.raises(ReleaseError, match="Another release activation"):
            prepare_release(source, root)


@pytest.mark.parametrize("failure", ["download", "validation", "selection"])
def test_failed_activation_never_changes_current_generation(
    release, tmp_path, monkeypatch, failure
):
    root = tmp_path / "data"
    original = root / "generations" / "old"
    original.mkdir(parents=True)
    (original / "release-manifest.json").write_text('{"release_id":"old"}')
    (root / "current").symlink_to("generations/old")

    def fail(*_args, **_kwargs):
        raise ReleaseError("injected failure")

    target = {
        "download": "_acquire",
        "validation": "_validate_generation",
        "selection": "_select_generation",
    }[failure]
    monkeypatch.setattr(f"api.prepare_release.{target}", fail)
    with pytest.raises(ReleaseError, match="injected failure"):
        prepare_release(str(release.output / "release-manifest.json"), root)
    assert (root / "current").resolve() == original
    assert not list(root.glob(".staging-*"))


def test_retained_generation_reactivation_needs_no_download(release, tmp_path, monkeypatch):
    root = tmp_path / "data"
    source = str(release.output / "release-manifest.json")
    first = prepare_release(source, root)

    def fail(*_args, **_kwargs):
        raise AssertionError("a retained generation was downloaded again")

    monkeypatch.setattr("api.prepare_release._acquire", fail)
    assert prepare_release(source, root) == first


def test_failed_restart_can_recover_the_retained_generation(release, settings, tmp_path):
    root = tmp_path / "data"
    source = str(release.output / "release-manifest.json")
    prepare_release(source, root)
    configured = type(settings)(
        manifest_path=root / "current" / "release-manifest.json",
        database_path=root / "current" / "formosanbank.sqlite",
        expected_sha256=None,
        cors_origins=(),
    )
    with TestClient(create_app(configured)) as old:
        query = f"/v1/releases/{release.release_id}/dictionary"
        params = {"q": "lima", "language_id": "lang_amis", "match": "exact"}
        baseline = old.get(query, params=params).json()
        broken = root / "generations" / "broken"
        broken.mkdir()
        (broken / "release-manifest.json").write_text("{}")
        replacement = root / "replacement"
        replacement.symlink_to("generations/broken")
        replacement.replace(root / "current")
        with TestClient(create_app(configured)) as failed:
            assert failed.get("/readyz").status_code == 503
        assert old.get(query, params=params).json() == baseline
        prepare_release(source, root)
        with TestClient(create_app(configured)) as recovered:
            assert recovered.get("/readyz").json()["release_id"] == release.release_id
            assert recovered.get(query, params=params).json() == baseline
