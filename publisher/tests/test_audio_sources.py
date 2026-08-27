import json
from pathlib import Path, PurePosixPath

import pytest

from publisher.audio_sources import AudioDataset, AudioSourceError, load_audio_sources


@pytest.mark.parametrize(
    ("mode", "xml_root", "source_path", "filename", "owner_type", "expected"),
    [
        (
            "language_file",
            "Corpora/TestCorpus/XML/Grammar",
            "Corpora/TestCorpus/XML/Grammar/Amis/lesson.xml",
            "clip.wav",
            "sentence",
            "Amis/clip.wav",
        ),
        (
            "xml_stem",
            "Corpora/TestCorpus/XML/Collection",
            "Corpora/TestCorpus/XML/Collection/Amis/lesson.xml",
            "clip.wav",
            "sentence",
            "Amis/lesson/clip.wav",
        ),
        (
            "ilrdf",
            "Corpora/TestCorpus/XML",
            "Corpora/TestCorpus/XML/Rukai/Rukai.xml",
            "second.mp3",
            "sentence",
            "Rukai/Rukai/batch_2/second.mp3",
        ),
        (
            "ntu_paiwan_sources",
            "Corpora/TestCorpus/XML",
            "Corpora/TestCorpus/XML/Paiwan/Maron/session.xml",
            "session.wav",
            "text",
            "Paiwan/Maron/session.wav",
        ),
    ],
)
def test_manifest_path_modes_follow_the_public_audio_contract(
    mode: str,
    xml_root: str,
    source_path: str,
    filename: str,
    owner_type: str,
    expected: str,
) -> None:
    dataset = AudioDataset(
        corpus="TestCorpus",
        repo_id="FormosanBank/TestCorpusAudio",
        revision="1" * 40,
        path_mode=mode,
        xml_root=PurePosixPath(xml_root),
        files=frozenset(),
        rukai_batch_2_files=frozenset({"second.mp3"}),
    )

    assert dataset.remote_path(
        PurePosixPath(source_path), PurePosixPath(filename), owner_type
    ) == PurePosixPath(expected)


def test_public_audio_url_is_pinned_to_the_declared_dataset(public_repo: Path) -> None:
    sources = load_audio_sources(public_repo)

    assert sources.playback_urls(
        "Corpora/TestCorpus/XML/fixture.xml", "sentence.wav", "sentence"
    ) == (
        "https://huggingface.co/datasets/FormosanBank/TestCorpusAudio/resolve/"
        "1111111111111111111111111111111111111111/sentence.wav",
    )
    assert (
        sources.playback_urls("Corpora/OtherCorpus/XML/fixture.xml", "sentence.wav", "sentence")
        == ()
    )


def test_explicit_audio_paths_are_limited_to_the_declared_corpus() -> None:
    dataset = AudioDataset(
        corpus="TestCorpus",
        repo_id="FormosanBank/TestCorpusAudio",
        revision="1" * 40,
        path_mode="explicit",
        xml_root=None,
        files=frozenset({"clip.wav"}),
        rukai_batch_2_files=frozenset(),
    )

    assert dataset.remote_path(
        PurePosixPath("Corpora/TestCorpus/XML/fixture.xml"),
        PurePosixPath("clip.wav"),
        "sentence",
    ) == PurePosixPath("clip.wav")
    assert (
        dataset.remote_path(
            PurePosixPath("Corpora/OtherCorpus/XML/fixture.xml"),
            PurePosixPath("clip.wav"),
            "sentence",
        )
        is None
    )


def test_audio_contract_rejects_unsafe_paths(public_repo: Path) -> None:
    manifest = public_repo / "audio_sources.json"
    document = json.loads(manifest.read_text(encoding="utf-8"))
    document["datasets"][0]["xml_root"] = "../private"
    manifest.write_text(json.dumps(document), encoding="utf-8")

    with pytest.raises(AudioSourceError, match="audio XML root"):
        load_audio_sources(public_repo)


def test_overlapping_source_repositories_become_ordered_playback_candidates(
    public_repo: Path,
) -> None:
    manifest = public_repo / "audio_sources.json"
    document = json.loads(manifest.read_text(encoding="utf-8"))
    first = document["datasets"][0]
    first["path_mode"] = "ntu_paiwan_sources"
    second = {
        **first,
        "repo_id": "FormosanBank/TestCorpusAudioYear2",
        "revision": "2222222222222222222222222222222222222222",
    }
    document["datasets"].append(second)
    manifest.write_text(json.dumps(document), encoding="utf-8")
    sources = load_audio_sources(public_repo)

    assert sources.playback_urls("Corpora/TestCorpus/XML/fixture.xml", "session.wav", "text") == (
        "https://huggingface.co/datasets/FormosanBank/TestCorpusAudio/resolve/"
        "1111111111111111111111111111111111111111/session.wav",
        "https://huggingface.co/datasets/FormosanBank/TestCorpusAudioYear2/resolve/"
        "2222222222222222222222222222222222222222/session.wav",
    )
    assert (
        sources.playback_urls("Corpora/TestCorpus/XML/fixture.xml", "sentence.wav", "sentence")
        == ()
    )
