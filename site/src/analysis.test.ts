import {analyzeRecords} from "./analysis";
import type {SearchRecord} from "./types";

function record(id: string, tokens: string[]): SearchRecord {
  return {
    id,
    corpus_id: "corpus_fixture",
    language_id: "lang_amis",
    dialect: "Xiuguluan",
    source_path: `Corpora/Fixture/XML/${id}.xml`,
    xml_id: id,
    standard: tokens.join(" "),
    original: tokens.join(" "),
    translations: [{text: "fictional line", xml_lang: "eng", kind: "", version: ""}],
    tokens: tokens.map((surface, position) => ({
      surface,
      normalized: surface.toLocaleLowerCase(),
      position,
      word_id: `w${position}`,
    })),
    forms: [],
    phonology: [],
    tier_translations: [],
    words: [],
    audio: [],
  };
}

describe("linguistic summaries", () => {
  it("computes deterministic bounded tables and seeded samples", () => {
    const records = [
      record("s1", ["Lima", "waco", "lima"]),
      record("s2", ["toki", "lima"]),
    ];
    const first = analyzeRecords(records, {
      ngramSize: 2,
      collocate: "lima",
      seed: "fixture-seed",
    });
    const second = analyzeRecords(records, {
      ngramSize: 2,
      collocate: "lima",
      seed: "fixture-seed",
    });
    expect(first).toEqual(second);
    expect(first.tokens).toBe(5);
    expect(first.normalizedFrequencies[0]).toEqual({value: "lima", count: 3});
    expect(first.ngrams).toContainEqual({value: "lima waco", count: 1});
    expect(first.collocates).toContainEqual({value: "waco", count: 2});
    expect(first.sampleIds).toHaveLength(2);
  });
});
