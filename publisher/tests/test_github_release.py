from __future__ import annotations

import pytest

from publisher.github_release import missing_assets, require_main_ci


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
