"""Load one corpus (or all) from FormosanBank XML into the corpus tables.

Per-corpus **delete-and-reload**: the corpus is a derived read-model, so re-ingesting a
changed corpus just wipes and rebuilds its rows (cascades from ``Text``). Each corpus is
loaded inside a single transaction by the caller.

Token derivation (per sentence):
- word-segmented sentence (has ``<W>``): one ``Token`` per word, linked via ``word``;
- otherwise: the sentence FORM (standard, else original) is whitespace-tokenized, one
  ``Token`` per chunk (``word`` null). ``surface_original`` is filled by positional
  alignment when the two tiers tokenize to equal length.

``Sentence.token_count`` is always the canonical FORM-based count
(``len(tokenize(standard|original))``) so it reconciles with FormosanBank corpus stats,
independent of how many ``Token`` rows a segmented sentence yields.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

from django.conf import settings

from corpus.ingestion import parse
from corpus.ingestion.normalize import normalize_gloss, normalize_surface, tokenize
from corpus.models import (
    AudioSegment,
    Corpus,
    Dialect,
    Language,
    Morpheme,
    Sentence,
    Text,
    TextAudio,
    Token,
    Translation,
    Word,
)


@dataclass
class LoadStats:
    texts: int = 0
    sentences: int = 0
    words: int = 0
    morphemes: int = 0
    translations: int = 0
    audio_segments: int = 0
    tokens: int = 0
    token_count: int = 0  # canonical FORM-based token count (for reconciliation)
    parse_errors: list = field(default_factory=list)

    def add(self, other: "LoadStats") -> None:
        self.texts += other.texts
        self.sentences += other.sentences
        self.words += other.words
        self.morphemes += other.morphemes
        self.translations += other.translations
        self.audio_segments += other.audio_segments
        self.tokens += other.tokens
        self.token_count += other.token_count
        self.parse_errors.extend(other.parse_errors)

    def as_dict(self) -> dict:
        return {
            "texts": self.texts,
            "sentences": self.sentences,
            "words": self.words,
            "morphemes": self.morphemes,
            "translations": self.translations,
            "audio_segments": self.audio_segments,
            "tokens": self.tokens,
            "token_count": self.token_count,
            "parse_errors": len(self.parse_errors),
        }


class _RefCache:
    """Resolve (xml_lang, dialect) -> (Language, Dialect) with in-run caching."""

    def __init__(self):
        self._lang: dict[str, Language] = {}
        self._dialect: dict[tuple[int, str], Dialect] = {}
        self._cc = parse.get_corpus_counts()

    def language(self, xml_lang: str, dialect_attr: str) -> Language:
        name = self._cc.resolve_language(xml_lang, dialect_attr)
        key = name or f"iso:{xml_lang or 'unknown'}"
        cached = self._lang.get(key)
        if cached:
            return cached
        if name:
            lang = Language.objects.get(name=name)
        else:
            lang, _ = Language.objects.get_or_create(
                name=(xml_lang or "unknown"),
                defaults={"iso639_3": xml_lang or ""},
            )
        self._lang[key] = lang
        return lang

    def dialect(self, language: Language, dialect_attr: str) -> Dialect:
        label = dialect_attr or "unknown"
        key = (language.pk, label)
        cached = self._dialect.get(key)
        if cached:
            return cached
        dialect, _ = Dialect.objects.get_or_create(language=language, name=label)
        self._dialect[key] = dialect
        return dialect


def _batch() -> int:
    return int(getattr(settings, "INGEST_BATCH_SIZE", 2000) or 2000)


def load_corpus(
    corpus: Corpus,
    corpus_root: Path,
    run=None,
    language_names: set[str] | None = None,
) -> LoadStats:
    """Delete and reload a corpus. Caller wraps this in a transaction.

    ``language_names`` scopes the reload: when given, only ``Text`` rows of those
    (resolved) display languages are deleted and only matching XML files are loaded,
    leaving other languages in the corpus untouched. When ``None``, the whole corpus is
    reloaded.
    """
    cache = _RefCache()
    stats = LoadStats()

    if language_names is None:
        Text.objects.filter(corpus=corpus).delete()
    else:
        Text.objects.filter(
            corpus=corpus, language__name__in=language_names
        ).delete()

    for xml_path in parse.discover_corpus_xml(corpus_root):
        try:
            parsed = parse.parse_text_file(xml_path)
        except Exception as exc:  # malformed XML — record, keep going
            stats.parse_errors.append({"path": str(xml_path), "error": str(exc)})
            continue
        if parsed is None:
            continue
        if language_names is not None:
            language = cache.language(parsed["xml_lang"], parsed["dialect"])
            if language.name not in language_names:
                continue
        _load_text(corpus, corpus_root, xml_path, parsed, cache, run, stats)
    return stats


def _load_text(corpus, corpus_root, xml_path, parsed, cache, run, stats) -> None:
    language = cache.language(parsed["xml_lang"], parsed["dialect"])
    dialect = cache.dialect(language, parsed["dialect"])
    bs = _batch()

    text = Text.objects.create(
        corpus=corpus,
        ingestion_run=run,
        language=language,
        dialect=dialect,
        text_xml_id=parsed["text_xml_id"],
        source_path=str(Path(xml_path).relative_to(settings.FORMOSANBANK_REPO))
        if settings.FORMOSANBANK_REPO in str(xml_path)
        else str(xml_path),
        xml_lang=parsed["xml_lang"],
        citation=parsed["citation"],
        bibtex_citation=parsed["bibtex_citation"],
        copyright=parsed["copyright"],
        source=parsed["source"],
        audio_mode=parsed["audio_mode"],
        glottocode=parsed["glottocode"],
    )
    stats.texts += 1

    # Text-level (untranscribed) audio
    text_audios = [
        TextAudio(
            text=text, file=a["file"], url=a["url"],
            start=a["start"], end=a["end"], source=a["source"],
        )
        for a in parsed["text_audios"]
    ]
    if text_audios:
        TextAudio.objects.bulk_create(text_audios, batch_size=bs)

    # --- Sentences ---
    sent_dicts = parsed["sentences"]
    sentence_objs = []
    for i, sd in enumerate(sent_dicts):
        std = sd["forms"].get("standard", "")
        orig = sd["forms"].get("original", "")
        sentence_objs.append(
            Sentence(
                text=text,
                sentence_xml_id=sd["xml_id"],
                position=i,
                form_original=orig,
                form_standard=std,
                form_alternate=sd["forms"].get("alternate", ""),
                phon_original=sd["phons"].get("original", ""),
                phon_standard=sd["phons"].get("standard", ""),
                token_count=len(tokenize(std or orig)),
            )
        )
    Sentence.objects.bulk_create(sentence_objs, batch_size=bs)
    stats.sentences += len(sentence_objs)
    stats.token_count += sum(s.token_count for s in sentence_objs)

    # --- Words (parallel list of parsed dicts) ---
    word_objs, word_dicts = [], []
    for sd, s_obj in zip(sent_dicts, sentence_objs):
        for j, wd in enumerate(sd["words"]):
            word_objs.append(
                Word(
                    sentence=s_obj,
                    word_xml_id=wd["xml_id"],
                    position=j,
                    word_class=wd["cls"],
                    sclass=wd["sclass"],
                    form_original=wd["forms"].get("original", ""),
                    form_standard=wd["forms"].get("standard", ""),
                    form_alternate=wd["forms"].get("alternate", ""),
                    phon_original=wd["phons"].get("original", ""),
                    phon_standard=wd["phons"].get("standard", ""),
                )
            )
            word_dicts.append(wd)
    if word_objs:
        Word.objects.bulk_create(word_objs, batch_size=bs)
        stats.words += len(word_objs)

    # --- Morphemes ---
    morph_objs, morph_dicts = [], []
    for wd, w_obj in zip(word_dicts, word_objs):
        for k, md in enumerate(wd["morphemes"]):
            morph_objs.append(
                Morpheme(
                    word=w_obj,
                    morpheme_xml_id=md["xml_id"],
                    position=k,
                    morpheme_class=md["cls"],
                    sclass=md["sclass"],
                    form_original=md["forms"].get("original", ""),
                    form_standard=md["forms"].get("standard", ""),
                    form_alternate=md["forms"].get("alternate", ""),
                    phon_original=md["phons"].get("original", ""),
                    phon_standard=md["phons"].get("standard", ""),
                )
            )
            morph_dicts.append(md)
    if morph_objs:
        Morpheme.objects.bulk_create(morph_objs, batch_size=bs)
        stats.morphemes += len(morph_objs)

    # --- Translations (exactly-one-owner) ---
    transl_objs = []
    for sd, s_obj in zip(sent_dicts, sentence_objs):
        transl_objs += _translations_for(s_obj, "sentence", sd["translations"])
    for wd, w_obj in zip(word_dicts, word_objs):
        transl_objs += _translations_for(w_obj, "word", wd["translations"])
    for md, m_obj in zip(morph_dicts, morph_objs):
        transl_objs += _translations_for(m_obj, "morpheme", md["translations"])
    if transl_objs:
        Translation.objects.bulk_create(transl_objs, batch_size=bs)
        stats.translations += len(transl_objs)

    # --- Transcribed audio segments (exactly-one-owner) ---
    audio_objs = []
    for sd, s_obj in zip(sent_dicts, sentence_objs):
        audio_objs += _audio_for(s_obj, "sentence", sd["audios"])
    for wd, w_obj in zip(word_dicts, word_objs):
        audio_objs += _audio_for(w_obj, "word", wd["audios"])
    for md, m_obj in zip(morph_dicts, morph_objs):
        audio_objs += _audio_for(m_obj, "morpheme", md["audios"])
    if audio_objs:
        AudioSegment.objects.bulk_create(audio_objs, batch_size=bs)
        stats.audio_segments += len(audio_objs)

    # --- Tokens (derived) ---
    token_objs = _derive_tokens(
        corpus, language, dialect, sent_dicts, sentence_objs, word_dicts, word_objs
    )
    if token_objs:
        Token.objects.bulk_create(token_objs, batch_size=bs)
        stats.tokens += len(token_objs)


def _translations_for(owner, kind: str, transls: list[dict]) -> list[Translation]:
    out = []
    for t in transls:
        out.append(
            Translation(
                **{kind: owner},
                xml_lang=t["xml_lang"],
                kind_of=t["kind_of"],
                ver=t["ver"],
                notes=t["notes"],
                text=t["text"],
                text_norm=normalize_gloss(t["text"]),
            )
        )
    return out


def _audio_for(owner, kind: str, audios: list[dict]) -> list[AudioSegment]:
    out = []
    for a in audios:
        out.append(
            AudioSegment(
                **{kind: owner},
                file=a["file"], url=a["url"],
                start=a["start"], end=a["end"], source=a["source"],
            )
        )
    return out


def _derive_tokens(
    corpus, language, dialect, sent_dicts, sentence_objs, word_dicts, word_objs
) -> list[Token]:
    tokens: list[Token] = []
    common = {"corpus": corpus, "language": language, "dialect": dialect}

    # word-segmented: one token per word
    for wd, w_obj in zip(word_dicts, word_objs):
        std = wd["forms"].get("standard", "")
        orig = wd["forms"].get("original", "")
        norm = normalize_surface(std or orig)
        if not norm:
            continue
        tokens.append(
            Token(
                sentence_id=w_obj.sentence_id,
                word=w_obj,
                position=w_obj.position,
                surface_standard=std,
                surface_original=orig,
                surface_norm=norm,
                **common,
            )
        )

    # unsegmented sentences: tokenize the FORM
    for sd, s_obj in zip(sent_dicts, sentence_objs):
        if sd["words"]:
            continue
        std = sd["forms"].get("standard", "")
        orig = sd["forms"].get("original", "")
        std_toks = tokenize(std)
        orig_toks = tokenize(orig)
        if std:
            aligned = bool(orig_toks) and len(std_toks) == len(orig_toks)
            for i, tok in enumerate(std_toks):
                norm = normalize_surface(tok)
                if not norm:
                    continue
                tokens.append(
                    Token(
                        sentence=s_obj, position=i,
                        surface_standard=tok,
                        surface_original=orig_toks[i] if aligned else "",
                        surface_norm=norm, **common,
                    )
                )
        elif orig:
            for i, tok in enumerate(orig_toks):
                norm = normalize_surface(tok)
                if not norm:
                    continue
                tokens.append(
                    Token(
                        sentence=s_obj, position=i,
                        surface_standard="", surface_original=tok,
                        surface_norm=norm, **common,
                    )
                )
    return tokens
