"""Public FormosanBank display-language registry and resolution rules."""

from __future__ import annotations

from publisher.identifiers import dimension_id

# Mirrors FormosanBank/QC/corpus_counts.py. trv is resolved separately below.
ISO_TO_LANGUAGE = {
    "ami": "Amis",
    "bzg": "Babuza-Favorlang",
    "tay": "Atayal",
    "pwn": "Paiwan",
    "bnn": "Bunun",
    "pyu": "Puyuma",
    "dru": "Rukai",
    "tsu": "Tsou",
    "xsy": "Saisiyat",
    "tao": "Yami",
    "ssf": "Thao",
    "ckv": "Kavalan",
    "trv": "Seediq",
    "szy": "Sakizaya",
    "sxr": "Saaroa",
    "xnb": "Kanakanavu",
    "fos": "Siraya",
}

ZH_HANT_NAMES = {
    "Amis": "阿美語",
    "Babuza-Favorlang": "",
    "Atayal": "泰雅語",
    "Bunun": "布農語",
    "Kanakanavu": "卡那卡那富語",
    "Kavalan": "噶瑪蘭語",
    "Paiwan": "排灣語",
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


def resolve_language(xml_lang: str | None, dialect: str | None) -> str | None:
    """Resolve the canonical display identity from XML language and dialect."""
    code = (xml_lang or "").strip().casefold()
    if code == "trv" and (dialect or "").strip().casefold() == "truku":
        return "Truku"
    return ISO_TO_LANGUAGE.get(code)


def language_rows() -> list[dict[str, object]]:
    """Return all display identities, including Truku as distinct from Seediq."""
    names = sorted(set(ISO_TO_LANGUAGE.values()) | {"Truku"})
    rows: list[dict[str, object]] = []
    for name in names:
        iso = (
            "trv"
            if name == "Truku"
            else next(code for code, language in ISO_TO_LANGUAGE.items() if language == name)
        )
        rows.append(
            {
                "id": dimension_id("lang", name),
                "name": name,
                "iso639_3": iso,
                "names": {"en": name, "zh-Hant": ZH_HANT_NAMES[name], "autonym": ""},
                "capabilities": ["corpus", "dictionary", "examples"],
                "counts": {},
            }
        )
    return rows
