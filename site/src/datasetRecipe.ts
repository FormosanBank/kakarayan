import type {DatasetFieldsByLevel, DatasetLevel} from "./datasetSelection";
import type {MatchMode, SearchDirection} from "./types";

export type DatasetFormat = "csv" | "tsv" | "jsonl";

export interface DatasetRecipeInput {
  releaseId: string;
  query: string;
  match: MatchMode;
  direction: SearchDirection;
  translationLanguage: string;
  languageId: string;
  corpusId: string;
  dialect: string;
  recordLevels: DatasetLevel[];
  maxRows: number;
  fields: DatasetFieldsByLevel;
  format: DatasetFormat;
}

export function createDatasetRecipe(input: DatasetRecipeInput) {
  return {
    schema_version: "1.0.0" as const,
    release_id: input.releaseId,
    selection: {
      query: input.query.trim(),
      match: input.match,
      query_field: input.direction,
      translation_language: input.translationLanguage,
      language_ids: [input.languageId],
      corpus_ids: input.corpusId ? [input.corpusId] : [],
      dialects: input.dialect ? [input.dialect] : [],
      requirements: [],
      record_ids: [] as string[],
      max_rows: input.maxRows,
      record_units: [...input.recordLevels],
      complete_fields: true,
    },
    fields: Object.fromEntries(
      input.recordLevels.map((level) => [level, [...input.fields[level]]]),
    ),
    format: input.format,
    spreadsheet_safe: true,
  };
}
