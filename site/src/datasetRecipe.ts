import {DATASET_FIELDS_BY_LEVEL, DEFAULT_DATASET_FIELDS, type DatasetFieldsByLevel, type DatasetLevel} from "./datasetSelection";
import type {AppData, MatchMode, SearchDirection} from "./types";

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
  completeFields: boolean;
}

export function datasetScopeFromUrl(params: URLSearchParams, data: AppData): DatasetRecipeInput {
  const language = data.languages.find((item) => item.id === params.get("language"));
  const corpus = data.corpora.find((item) => item.id === params.get("corpus") && language && item.languages.includes(language.id));
  const levels: DatasetLevel[] = ["sentence", "word", "morpheme"];
  const fields = (level: DatasetLevel) => params.has(`${level}_fields`)
    ? DATASET_FIELDS_BY_LEVEL[level].filter((field) => params.get(`${level}_fields`)?.split(",").includes(field))
    : [...DEFAULT_DATASET_FIELDS[level]];
  const maxRows = Number(params.get("rows"));
  const mode = params.get("mode");
  const format = params.get("format");
  return {
    releaseId: data.meta.release_id, languageId: language?.id ?? "", corpusId: corpus?.id ?? "",
    dialect: language?.dialects.find((value) => value === params.get("dialect")) ?? "",
    query: (params.get("q") ?? "").slice(0, 2048), direction: params.get("direction") === "translation" ? "translation" : "formosan",
    translationLanguage: (params.get("target") ?? "").slice(0, 32),
    match: mode === "prefix" || mode === "contains" ? mode : "exact",
    recordLevels: params.has("levels") ? levels.filter((level) => params.get("levels")?.split(",").includes(level)) : ["sentence"],
    fields: {sentence: fields("sentence"), word: fields("word"), morpheme: fields("morpheme")},
    maxRows: [1000, 10000, 25000, 50000, 100000].includes(maxRows) ? maxRows : 1000,
    format: format === "tsv" || format === "jsonl" ? format : "csv", completeFields: params.get("complete") !== "false",
  };
}

export function datasetScopeToUrl(scope: DatasetRecipeInput, view = "builder"): URLSearchParams {
  return new URLSearchParams({
    view, language: scope.languageId, corpus: scope.corpusId, dialect: scope.dialect,
    q: scope.query, direction: scope.direction, target: scope.translationLanguage, mode: scope.match,
    levels: scope.recordLevels.join(","), rows: String(scope.maxRows), format: scope.format,
    complete: String(scope.completeFields), sentence_fields: scope.fields.sentence.join(","),
    word_fields: scope.fields.word.join(","), morpheme_fields: scope.fields.morpheme.join(","),
  });
}

export function createDatasetRecipe(input: DatasetRecipeInput) {
  return {
    schema_version: "2.0.0" as const,
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
      complete_fields: input.completeFields,
    },
    fields: Object.fromEntries(
      input.recordLevels.map((level) => [level, [...input.fields[level]]]),
    ),
    format: input.format,
    spreadsheet_safe: true,
  };
}
