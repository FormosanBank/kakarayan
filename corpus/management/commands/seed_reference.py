"""Seed the dimension tables (languages, dialects, corpora).

Idempotent; run once before the first ingest and whenever dialects.csv or the set of
corpora changes.
"""

from django.core.management.base import BaseCommand

from corpus.ingestion import seed


class Command(BaseCommand):
    help = "Seed languages, dialects, and corpora from the FormosanBank checkout."

    def handle(self, *args, **options):
        counts = seed.seed_all()
        self.stdout.write(
            self.style.SUCCESS(
                "Seeded: "
                f"{counts['languages']} languages, "
                f"{counts['dialects']} dialects, "
                f"{counts['corpora']} corpora."
            )
        )
