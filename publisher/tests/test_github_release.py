from __future__ import annotations

import json
import subprocess

import pytest

from publisher.github_release import missing_assets, require_main_ci


@pytest.mark.parametrize("wrong_tag", [False, True])
def test_draft_resume_uploads_only_missing_identical_assets(tmp_path, monkeypatch, wrong_tag):
    from publisher import github_release as publication

    directory = tmp_path / "release"
    directory.mkdir()
    payload = directory / "payload.zip"
    payload.write_bytes(b"immutable data")
    commit = "a" * 40
    manifest = {
        "release_id": "fb-20240102-123456abcdef",
        "source": {"commit": "b" * 40},
        "kakarayan": {"commit": commit},
        "artifacts": [
            {
                "asset_name": payload.name,
                "path": payload.name,
                "bytes": payload.stat().st_size,
                "sha256": publication.digest(payload),
            }
        ],
    }
    (directory / "release-manifest.json").write_text(json.dumps(manifest))
    remote = {
        "id": 1,
        "tag_name": f"data-{manifest['release_id']}",
        "draft": True,
        "target_commitish": commit,
        "assets": [],
    }
    calls, created = [], []

    def api(path, **_kwargs):
        if "/matching-refs/" in path:
            return [[{"ref": f"refs/tags/{remote['tag_name']}"}]] if wrong_tag else [[]]
        if "/commits/" in path:
            return {"sha": "c" * 40}
        if "releases?" in path:
            return [[remote]] if created else [[]]
        return remote

    fail_once = True

    def gh(*arguments):
        nonlocal fail_once
        if arguments[1] == "create":
            created.append(arguments)
            assert arguments[arguments.index("--target") + 1] == commit
        elif arguments[1] == "upload":
            path = publication.Path(arguments[3])
            if path.name == "payload.zip" and fail_once:
                fail_once = False
                raise subprocess.CalledProcessError(1, arguments)
            calls.append(path.name)
            remote["assets"].append(
                {
                    "name": path.name,
                    "size": path.stat().st_size,
                    "state": "uploaded",
                    "digest": f"sha256:{publication.digest(path)}",
                }
            )
        return ""

    monkeypatch.setattr(publication, "require_main_ci", lambda *_args: 1)
    monkeypatch.setattr(publication, "api", api)
    monkeypatch.setattr(publication, "gh", gh)
    if wrong_tag:
        with pytest.raises(ValueError, match="another commit"):
            publication.publish_draft(directory, "FormosanBank/kakarayan", commit)
        assert not calls and not created
        return
    with pytest.raises(subprocess.CalledProcessError):
        publication.publish_draft(directory, "FormosanBank/kakarayan", commit)
    assert calls[0] == "release-manifest.json"
    publication.publish_draft(directory, "FormosanBank/kakarayan", commit)
    assert len(created) == 1
    assert sorted(calls) == ["SHA256SUMS", "payload.zip", "release-manifest.json"]
    remote["draft"] = False
    with pytest.raises(ValueError, match="Only a draft"):
        publication.publish_draft(directory, "FormosanBank/kakarayan", commit)
    assert len(calls) == 3


def test_partial_assets_resume_only_with_matching_digests():
    expected = {"a.zip": (12, "a" * 64), "release-manifest.json": (50, "b" * 64)}
    asset = {
        "name": "release-manifest.json",
        "size": 50,
        "state": "uploaded",
        "digest": f"sha256:{'b' * 64}",
    }
    assert missing_assets({"assets": [asset]}, expected) == ["a.zip"]
    for changed in ({"digest": None}, {"size": 51}, {"state": "starter"}, {"name": "unknown"}):
        with pytest.raises(ValueError):
            missing_assets({"assets": [{**asset, **changed}]}, expected)


@pytest.mark.parametrize("failure", [None, "failure", "pull_request", "fork", "behind"])
def test_ci_gate_requires_latest_success_on_trusted_main(monkeypatch, failure):
    repository = "FormosanBank/kakarayan"
    commit = "a" * 40
    run = {
        "id": 30,
        "head_sha": commit,
        "head_branch": "main",
        "event": "push",
        "head_repository": {"full_name": repository},
        "status": "completed",
        "conclusion": "success",
    }
    if failure == "failure":
        run["conclusion"] = "failure"
    if failure == "pull_request":
        run["event"] = "pull_request"
    if failure == "fork":
        run["head_repository"] = {"full_name": "outside/kakarayan"}

    def response(path, **_kwargs):
        if "/compare/" in path:
            return {"status": "behind" if failure == "behind" else "ahead"}
        return [{"workflow_runs": [run]}]

    monkeypatch.setattr("publisher.github_release.api", response)
    if failure:
        with pytest.raises(ValueError):
            require_main_ci(repository, commit)
    else:
        assert require_main_ci(repository, commit) == 30
