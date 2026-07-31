from __future__ import annotations

import os
import shutil
import subprocess
from pathlib import Path

import pytest


@pytest.fixture
def public_repo(tmp_path: Path) -> Path:
    source = Path(__file__).resolve().parents[2] / "tests" / "fixtures" / "formosanbank"
    repo = tmp_path / "FormosanBank"
    shutil.copytree(source, repo)
    subprocess.run(["git", "init", "-q", str(repo)], check=True)
    subprocess.run(["git", "-C", str(repo), "config", "user.name", "Kakarayan Tests"], check=True)
    subprocess.run(
        ["git", "-C", str(repo), "config", "user.email", "tests@example.invalid"], check=True
    )
    subprocess.run(
        [
            "git",
            "-C",
            str(repo),
            "remote",
            "add",
            "origin",
            "https://github.com/FormosanBank/FormosanBank.git",
        ],
        check=True,
    )
    subprocess.run(["git", "-C", str(repo), "add", "."], check=True)
    env = {
        **os.environ,
        "GIT_AUTHOR_DATE": "2024-01-02T03:04:05+00:00",
        "GIT_COMMITTER_DATE": "2024-01-02T03:04:05+00:00",
    }
    subprocess.run(["git", "-C", str(repo), "commit", "-qm", "fixture"], check=True, env=env)
    return repo
