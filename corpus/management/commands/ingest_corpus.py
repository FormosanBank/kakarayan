"""Ingest FormosanBank corpus XML into PostgreSQL.

Examples:
    manage.py ingest_corpus --all
    manage.py ingest_corpus --corpus HundredPaiwanStories
    manage.py ingest_corpus --all --defer-indexes   # faster full rebuild

The corpus tables are a derived read-model: each corpus is delete-and-reloaded inside
its own transaction, so re-running is always safe.
"""

from pathlib import Path

from django.core.management.base import BaseCommand, CommandError
from django.db import connection, transaction
from django.utils import timezone

from corpus.ingestion import loader, parse, seed
from corpus.models import Corpus, IngestionRun, Language

# GIN trigram indexes that are expensive to maintain during bulk load.
_TRGM_INDEXES = {
    "token_surface_norm_trgm": ("corpus_token", "surface_norm"),
    "translation_text_norm_trgm": ("corpus_translation", "text_norm"),
}


class Command(BaseCommand):
    help = "Ingest FormosanBank corpus XML into the database."

    def add_arguments(self, parser):
        parser.add_argument("--all", action="store_true", help="Ingest every corpus.")
        parser.add_argument(
            "--corpus",
            action="append",
            metavar="NAME",
            help="Restrict to this corpus directory (repeatable).",
        )
        parser.add_argument(
            "--language",
            action="append",
            metavar="NAME",
            help="Restrict to this display language, e.g. Amis (repeatable). "
            "Combine with --corpus, or use alone to load that language across "
            "all corpora.",
        )
        parser.add_argument(
            "--defer-indexes",
            action="store_true",
            help="Drop GIN trigram indexes before loading and recreate after.",
        )
        parser.add_argument(
            "--skip-seed",
            action="store_true",
            help="Skip the idempotent reference seed step.",
        )

    def handle(self, *args, **options):
        if not (options["all"] or options["corpus"] or options["language"]):
            raise CommandError("Specify at least one of --all, --corpus, or --language.")

        if not options["skip_seed"]:
            seed.seed_all()

        language_names = self._resolve_languages(options)
        targets = self._resolve_targets(options)
        run = IngestionRun.objects.create(
            git_commit=parse.git_commit(),
            corpora_path=str(parse.corpora_path()),
            status="running",
        )

        if options["defer_indexes"]:
            self._drop_trgm_indexes()

        total = loader.LoadStats()
        ingested = []
        try:
            for corpus_obj, corpus_root in targets:
                label = corpus_obj.name + (
                    f" [{', '.join(sorted(language_names))}]" if language_names else ""
                )
                self.stdout.write(f"Ingesting {label} …")
                with transaction.atomic():
                    stats = loader.load_corpus(
                        corpus_obj,
                        corpus_root,
                        run=run,
                        language_names=language_names,
                    )
                total.add(stats)
                if stats.texts:
                    ingested.append(corpus_obj.name)
                self.stdout.write(
                    "  "
                    f"{stats.texts} texts, {stats.sentences} sentences, "
                    f"{stats.words} words, {stats.morphemes} morphemes, "
                    f"{stats.tokens} tokens"
                    + (f", {len(stats.parse_errors)} parse errors" if stats.parse_errors else "")
                )
        finally:
            if options["defer_indexes"]:
                self.stdout.write("Rebuilding GIN trigram indexes …")
                self._create_trgm_indexes()

        run.finished_at = timezone.now()
        run.status = "succeeded"
        run.corpora_ingested = ingested
        run.counts = total.as_dict()
        run.save()

        self.stdout.write(
            self.style.SUCCESS(
                f"Done. {total.texts} texts, {total.sentences} sentences, "
                f"{total.tokens} tokens (canonical token_count={total.token_count}) "
                f"across {len(ingested)} corpora."
            )
        )

    # ------------------------------------------------------------------ #
    def _resolve_languages(self, options) -> set[str] | None:
        names = options.get("language")
        if not names:
            return None
        known = set(Language.objects.values_list("name", flat=True))
        unknown = [n for n in names if n not in known]
        if unknown:
            raise CommandError(
                f"Unknown language(s): {', '.join(unknown)}. Known: {', '.join(sorted(known))}."
            )
        return set(names)

    def _resolve_targets(self, options) -> list[tuple[Corpus, Path]]:
        root = parse.corpora_path()
        if options["corpus"]:
            dirs = []
            for name in options["corpus"]:
                d = root / name
                if not d.is_dir():
                    raise CommandError(f"Corpus directory not found: {d}")
                dirs.append(d)
        else:
            # --all, or --language alone → every corpus
            dirs = parse.list_corpora()

        targets = []
        for d in dirs:
            corpus_obj, _ = Corpus.objects.get_or_create(
                name=d.name, defaults={"slug": d.name.lower()}
            )
            targets.append((corpus_obj, d))
        return targets

    def _drop_trgm_indexes(self):
        with connection.cursor() as cur:
            for name in _TRGM_INDEXES:
                cur.execute(f"DROP INDEX IF EXISTS {name};")

    def _create_trgm_indexes(self):
        with connection.cursor() as cur:
            for name, (table, column) in _TRGM_INDEXES.items():
                cur.execute(
                    f"CREATE INDEX IF NOT EXISTS {name} "
                    f"ON {table} USING gin ({column} gin_trgm_ops);"
                )
