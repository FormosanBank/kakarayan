"""Build the invented FormosanBank fixture release used by CI and local demos."""

from __future__ import annotations

import argparse
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from publisher.build import build_release


def _run(*args: str, env: dict[str, str] | None = None) -> None:
    subprocess.run(args, check=True, env=env)


def build_fixture(output: Path, *, include_prepared: bool = False) -> None:
    fixture = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "formosanbank"
    rights = Path(__file__).resolve().parents[1] / "tests" / "fixtures" / "rights-overrides.json"
    with tempfile.TemporaryDirectory(prefix="kakarayan-fixture-") as temporary:
        repo = Path(temporary) / "FormosanBank"
        shutil.copytree(fixture, repo)
        _run("git", "init", "-q", str(repo))
        _run("git", "-C", str(repo), "config", "user.name", "Kakarayan Tests")
        _run("git", "-C", str(repo), "config", "user.email", "tests@example.invalid")
        _run(
            "git",
            "-C",
            str(repo),
            "remote",
            "add",
            "origin",
            "https://github.com/FormosanBank/FormosanBank.git",
        )
        _run("git", "-C", str(repo), "add", ".")
        environment = {
            **os.environ,
            "GIT_AUTHOR_DATE": "2024-01-02T03:04:05+00:00",
            "GIT_COMMITTER_DATE": "2024-01-02T03:04:05+00:00",
        }
        _run("git", "-C", str(repo), "commit", "-qm", "fixture", env=environment)
        build_release(
            repo,
            output,
            rights_overrides=rights,
            include_prepared=include_prepared,
            site_only=not include_prepared,
        )


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--include-prepared", action="store_true")
    args = parser.parse_args(argv)
    build_fixture(args.output, include_prepared=args.include_prepared)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
