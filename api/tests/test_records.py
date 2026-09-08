import json
import sqlite3
from contextlib import closing

import pytest

from api.config import Settings
from api.dictionary_evidence import load_evidence
from api.records import DETAIL_MAX_BYTES, DETAIL_MAX_ROWS, sentence_detail
from publisher.tables import TABLE_COLUMNS


def test_record_expansion_has_constant_query_count_and_explicit_bounds(settings):
    with closing(sqlite3.connect(settings.database_path)) as connection, connection:
        connection.row_factory = sqlite3.Row
        identifier = connection.execute("SELECT parent_id FROM words LIMIT 1").fetchone()[0]
        statements = []
        connection.set_trace_callback(statements.append)
        small = sentence_detail(connection, identifier)
        small_count = len(statements)
        assert not small["detail_truncated"]
        columns = TABLE_COLUMNS["words"]
        rest = ",".join(f'"{column}"' for column in columns[1:])
        connection.executemany(
            f"INSERT INTO words SELECT ?,{rest} FROM words WHERE parent_id=? LIMIT 1",
            [(f"word_test_{index}", identifier) for index in range(3000)],
        )
        statements.clear()
        record = sentence_detail(connection, identifier)
        assert len(statements) <= small_count + 1
        assert record["detail_truncated"]
        assert len(record["words"]) < DETAIL_MAX_ROWS
        assert record["source_path"] and record["xml_id"]
        assert len(json.dumps(record).encode()) < DETAIL_MAX_BYTES
        connection.execute(
            "UPDATE forms SET text=? WHERE owner_type='sentence' AND owner_id=?",
            ("測試" * 500_000, identifier),
        )
        record = sentence_detail(connection, identifier)
        assert record["detail_truncated"]
        assert len(json.dumps(record).encode()) < DETAIL_MAX_BYTES


def test_dictionary_evidence_is_batched_over_headwords(settings):
    with closing(sqlite3.connect(settings.database_path)) as connection:
        connection.row_factory = sqlite3.Row
        statements = []
        connection.set_trace_callback(statements.append)
        for heads in [["lima"], ["lima", "waco", "rima"]]:
            statements.clear()
            evidence, examples = load_evidence(
                connection, heads, ["t.language_id=?"], ["lang_amis"], None, {}
            )
            assert len(statements) <= 6
            assert set(evidence) == set(heads)
            assert len(examples) <= 2 * len(heads)
            assert evidence["lima"]["meanings"]


@pytest.mark.parametrize("value", ["nan", "inf", "-inf", "0", "-1"])
def test_nonfinite_configuration_is_rejected(monkeypatch, value):
    monkeypatch.setenv("KAKARAYAN_QUERY_TIMEOUT_SECONDS", value)
    with pytest.raises(ValueError, match="positive number"):
        Settings.from_environment()
