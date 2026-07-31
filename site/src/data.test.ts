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
  tokens: [{surface: "Fangcalay", normalized: "fangcalay", position: 0}],
};

describe("transparent static search", () => {
  it("normalizes NFC and case without stripping contrastive letters", () => {
    expect(normalizeSearch("  FANGCALAY ")).toBe("fangcalay");
    expect(normalizeSearch("ʉ")).toBe("ʉ");
  });

  it("supports exact, prefix, contains, and translation modes", () => {
    expect(recordMatches(record, "fangcalay", "exact")).toBe(true);
    expect(recordMatches(record, "fang", "prefix")).toBe(true);
    expect(recordMatches(record, "ngca", "contains")).toBe(true);
    expect(recordMatches(record, "beaut", "translation")).toBe(true);
    expect(recordMatches(record, "ugly", "translation")).toBe(false);
  });
});

