import type {SearchRecord} from "../types";
import {recordHasTier, sortResultRecords} from "../searchResultControls";

function record(id: string, text: string, dialect = "Coastal"): SearchRecord {
  return {
    id,
    text_id: `text_${id}`,
    corpus_id: "corpus_fixture",
    language_id: "lang_amis",
    dialect,
    source_path: `Corpora/Fixture/${id}.xml`,
    xml_id: id,
    standard: text,
    original: text,
    translations: [],
    tokens: [],
    forms: [],
    phonology: [],
    tier_translations: [],
    words: [],
    audio: [],
  };
}

describe("concordance result controls", () => {
  it("sorts the shown window deterministically", () => {
    const values = [record("long", "three tokens here"), record("short", "one")];
    expect(sortResultRecords(values, "shortest").map((item) => item.id)).toEqual(["short", "long"]);
    expect(sortResultRecords(values, "source")).toBe(values);
  });

  it("detects evidence tiers without guessing unavailable data", () => {
    const value = record("audio", "fangcalay");
    value.audio.push({
      owner_type: "sentence",
      owner_id: value.id,
      position: 0,
      file: "example.wav",
      url: "",
      start: null,
      end: null,
      source: "",
      duration: null,
      availability_status: "referenced",
    });
    expect(recordHasTier(value, "audio")).toBe(true);
    expect(recordHasTier(value, "phonology")).toBe(false);
  });
});
