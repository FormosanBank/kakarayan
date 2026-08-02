import {datasetFieldValue, recordMeetsFilters} from "./datasetSelection";
import type {SearchRecord} from "./types";

const record: SearchRecord = {
  id: "sentence_fixture",
  text_id: "text_fixture",
  corpus_id: "corpus_fixture",
  language_id: "lang_amis",
  dialect: "Coastal",
  source_path: "Corpora/Fixture/XML/a.xml",
  xml_id: "s1",
  standard: "fangcalay",
  original: "fangcalay",
  translations: [{text: "good", xml_lang: "eng", kind: "", version: ""}],
  tokens: [{surface: "fangcalay", normalized: "fangcalay", position: 0, word_id: "w1"}],
  forms: [{owner_type: "word", owner_id: "w1", position: 0, text: "fangcalay", unclear: 1, kind: "original", notes: "", normalized: "fangcalay"}],
  phonology: [],
  tier_translations: [],
  words: [{id: "w1", xml_id: "w1", position: 0, class: "", sclass: "", morphemes: []}],
  audio: [],
};

describe("dataset selection", () => {
  it("combines dialect and tier-presence requirements", () => {
    expect(recordMeetsFilters(record, ["Coastal"], ["translation", "interlinear", "unclear"])).toBe(true);
    expect(recordMeetsFilters(record, ["Malan"], ["translation"])).toBe(false);
    expect(recordMeetsFilters(record, [], ["audio"])).toBe(false);
  });

  it("renders typed fields without collapsing translation language tags", () => {
    expect(datasetFieldValue(record, "translations")).toBe("eng: good");
    expect(datasetFieldValue(record, "tokens")).toBe("fangcalay");
  });
});
