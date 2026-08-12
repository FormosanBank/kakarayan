import type {DatasetField} from "./datasetSelection";
import type {MatchMode, SearchDirection, TierRequirement} from "./types";

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
  requirements: TierRequirement[];
  maxRows: number;
  fields: DatasetField[];
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
      requirements: [...input.requirements],
      record_ids: [] as string[],
      max_rows: input.maxRows,
      record_unit: "sentence" as const,
    },
    fields: [...input.fields],
    format: input.format,
    spreadsheet_safe: true,
  };
}
