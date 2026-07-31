import type {SearchMode} from "./data";
import type {SearchRecord} from "./types";

export type ExportFormat =
  | "csv"
  | "tsv"
  | "json"
  | "jsonl"
  | "parquet"
  | "plain"
  | "interlinear"
  | "audio"
  | "recipe";

export interface ExportRecipe {
  schema_version: "1.0.0";
  release_id: string;
  selection: {
    query: string;
    match: SearchMode;
    language_ids: string[];
    corpus_ids: string[];
    record_ids: string[];
    max_rows: number;
  };
  fields: string[];
  format: ExportFormat;
  spreadsheet_safe: boolean;
}

export interface ExportContext {
  releaseId: string;
  query: string;
  mode: SearchMode;
  languageId: string;
  corpusId: string;
  fields?: string[];
}

interface RenderedExport {
  contents: string;
  extension: string;
  mediaType: string;
}

export const COLUMNS = [
  "id",
  "standard",
  "original",
  "translations",
  "language_id",
  "corpus_id",
  "dialect",
  "source_path",
];

function safeCell(value: string, spreadsheetSafe: boolean): string {
  if (!spreadsheetSafe) return value;
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

function delimitedCell(value: string, delimiter: string, spreadsheetSafe: boolean): string {
  const safe = safeCell(value, spreadsheetSafe);
  if (safe.includes(delimiter) || /["\r\n]/.test(safe)) {
    return `"${safe.replaceAll('"', '""')}"`;
  }
  return safe;
}

function fieldValue(record: SearchRecord, field: string): string {
  if (field === "translations") {
    return record.translations.map((item) => `${item.xml_lang}:${item.text}`).join(" | ");
  }
  if (field === "tokens") return record.tokens.map((item) => item.surface).join(" ");
  if (field === "phonology") return record.phonology.map((item) => item.text).join(" | ");
  if (field === "glosses") {
    return record.tier_translations
      .filter((item) => item.owner_type !== "sentence")
      .map((item) => item.text)
      .join(" | ");
  }
  if (field === "audio") return JSON.stringify(record.audio);
  const value = record[field as keyof SearchRecord];
  return typeof value === "string" ? value : JSON.stringify(value);
}

export function exportRow(record: SearchRecord, columns: string[] = COLUMNS): string[] {
  return columns.map((column) => fieldValue(record, column));
}

export function makeRecipe(
  records: SearchRecord[],
  context: ExportContext,
  format: ExportFormat,
): ExportRecipe {
  return {
    schema_version: "1.0.0",
    release_id: context.releaseId,
    selection: {
      query: context.query,
      match: context.mode,
      language_ids: [context.languageId],
      corpus_ids: context.corpusId ? [context.corpusId] : [],
      record_ids: records.map((record) => record.id),
      max_rows: records.length,
    },
    fields: context.fields ?? COLUMNS,
    format,
    spreadsheet_safe: true,
  };
}

export function renderExport(
  records: SearchRecord[],
  context: ExportContext,
  format: ExportFormat,
): RenderedExport {
  if (format === "parquet") {
    throw new Error("Parquet is generated through the lazy DuckDB-Wasm export path");
  }
  if (format === "recipe") {
    return {
      contents: `${JSON.stringify(makeRecipe(records, context, "jsonl"), null, 2)}\n`,
      extension: "recipe.json",
      mediaType: "application/json",
    };
  }
  if (format === "json") {
    return {
      contents: `${JSON.stringify(records, null, 2)}\n`,
      extension: "json",
      mediaType: "application/json",
    };
  }
  if (format === "jsonl") {
    return {
      contents: `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
      extension: "jsonl",
      mediaType: "application/x-ndjson",
    };
  }
  if (format === "plain") {
    return {
      contents: `${records
        .map((record) => record.standard || record.original)
        .join("\n")}\n`,
      extension: "txt",
      mediaType: "text/plain;charset=utf-8",
    };
  }
  if (format === "interlinear") {
    const contents = records
      .map((record) => {
        const translation = record.translations.map((item) => item.text).join(" | ");
        return [
          `\\id ${record.id}`,
          `\\tx ${record.standard || record.original}`,
          `\\mb ${record.tokens.map((token) => token.surface).join(" ")}`,
          `\\ft ${translation}`,
        ].join("\n");
      })
      .join("\n\n");
    return {
      contents: `${contents}\n`,
      extension: "interlinear.txt",
      mediaType: "text/plain;charset=utf-8",
    };
  }
  if (format === "audio") {
    const lines = [
      [
        "sentence_id",
        "corpus_id",
        "language_id",
        "source_path",
        "file",
        "url",
        "source",
        "start",
        "end",
      ],
      ...records.flatMap((record) =>
        record.audio.map((audio) => [
          record.id,
          record.corpus_id,
          record.language_id,
          record.source_path,
          audio.file,
          audio.url,
          audio.source,
          audio.start?.toString() ?? "",
          audio.end?.toString() ?? "",
        ]),
      ),
    ];
    return {
      contents: `${lines
        .map((values) => values.map((value) => delimitedCell(value, "\t", true)).join("\t"))
        .join("\n")}\n`,
      extension: "audio.tsv",
      mediaType: "text/tab-separated-values;charset=utf-8",
    };
  }
  const columns = context.fields ?? COLUMNS;
  const delimiter = format === "tsv" ? "\t" : ",";
  const lines = [columns, ...records.map((record) => exportRow(record, columns))].map((values) =>
    values.map((value) => delimitedCell(value, delimiter, true)).join(delimiter),
  );
  return {
    contents: `\uFEFF${lines.join("\n")}\n`,
    extension: format,
    mediaType:
      format === "tsv"
        ? "text/tab-separated-values;charset=utf-8"
        : "text/csv;charset=utf-8",
  };
}

export async function downloadExport(
  records: SearchRecord[],
  context: ExportContext,
  format: ExportFormat,
  signal?: AbortSignal,
): Promise<void> {
  if (format === "parquet") {
    if (records.length > 10_000) {
      throw new Error("Browser Parquet export is limited to 10,000 records");
    }
    const {parquetFromRows} = await import("./duckdbExport");
    const columns = context.fields ?? COLUMNS;
    const rows = records.map((record) => {
      const values = exportRow(record, columns);
      return Object.fromEntries(
        columns.map((column, index) => [column, values[index] ?? ""]),
      );
    });
    const contents = await parquetFromRows(rows, signal);
    const url = URL.createObjectURL(
      new Blob([contents as BlobPart], {type: "application/vnd.apache.parquet"}),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `kakarayan-${context.releaseId}.parquet`;
    anchor.click();
    URL.revokeObjectURL(url);
    return;
  }
  const rendered = renderExport(records, context, format);
  const url = URL.createObjectURL(
    new Blob([rendered.contents], {type: rendered.mediaType}),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kakarayan-${context.releaseId}-${rendered.extension}`;
  anchor.click();
  URL.revokeObjectURL(url);
}
