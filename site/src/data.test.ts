import {RE2JS} from "re2js";

import golden from "../../tests/fixtures/search-golden.json";
import {indexCandidateParts, normalizeSearch, recordMatches} from "./data";
import type {SearchMode} from "./data";
import type {SearchIndexDocument, SearchRecord} from "./types";

const record: SearchRecord = {
  id: "sentence_1",
  text_id: "text_1",
  corpus_id: "corpus_fixture",
  language_id: "lang_amis",
  dialect: "Xiuguluan",
  source_path: "Corpora/Fixture/XML/a.xml",
  xml_id: "S1",
  standard: "Fangcalay",
  original: "fangcalay",
  translations: [{text: "beautiful", xml_lang: "eng", kind: "", version: ""}],
  tokens: [{surface: "Fangcalay", normalized: "fangcalay", position: 0, word_id: "w1"}],
  forms: [
    {
      owner_type: "word",
      owner_id: "w1",
      position: 0,
      text: "Fangcalay",
      unclear: 0,
      kind: "standard",
      notes: "",
      normalized: "fangcalay",
    },
  ],
  phonology: [
    {
      owner_type: "sentence",
      owner_id: "sentence_1",
      position: 0,
      text: "faŋcalaj",
      unclear: 0,
      kind: "standard",
    },
  ],
  tier_translations: [
    {
      owner_type: "morpheme",
      owner_id: "m1",
      position: 0,
      text: "BEAUTIFUL",
      normalized: "beautiful",
      xml_lang: "eng",
      kind: "gloss",
      version: "",
      unclear: 0,
      notes: "",
    },
  ],
  words: [],
  audio: [],
};

describe("transparent static search", () => {
  it("normalizes NFC and case without stripping contrastive letters", () => {
    expect(normalizeSearch("  FANGCALAY ")).toBe("fangcalay");
    expect(normalizeSearch("ʉ")).toBe("ʉ");
    expect(normalizeSearch("“lima!”")).toBe("lima");
    expect(normalizeSearch("lj'u")).toBe("lj'u");
  });

  it("supports source, normalized, tier, fuzzy, and meaning modes", () => {
    expect(recordMatches(record, "Fangcalay", "source")).toBe(true);
    expect(recordMatches(record, "fangcalay", "source")).toBe(true);
    expect(recordMatches(record, "fangcalay", "exact")).toBe(true);
    expect(recordMatches(record, "fang", "prefix")).toBe(true);
    expect(recordMatches(record, "ngca", "contains")).toBe(true);
    expect(recordMatches(record, "beaut", "translation")).toBe(true);
    expect(recordMatches(record, "ŋca", "phonology")).toBe(true);
    expect(recordMatches(record, "beautiful", "gloss")).toBe(true);
    expect(recordMatches(record, "fangcalai", "fuzzy")).toBe(true);
    expect(recordMatches(record, "ugly", "translation")).toBe(false);
  });

  it("matches words and phrases from a selected translation back to Formosan records", () => {
    expect(recordMatches(record, "beautiful", "exact", "eng", "sentence", "translation")).toBe(true);
    expect(recordMatches(record, "beautiful!", "exact", "eng", "sentence", "translation")).toBe(true);
    expect(recordMatches(record, "beau", "prefix", "eng", "sentence", "translation")).toBe(true);
    expect(recordMatches(record, "eauti", "contains", "eng", "sentence", "translation")).toBe(true);
    expect(recordMatches(record, "beautful", "fuzzy", "eng", "sentence", "translation")).toBe(true);
    expect(recordMatches(record, "beautiful", "exact", "zho", "sentence", "translation")).toBe(false);
  });

  it("keeps sentence targets separate while allowing lexical dictionary targets", () => {
    const lexicalOnly: SearchRecord = {
      ...record,
      translations: [],
      tier_translations: record.tier_translations.map((translation) => ({
        ...translation,
        xml_lang: "fra",
      })),
    };
    expect(recordMatches(lexicalOnly, "fangcalay", "exact", "fra")).toBe(false);
    expect(recordMatches(lexicalOnly, "fangcalay", "exact", "fra", "any")).toBe(true);
    expect(recordMatches(lexicalOnly, "fangcalay", "exact", "eng", "any")).toBe(false);
    expect(recordMatches(lexicalOnly, "beautiful", "exact", "fra", "any", "translation")).toBe(true);
  });

  it("uses vocabulary postings to select only candidate record shards", () => {
    const index: SearchIndexDocument = {
      schema_version: "1.0.0",
      release_id: "fb-20240102-deadbeef",
      language_id: "lang_amis",
      corpus_id: "corpus_fixture",
      shards: 3,
      terms: {
        source_exact: {Fangcalay: [0], lima: [1]},
        source: {fangcalay: [0], lima: [1], wacu: [2]},
        translation: {beautiful: [0], five: [1], dog: [2]},
        phonology: {"faŋcalaj": [0]},
        gloss: {beautiful: [0]},
        regex: {Fangcalay: [0], lima: [1], wacu: [2]},
      },
    };
    expect([...indexCandidateParts(index, "lima", "exact")]).toEqual([1]);
    expect([...indexCandidateParts(index, "fan", "prefix")]).toEqual([0]);
    expect([...indexCandidateParts(index, "eaut", "translation")]).toEqual([0]);
    expect([...indexCandidateParts(index, "beautiful", "exact", null, "translation")]).toEqual([0]);
    expect([...indexCandidateParts(index, "beautful", "fuzzy", null, "translation")]).toEqual([0]);
    expect([...indexCandidateParts(index, "beautiful", "exact", null, "translation", "any")]).toEqual([0]);
    expect([...indexCandidateParts(index, "limx", "fuzzy")]).toEqual([1]);
  });
});

interface GoldenRecord {
  id: string;
  language_id: string;
  corpus_id: string;
  dialect: string;
  xml_id: string;
  standard: string;
  original: string;
  translations: Array<{text: string; xml_lang: string}>;
  tokens: Array<{surface: string; normalized: string}>;
  forms: Array<{text: string; normalized: string}>;
  phonology: string[];
  glosses: string[];
}

function searchRecord(value: GoldenRecord): SearchRecord {
  return {
    id: value.id,
    text_id: `text_${value.id}`,
    corpus_id: value.corpus_id,
    language_id: value.language_id,
    dialect: value.dialect,
    source_path: `Corpora/Golden/XML/${value.id}.xml`,
    xml_id: value.xml_id,
    standard: value.standard,
    original: value.original,
    translations: value.translations.map((translation) => ({
      ...translation,
      kind: "",
      version: "",
    })),
    tokens: value.tokens.map((token, position) => ({
      ...token,
      position,
      word_id: "",
    })),
    forms: value.forms.map((form, position) => ({
      ...form,
      owner_type: "sentence",
      owner_id: value.id,
      position,
      unclear: 0,
      kind: "standard",
      notes: "",
    })),
    phonology: value.phonology.map((text, position) => ({
      owner_type: "sentence",
      owner_id: value.id,
      position,
      text,
      unclear: 0,
      kind: "standard",
    })),
    tier_translations: value.glosses.map((text, position) => ({
      owner_type: "morpheme",
      owner_id: `${value.id}_morpheme`,
      position,
      text,
      normalized: normalizeSearch(text),
      xml_lang: "eng",
      kind: "gloss",
      version: "",
      unclear: 0,
      notes: "",
    })),
    words: [],
    audio: [],
  };
}

describe("shared golden search occurrences", () => {
  const records = (golden.records as GoldenRecord[]).map(searchRecord);

  for (const testCase of golden.cases) {
    it(testCase.name, () => {
      const scoped = records.filter(
        (candidate) =>
          (!testCase.language_ids ||
            testCase.language_ids.includes(candidate.language_id)) &&
          (!testCase.corpus_ids || testCase.corpus_ids.includes(candidate.corpus_id)),
      );
      const regex =
        testCase.mode === "regex" ? RE2JS.compile(testCase.query.normalize("NFC")) : null;
      const actual = scoped
        .filter((candidate) =>
          regex
            ? [
                candidate.standard,
                candidate.original,
                ...candidate.tokens.map((token) => token.surface),
                ...candidate.forms.map((form) => form.text),
                ...candidate.translations.map((translation) => translation.text),
                ...candidate.phonology.map((phonology) => phonology.text),
                ...candidate.tier_translations.map((translation) => translation.text),
              ].some((value) => regex.test(value.normalize("NFC")))
            : recordMatches(candidate, testCase.query, testCase.mode as SearchMode),
        )
        .map((candidate) => candidate.id)
        .sort();
      expect(actual).toEqual([...testCase.expected_ids].sort());
    });
  }

  it("rejects malformed and overlong query state", async () => {
    const {searchRecords} = await import("./data");
    await expect(searchRecords([], "[", "regex")).rejects.toThrow("Invalid RE2 pattern");
    await expect(searchRecords([], "x".repeat(257), "exact")).rejects.toThrow(
      "Query is too long",
    );
  });
});
