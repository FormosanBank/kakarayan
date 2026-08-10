from pathlib import Path

import pytest

from publisher.assemble_space import assemble_space
from publisher.build import BuildError


def test_assemble_space_pins_release(tmp_path: Path) -> None:
    source = Path(__file__).resolve().parents[2] / "api"
    output = tmp_path / "space"
    release_id = "fb-20240102-deadbeef"
    assemble_space(source, output, release_id)

    dockerfile = (output / "Dockerfile").read_text(encoding="utf-8")
    assert f"data-{release_id}/release-manifest.json" in dockerfile
    assert "KAKARAYAN_CORS_ORIGINS=https://formosanbank.github.io" in dockerfile
    assert (output / "README.md").is_file()
    assert not (output / "tests").exists()


def test_assemble_space_rejects_invalid_release(tmp_path: Path) -> None:
    source = Path(__file__).resolve().parents[2] / "api"
    with pytest.raises(BuildError, match="Invalid release"):
        assemble_space(source, tmp_path / "space", "latest")
