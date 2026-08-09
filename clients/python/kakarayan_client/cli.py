"""Command-line interface for the Kakarayan client."""

from __future__ import annotations

import argparse
import json
from collections.abc import Sequence

from kakarayan_client.client import KakarayanClient, KakarayanError


def _parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(prog="kakarayan")
    parser.add_argument("--base-url", required=True)
    parser.add_argument("--mode", choices=("static", "live"), default="static")
    parser.add_argument("--release-id")
    parser.add_argument("--timeout", type=float, default=15.0)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("meta")
    commands.add_parser("languages")
    commands.add_parser("corpora")
    for name in ("dictionary", "concordance"):
        command = commands.add_parser(name)
        command.add_argument("query")
        command.add_argument("--language", required=True)
        command.add_argument("--corpus")
        command.add_argument("--dialect")
        command.add_argument("--match", choices=("exact", "prefix", "contains"), default="exact")
        command.add_argument("--limit", type=int, default=25)
    frequency = commands.add_parser("frequencies")
    frequency.add_argument("--language", required=True)
    frequency.add_argument("--corpus")
    frequency.add_argument("--dialect")
    frequency.add_argument("--prefix")
    frequency.add_argument("--minimum", type=int, default=1)
    frequency.add_argument("--limit", type=int, default=25)
    return parser


def main(argv: Sequence[str] | None = None) -> int:
    arguments = _parser().parse_args(argv)
    client = KakarayanClient(
        arguments.base_url,
        mode=arguments.mode,
        release_id=arguments.release_id,
        timeout=arguments.timeout,
    )
    try:
        value: object
        if arguments.command == "meta":
            value = client.meta()
        elif arguments.command == "languages":
            value = client.languages()
        elif arguments.command == "corpora":
            value = client.corpora()
        elif arguments.command == "frequencies":
            value = client.frequencies(
                arguments.language,
                corpus_id=arguments.corpus,
                dialect=arguments.dialect,
                prefix=arguments.prefix,
                minimum=arguments.minimum,
                limit=arguments.limit,
            )
        else:
            method = getattr(client, arguments.command)
            value = method(
                arguments.query,
                arguments.language,
                corpus_id=arguments.corpus,
                dialect=arguments.dialect,
                match=arguments.match,
                limit=arguments.limit,
            )
    except KakarayanError as error:
        print(
            json.dumps(
                {
                    "error": {
                        "code": error.code,
                        "message": str(error),
                        "status": error.status,
                        "field": error.field,
                    }
                },
                ensure_ascii=False,
            )
        )
        return 1
    print(json.dumps(value, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
