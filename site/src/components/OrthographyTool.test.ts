import type {OrthographyTable} from "../types";
import {convertOrthography} from "../orthography";

const table: OrthographyTable = {
  id: "orthography_test",
  language: "Amis",
  name: "Amis_Test",
  source_path: "Orthographies/ConversionTables/Amis_Test.tsv",
  dialects: ["Coastal"],
  rules: [
    {input: "ng", outputs: {Coastal: "ŋ"}},
    {input: "n", outputs: {Coastal: ""}},
  ],
};

it("applies the longest reviewed mapping without cascading replacements", () => {
  const result = convertOrthography("ngan", table, "Coastal");
  expect(result.text).toBe("ŋan");
  expect(result.changes).toEqual([
    {from: "ng", to: "ŋ", position: 0, ambiguous: false},
    {from: "n", to: "n", position: 3, ambiguous: true},
  ]);
});
