import {makeRecipe, renderExport} from "./exports";
import type {SearchRecord} from "./types";

const record: SearchRecord = {
  id: "sentence_fixture",
  corpus_id: "corpus_fixture",
  language_id: "lang_amis",
  dialect: "Xiuguluan",
  source_path: "Corpora/Fixture/XML/a.xml",
  xml_id: "s1",
  standard: "=fictional",
  original: "fictional",
  translations: [{text: "invented", xml_lang: "eng", kind: "", version: ""}],
  tokens: [{surface: "fictional", normalized: "fictional", position: 0}],
  audio: [{file: "fixture.wav", url: "", source: "", start: 1, end: 2}],
};

const context = {
  releaseId: "fb-20240102-deadbeef",
  query: "fictional",
  mode: "exact" as const,
  languageId: "lang_amis",
  corpusId: "corpus_fixture",
};

describe("browser exports", () => {
  it("guards spreadsheet formulas and uses LF records", () => {
    const output = renderExport([record], context, "csv");
    expect(output.contents).toContain("'=fictional");
    expect(output.contents.endsWith("\n")).toBe(true);
    expect(output.contents).not.toContain("\r");
  });

  it("creates non-executable bounded recipes", () => {
    const recipe = makeRecipe([record], context, "jsonl");
    expect(recipe.selection.record_ids).toEqual(["sentence_fixture"]);
    expect(recipe.selection.max_rows).toBe(1);
    expect(recipe).not.toHaveProperty("code");
  });

  it("keeps audio as references with timing", () => {
    const output = renderExport([record], context, "audio");
    expect(output.contents).toContain("fixture.wav");
    expect(output.contents).toContain("\t1\t2");
  });
});
