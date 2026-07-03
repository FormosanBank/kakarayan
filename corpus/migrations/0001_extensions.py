"""Enable the PostgreSQL extensions the corpus schema relies on.

Runs before the model tables so the GIN trigram indexes (gin_trgm_ops) can be built.
"""

from django.contrib.postgres.operations import BtreeGinExtension, TrigramExtension
from django.db import migrations


class Migration(migrations.Migration):

    initial = True

    dependencies = []

    operations = [
        TrigramExtension(),
        BtreeGinExtension(),
    ]
