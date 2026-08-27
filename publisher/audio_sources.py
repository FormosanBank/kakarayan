"""Resolve release-pinned public audio mirrors declared by FormosanBank."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path, PurePosixPath
from urllib.parse import quote

_COMMIT_RE = re.compile(r"^[0-9a-f]{40}$")
_MODES = {"explicit", "ilrdf", "language_file", "ntu_paiwan_sources", "root_file", "xml_stem"}


class AudioSourceError(ValueError):
    """Raised when the canonical public audio contract is malformed."""


def _relative_path(value: str, *, field: str) -> PurePosixPath:
    path = PurePosixPath(value.replace("\\", "/"))
    if not value or path.is_absolute() or ".." in path.parts:
        raise AudioSourceError(f"Invalid {field}: {value!r}")
    return path


@dataclass(frozen=True)
class AudioDataset:
    corpus: str
    repo_id: str
    revision: str
    path_mode: str
    xml_root: PurePosixPath | None
    files: frozenset[str]
    rukai_batch_2_files: frozenset[str]

    def remote_path(
        self,
        source_path: PurePosixPath,
        filename: PurePosixPath,
        owner_type: str,
    ) -> PurePosixPath | None:
        if self.path_mode == "explicit":
            if source_path.parts[:3] != ("Corpora", self.corpus, "XML"):
                return None
            return filename if filename.as_posix() in self.files else None
        if self.xml_root is None:
            return None
        try:
            relative = source_path.relative_to(self.xml_root)
        except ValueError:
            return None
        if self.path_mode == "root_file":
            return filename
        if self.path_mode == "language_file":
            return PurePosixPath(relative.parts[0]) / filename
        if self.path_mode == "xml_stem":
            return relative.parent / relative.stem / filename
        if self.path_mode == "ilrdf":
            result = relative.parent / relative.stem
            if relative.parts[0] == "Rukai":
                batch = "batch_2" if filename.name in self.rukai_batch_2_files else "batch_1"
                result /= batch
            return result / filename
        if self.path_mode == "ntu_paiwan_sources" and owner_type == "text":
            return relative.parent / filename
        return None


@dataclass(frozen=True)
class AudioSources:
    datasets: tuple[AudioDataset, ...]

    def playback_urls(self, source_path: str, filename: str, owner_type: str) -> tuple[str, ...]:
        if not filename:
            return ()
        source = _relative_path(source_path, field="audio source path")
        audio_file = _relative_path(filename, field="audio filename")
        urls: list[str] = []
        for dataset in self.datasets:
            remote = dataset.remote_path(source, audio_file, owner_type)
            if remote is None:
                continue
            encoded = quote(remote.as_posix(), safe="/")
            urls.append(
                f"https://huggingface.co/datasets/{dataset.repo_id}/resolve/"
                f"{dataset.revision}/{encoded}"
            )
        return tuple(urls)


def load_audio_sources(repo: Path) -> AudioSources:
    """Load and validate the public audio mirror contract from the source revision."""
    path = repo / "audio_sources.json"
    if not path.is_file():
        return AudioSources(())
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("schema_version") != 1 or not isinstance(document.get("datasets"), list):
        raise AudioSourceError("audio_sources.json must use schema version 1 with datasets")
    datasets: list[AudioDataset] = []
    for item in document["datasets"]:
        if not isinstance(item, dict):
            raise AudioSourceError("audio_sources.json datasets must be objects")
        corpus = item.get("corpus")
        repo_id = item.get("repo_id")
        revision = item.get("revision")
        path_mode = item.get("path_mode")
        if not isinstance(corpus, str) or not corpus:
            raise AudioSourceError("Audio dataset corpus must be a non-empty string")
        if not isinstance(repo_id, str) or repo_id.count("/") != 1:
            raise AudioSourceError(f"Invalid audio dataset repository: {repo_id!r}")
        if not isinstance(revision, str) or not _COMMIT_RE.fullmatch(revision):
            raise AudioSourceError(f"Invalid audio dataset revision: {revision!r}")
        if path_mode not in _MODES:
            raise AudioSourceError(f"Invalid audio path mode: {path_mode!r}")
        xml_root_value = item.get("xml_root")
        xml_root = (
            _relative_path(xml_root_value, field="audio XML root")
            if isinstance(xml_root_value, str) and xml_root_value
            else None
        )
        files = item.get("files", [])
        batch_2 = item.get("rukai_batch_2_files", [])
        if not isinstance(files, list) or not all(isinstance(value, str) for value in files):
            raise AudioSourceError(f"Invalid explicit audio files for {repo_id}")
        if not isinstance(batch_2, list) or not all(isinstance(value, str) for value in batch_2):
            raise AudioSourceError(f"Invalid Rukai batch list for {repo_id}")
        datasets.append(
            AudioDataset(
                corpus=corpus,
                repo_id=repo_id,
                revision=revision,
                path_mode=path_mode,
                xml_root=xml_root,
                files=frozenset(files),
                rukai_batch_2_files=frozenset(batch_2),
            )
        )
    datasets.sort(
        key=lambda item: len(item.xml_root.parts) if item.xml_root is not None else 0,
        reverse=True,
    )
    return AudioSources(tuple(datasets))
