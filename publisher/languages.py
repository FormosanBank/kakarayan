"""FormosanBank display-language registry and resolution rules."""

from __future__ import annotations

import csv
from functools import cache
from pathlib import Path

from publisher.identifiers import dimension_id

# Kakarayan's presentation names. Language identity comes from the source's languages.csv.
ZH_HANT_NAMES = {
    "Amis": "阿美語",
    "Atayal": "泰雅語",
    "Bunun": "布農語",
    "Kanakanavu": "卡那卡那富語",
    "Kavalan": "噶瑪蘭語",
    "Paiwan": "排灣語",
    "Pazeh": "巴宰語",
    "Puyuma": "卑南語",
    "Rukai": "魯凱語",
    "Saaroa": "拉阿魯哇語",
    "Saisiyat": "賽夏語",
    "Sakizaya": "撒奇萊雅語",
    "Seediq": "賽德克語",
    "Siraya": "西拉雅語",
    "Thao": "邵語",
    "Truku": "太魯閣語",
    "Tsou": "鄒語",
    "Yami": "達悟語",
}


@cache
def language_codes(repo: Path) -> dict[str, str]:
    """ISO 639-3 code to display name, from the source's languages.csv (POL-039)."""
    with (repo / "languages.csv").open(newline="", encoding="utf-8") as stream:
        return {
            row["ISO639-3"].strip().casefold(): row["Language"].strip()
            for row in csv.DictReader(stream)
            if row["ISO639-3"].strip()
        }


def resolve_language(repo: Path, xml_lang: str | None, dialect: str | None) -> str | None:
    """Resolve the canonical display identity from XML language and dialect."""
    code = (xml_lang or "").strip().casefold()
    if code == "trv" and (dialect or "").strip().casefold() == "truku":
        return "Truku"
    return language_codes(repo).get(code)


def language_rows(repo: Path) -> list[dict[str, object]]:
    """Return all display identities, including Truku as distinct from Seediq."""
    codes = language_codes(repo)
    rows: list[dict[str, object]] = []
    for name in sorted(set(codes.values()) | {"Truku"}):
        iso = "trv" if name == "Truku" else next(c for c, value in codes.items() if value == name)
        rows.append(
            {
                "id": dimension_id("lang", name),
                "name": name,
                "iso639_3": iso,
                "names": {"en": name, "zh-Hant": ZH_HANT_NAMES.get(name, ""), "autonym": ""},
                "capabilities": ["corpus", "dictionary", "examples"],
                "counts": {},
            }
        )
    return rows
