"""Data model for the FormosanBank corpus.

The corpus tables are a *derived read-model* of the XML under FormosanBank/Corpora:
they are rebuilt by the ``ingest_corpus`` management command and never hand-edited.
Any future user-generated data (favorites, edits, ...) belongs in separate models so
these stay cleanly regenerable.

Design notes:
- FORM/PHON are effectively one-per-``kindOf`` in the corpus, so they are stored as
  columns (``form_original``/``form_standard``/``form_alternate`` etc.).
- TRANSL is one-to-many (multiple languages), so ``Translation`` is a child table; it
  also holds morpheme-level glosses.
- ``Translation`` and ``AudioSegment`` attach to exactly one tier (sentence/word/
  morpheme) via three nullable FKs guarded by a CHECK constraint.
- ``Token`` is a fully derived per-occurrence concordance index; it denormalizes
  corpus/language/dialect so the hot dictionary query filters without joins.
"""

from django.contrib.postgres.indexes import GinIndex
from django.db import models
from django.db.models import Q


# --------------------------------------------------------------------------- #
# Dimension tables
# --------------------------------------------------------------------------- #
class Language(models.Model):
    """A Formosan language (the 16 + Truku as a display language).

    ``iso639_3`` is NOT unique: ``trv`` maps to both Seediq and Truku (disambiguated
    by dialect during ingestion), so uniqueness is on the display ``name``.
    """

    name = models.CharField(max_length=64, unique=True)
    iso639_3 = models.CharField(max_length=8, db_index=True)

    class Meta:
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


class Dialect(models.Model):
    """A dialect variety, seeded from FormosanBank's dialects.csv."""

    language = models.ForeignKey(
        Language, on_delete=models.CASCADE, related_name="dialects"
    )
    name = models.CharField(max_length=128)
    official_name = models.CharField(max_length=128, blank=True)
    chinese_name = models.CharField(max_length=128, blank=True)
    glottocode = models.CharField(max_length=32, blank=True)
    other_names = models.CharField(max_length=256, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["language", "name"], name="uniq_dialect_per_language"
            )
        ]
        ordering = ["language__name", "name"]

    def __str__(self) -> str:
        return f"{self.language.name} / {self.name}"


class Corpus(models.Model):
    """A published corpus (one directory under FormosanBank/Corpora)."""

    name = models.CharField(max_length=128, unique=True)
    slug = models.SlugField(max_length=160, unique=True)
    description = models.TextField(blank=True)
    default_copyright = models.TextField(blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        verbose_name_plural = "corpora"
        ordering = ["name"]

    def __str__(self) -> str:
        return self.name


# --------------------------------------------------------------------------- #
# Provenance
# --------------------------------------------------------------------------- #
class IngestionRun(models.Model):
    """One run of the ingestion pipeline (for traceability / rebuildability)."""

    STATUS_CHOICES = [
        ("running", "running"),
        ("succeeded", "succeeded"),
        ("failed", "failed"),
    ]

    started_at = models.DateTimeField(auto_now_add=True)
    finished_at = models.DateTimeField(null=True, blank=True)
    status = models.CharField(max_length=16, choices=STATUS_CHOICES, default="running")
    git_commit = models.CharField(max_length=64, blank=True)
    corpora_path = models.CharField(max_length=512, blank=True)
    corpora_ingested = models.JSONField(default=list, blank=True)
    counts = models.JSONField(default=dict, blank=True)
    notes = models.TextField(blank=True)

    class Meta:
        ordering = ["-started_at"]

    def __str__(self) -> str:
        return f"IngestionRun #{self.pk} ({self.status})"


# --------------------------------------------------------------------------- #
# Corpus content: TEXT -> S -> W -> M
# --------------------------------------------------------------------------- #
class Text(models.Model):
    """One ``<TEXT>`` element (one XML file)."""

    corpus = models.ForeignKey(
        Corpus, on_delete=models.CASCADE, related_name="texts"
    )
    ingestion_run = models.ForeignKey(
        IngestionRun,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="texts",
    )
    language = models.ForeignKey(
        Language, on_delete=models.PROTECT, related_name="texts"
    )
    dialect = models.ForeignKey(
        Dialect,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="texts",
    )

    text_xml_id = models.CharField(max_length=256)
    source_path = models.CharField(max_length=512)
    xml_lang = models.CharField(max_length=16)

    citation = models.TextField(blank=True)
    bibtex_citation = models.TextField(blank=True)
    copyright = models.TextField(blank=True)
    source = models.TextField(blank=True)
    audio_mode = models.CharField(max_length=32, blank=True)  # diarized|segmented|""
    glottocode = models.CharField(max_length=32, blank=True)
    metadata = models.JSONField(default=dict, blank=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["corpus", "text_xml_id"], name="uniq_text_per_corpus"
            )
        ]
        indexes = [
            models.Index(fields=["corpus", "language"]),
        ]

    def __str__(self) -> str:
        return self.text_xml_id


class TextAudio(models.Model):
    """An untranscribed ``<AUDIO>`` that is a direct child of ``<TEXT>``."""

    text = models.ForeignKey(
        Text, on_delete=models.CASCADE, related_name="audios"
    )
    file = models.CharField(max_length=512, blank=True)
    url = models.URLField(max_length=1024, blank=True)
    start = models.FloatField(null=True, blank=True)
    end = models.FloatField(null=True, blank=True)
    source = models.CharField(max_length=256, blank=True)


class Sentence(models.Model):
    """A ``<S>`` element."""

    text = models.ForeignKey(
        Text, on_delete=models.CASCADE, related_name="sentences"
    )
    sentence_xml_id = models.CharField(max_length=256)
    position = models.IntegerField()

    form_original = models.TextField(blank=True)
    form_standard = models.TextField(blank=True)
    form_alternate = models.TextField(blank=True)
    phon_original = models.TextField(blank=True)
    phon_standard = models.TextField(blank=True)
    token_count = models.IntegerField(default=0)

    class Meta:
        indexes = [
            models.Index(fields=["text", "position"]),
        ]
        ordering = ["text", "position"]

    def __str__(self) -> str:
        return f"{self.text.text_xml_id}:{self.sentence_xml_id}"


class Word(models.Model):
    """A ``<W>`` element (only in word-segmented corpora)."""

    sentence = models.ForeignKey(
        Sentence, on_delete=models.CASCADE, related_name="words"
    )
    word_xml_id = models.CharField(max_length=256)
    position = models.IntegerField()
    word_class = models.CharField(max_length=64, blank=True)   # XML @class
    sclass = models.CharField(max_length=64, blank=True)       # XML @sclass

    form_original = models.TextField(blank=True)
    form_standard = models.TextField(blank=True)
    form_alternate = models.TextField(blank=True)
    phon_original = models.TextField(blank=True)
    phon_standard = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["sentence", "position"]),
        ]
        ordering = ["sentence", "position"]


class Morpheme(models.Model):
    """An ``<M>`` element (only in glossed corpora)."""

    word = models.ForeignKey(
        Word, on_delete=models.CASCADE, related_name="morphemes"
    )
    morpheme_xml_id = models.CharField(max_length=256)
    position = models.IntegerField()
    morpheme_class = models.CharField(max_length=64, blank=True)  # XML @class
    sclass = models.CharField(max_length=64, blank=True)          # XML @sclass

    form_original = models.TextField(blank=True)
    form_standard = models.TextField(blank=True)
    form_alternate = models.TextField(blank=True)
    phon_original = models.TextField(blank=True)
    phon_standard = models.TextField(blank=True)

    class Meta:
        indexes = [
            models.Index(fields=["word", "position"]),
        ]
        ordering = ["word", "position"]


# --------------------------------------------------------------------------- #
# Annotations shared across tiers (exactly-one-owner pattern)
# --------------------------------------------------------------------------- #
class Translation(models.Model):
    """A ``<TRANSL>`` on a sentence/word/morpheme (morpheme = interlinear gloss).

    Exactly one of ``sentence``/``word``/``morpheme`` is set.
    """

    sentence = models.ForeignKey(
        Sentence, on_delete=models.CASCADE, null=True, blank=True,
        related_name="translations",
    )
    word = models.ForeignKey(
        Word, on_delete=models.CASCADE, null=True, blank=True,
        related_name="translations",
    )
    morpheme = models.ForeignKey(
        Morpheme, on_delete=models.CASCADE, null=True, blank=True,
        related_name="translations",
    )

    xml_lang = models.CharField(max_length=16, blank=True)
    kind_of = models.CharField(max_length=32, blank=True)
    ver = models.CharField(max_length=32, blank=True)
    notes = models.TextField(blank=True)
    text = models.TextField(blank=True)
    text_norm = models.TextField(blank=True)  # folded, for gloss search

    class Meta:
        constraints = [
            models.CheckConstraint(
                name="translation_exactly_one_owner",
                condition=(
                    Q(sentence__isnull=False, word__isnull=True, morpheme__isnull=True)
                    | Q(sentence__isnull=True, word__isnull=False, morpheme__isnull=True)
                    | Q(sentence__isnull=True, word__isnull=True, morpheme__isnull=False)
                ),
            )
        ]
        indexes = [
            models.Index(fields=["xml_lang"]),
            GinIndex(
                name="translation_text_norm_trgm",
                fields=["text_norm"],
                opclasses=["gin_trgm_ops"],
            ),
        ]


class AudioSegment(models.Model):
    """A transcribed ``<AUDIO>`` nested in a sentence/word/morpheme.

    Exactly one of ``sentence``/``word``/``morpheme`` is set.
    """

    sentence = models.ForeignKey(
        Sentence, on_delete=models.CASCADE, null=True, blank=True,
        related_name="audio_segments",
    )
    word = models.ForeignKey(
        Word, on_delete=models.CASCADE, null=True, blank=True,
        related_name="audio_segments",
    )
    morpheme = models.ForeignKey(
        Morpheme, on_delete=models.CASCADE, null=True, blank=True,
        related_name="audio_segments",
    )

    file = models.CharField(max_length=512, blank=True)
    url = models.URLField(max_length=1024, blank=True)
    start = models.FloatField(null=True, blank=True)
    end = models.FloatField(null=True, blank=True)
    source = models.CharField(max_length=256, blank=True)

    class Meta:
        constraints = [
            models.CheckConstraint(
                name="audiosegment_exactly_one_owner",
                condition=(
                    Q(sentence__isnull=False, word__isnull=True, morpheme__isnull=True)
                    | Q(sentence__isnull=True, word__isnull=False, morpheme__isnull=True)
                    | Q(sentence__isnull=True, word__isnull=True, morpheme__isnull=False)
                ),
            )
        ]


# --------------------------------------------------------------------------- #
# Derived search index
# --------------------------------------------------------------------------- #
class Token(models.Model):
    """One token occurrence in a sentence — the concordance/dictionary index.

    Derived: for word-segmented sentences, one row per ``<W>`` (linked via ``word``);
    otherwise the sentence FORM is whitespace-tokenized (``word`` null).
    Corpus/language/dialect are denormalized so the common "filter by language + match
    surface" query needs no joins to filter.
    """

    sentence = models.ForeignKey(
        Sentence, on_delete=models.CASCADE, related_name="tokens"
    )
    word = models.ForeignKey(
        Word, on_delete=models.CASCADE, null=True, blank=True,
        related_name="tokens",
    )
    position = models.IntegerField()

    surface_original = models.TextField(blank=True)
    surface_standard = models.TextField(blank=True)
    surface_norm = models.TextField()

    # Denormalized filters
    corpus = models.ForeignKey(
        Corpus, on_delete=models.CASCADE, related_name="tokens"
    )
    language = models.ForeignKey(
        Language, on_delete=models.CASCADE, related_name="tokens"
    )
    dialect = models.ForeignKey(
        Dialect, on_delete=models.CASCADE, null=True, blank=True,
        related_name="tokens",
    )

    class Meta:
        indexes = [
            # exact + prefix (LIKE 'x%'), including a language-filtered composite
            models.Index(fields=["surface_norm"]),
            models.Index(fields=["language", "surface_norm"]),
            # substring + fuzzy
            GinIndex(
                name="token_surface_norm_trgm",
                fields=["surface_norm"],
                opclasses=["gin_trgm_ops"],
            ),
            models.Index(fields=["sentence", "position"]),
        ]
        ordering = ["sentence", "position"]
