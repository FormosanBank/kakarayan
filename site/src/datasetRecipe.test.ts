import fixture from "../../tests/fixtures/export-recipe.json";

import {createDatasetRecipe} from "./datasetRecipe";

it("emits the schema-validated representative recipe", () => {
  expect(
    createDatasetRecipe({
      releaseId: "fb-20240102-3b367525",
      query: " five ",
      match: "contains",
      direction: "translation",
      translationLanguage: "eng",
      languageId: "lang_amis",
      corpusId: "corpus_testcorpus",
      dialect: "Xiuguluan",
      recordLevels: ["sentence", "word", "morpheme"],
      maxRows: 250,
      fields: {
        sentence: ["id", "standard", "translation_columns"],
        word: ["id", "sentence_id", "form"],
        morpheme: ["id", "word_id", "form", "translation_columns"],
      },
      format: "csv",
    }),
  ).toEqual(fixture);
});
