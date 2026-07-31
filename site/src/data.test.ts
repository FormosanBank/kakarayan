import {normalizeSearch, recordMatches} from "./data";
import type {SearchRecord} from "./types";

const record: SearchRecord = {
  id: "sentence_1",
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
});
