import {useEffect, useMemo, useRef, useState} from "react";

import {
  estimateScope,
  loadPreviewRecords,
  matchingIndexes,
  matchingShards,
  searchRecords,
  type SearchMode,
} from "../data";
import {downloadExport, type ExportFormat} from "../exports";
import {useI18n} from "../i18n";
import {
  projectRecordUnits,
  type RecordUnit,
} from "../recordUnits";
import {Link} from "../routing";
import type {AppData, SearchRecord} from "../types";

const FIELDS = [
  "id",
  "text_id",
  "standard",
  "original",
  "translations",
  "tokens",
  "phonology",
  "glosses",
  "language_id",
  "corpus_id",
  "dialect",
  "source_path",
  "audio",
];

function size(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function previewValue(record: SearchRecord, field: string): string {
  if (field === "translations") {
    return record.translations.map((item) => `${item.xml_lang}: ${item.text}`).join(" | ");
  }
  if (field === "tokens") return record.tokens.map((item) => item.surface).join(" ");
  if (field === "phonology") return record.phonology.map((item) => item.text).join(" | ");
  if (field === "glosses") return record.tier_translations.map((item) => item.text).join(" | ");
  if (field === "audio") {
    return record.audio.map((item) => item.file || item.url || item.source).filter(Boolean).join(" | ");
  }
  const value = record[field as keyof SearchRecord];
  return typeof value === "string" ? value : "";
}

export function DatasetBuilder({data}: {data: AppData}) {
  const {number, tx} = useI18n();
  const [languageId, setLanguageId] = useState("");
  const [corpusId, setCorpusId] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("exact");
  const [recordUnit, setRecordUnit] = useState<RecordUnit>("sentence");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [maxRows, setMaxRows] = useState<number | null>(1_000);
  const [fields, setFields] = useState<string[]>(FIELDS.slice(0, 8));
  const [preview, setPreview] = useState<SearchRecord[]>([]);
  const [matchingSourceRows, setMatchingSourceRows] = useState<number | null>(null);
  const [projectionRatio, setProjectionRatio] = useState(1);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);

  const corpora = useMemo(
    () =>
      data.corpora.filter(
        (corpus) => !languageId || corpus.languages.includes(languageId),
      ),
    [data.corpora, languageId],
  );
  const shards = useMemo(
    () => matchingShards(data.search, languageId, corpusId),
    [corpusId, data.search, languageId],
  );
  const indexes = useMemo(
    () => matchingIndexes(data.search, languageId, corpusId),
    [corpusId, data.search, languageId],
  );
  const estimate = useMemo(() => estimateScope(shards), [shards]);
  const selectedCorpora = corpusId
    ? data.corpora.filter((corpus) => corpus.id === corpusId)
    : corpora;
  const rightsById = new Map(data.rights.entries.map((entry) => [entry.id, entry]));
  const blockedRights = selectedCorpora
    .map((corpus) => rightsById.get(corpus.rights_id))
    .filter((entry) => entry && entry.redistribution !== "allowed");
  const overMemoryBudget = estimate.uncompressedBytes > 1024 ** 3;
  const selectedSourceRows = matchingSourceRows ?? (query.trim() ? 0 : estimate.records);
  const estimatedProjectedRows = Math.round(selectedSourceRows * projectionRatio);
  const expectedRows = maxRows === null
    ? estimatedProjectedRows
    : Math.min(maxRows, estimatedProjectedRows);
  const estimatedOutputBytes = useMemo(() => {
    if (!preview.length || !expectedRows || !fields.length) return 0;
    const sampleBytes = new TextEncoder().encode(
      JSON.stringify(preview.map((record) => fields.map((field) => previewValue(record, field)))),
    ).byteLength;
    return Math.round((sampleBytes / preview.length) * expectedRows);
  }, [expectedRows, fields, preview]);

  useEffect(() => {
    if (!languageId) return;
    previewController.current?.abort();
    const next = new AbortController();
    previewController.current = next;
    const timer = window.setTimeout(() => {
      setPreviewBusy(true);
      setError("");
      void (async () => {
        try {
          const result = query.trim()
            ? await searchRecords(shards, query.trim(), mode, next.signal, 12, indexes)
            : null;
          const sourceRecords = result?.records ?? await loadPreviewRecords(shards, next.signal, 12);
          const projected = projectRecordUnits(sourceRecords, recordUnit);
          setMatchingSourceRows(result?.matches ?? estimate.records);
          setProjectionRatio(sourceRecords.length ? projected.length / sourceRecords.length : 0);
          setPreview(projected.slice(0, 12));
        } catch (cause) {
          if (!(cause instanceof DOMException && cause.name === "AbortError")) {
            setError(cause instanceof Error ? cause.message : String(cause));
          }
        } finally {
          if (previewController.current === next) setPreviewBusy(false);
        }
      })();
    }, query.trim() ? 350 : 0);
    return () => {
      window.clearTimeout(timer);
      next.abort();
    };
  }, [estimate.records, indexes, languageId, mode, query, recordUnit, shards]);

  async function recordsForExport(signal: AbortSignal): Promise<SearchRecord[]> {
    const sourceLimit = maxRows ?? estimate.records;
    let sourceRecords: SearchRecord[];
    if (query.trim()) {
      if (estimate.uncompressedBytes > 512 * 1024 ** 2) {
        throw new Error(
          tx(
            "A filtered browser export would scan more than 512 MiB. Narrow the corpus or use a prepared package.",
            "經篩選的瀏覽器匯出將掃描超過 512 MiB。請縮小語料庫範圍或使用預備套件。",
          ),
        );
      }
      sourceRecords = (
        await searchRecords(shards, query.trim(), mode, signal, sourceLimit, indexes)
      ).records;
    } else {
      sourceRecords = await loadPreviewRecords(shards, signal, sourceLimit);
    }
    const projected = projectRecordUnits(sourceRecords, recordUnit);
    return maxRows === null ? projected : projected.slice(0, maxRows);
  }

  async function runPreview() {
    if (!languageId) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy("preview");
    setError("");
    try {
      const result = query.trim()
        ? await searchRecords(shards, query.trim(), mode, next.signal, 12, indexes)
        : null;
      const sourceRecords = result?.records ?? await loadPreviewRecords(shards, next.signal, 12);
      const projected = projectRecordUnits(sourceRecords, recordUnit);
      setMatchingSourceRows(result?.matches ?? estimate.records);
      setProjectionRatio(sourceRecords.length ? projected.length / sourceRecords.length : 0);
      setPreview(projected.slice(0, 12));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controller.current === next) setBusy(null);
    }
  }

  async function runExport() {
    if (!languageId || fields.length === 0) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy("export");
    setError("");
    try {
      const records = format === "recipe" ? [] : await recordsForExport(next.signal);
      await downloadExport(
        records,
        {
          releaseId: data.meta.release_id,
          query: query.trim(),
          mode,
          languageId,
          corpusId,
          fields,
          recordUnit,
        },
        format,
        next.signal,
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controller.current === next) setBusy(null);
    }
  }

  return (
    <section className="builder">
      <div className="builder__grid">
        <div className="builder__controls">
          <h2>{tx("Choose the records", "選擇記錄")}</h2>
          <p className="tool-note">
            {tx(
              "The preview and size estimate update as the selection changes.",
              "預覽與大小估算會隨選取條件更新。",
            )}
          </p>
          <div className="form-grid">
            <label className="field">
              {tx("Language", "語言")}
              <select
                value={languageId}
                onChange={(event) => {
                  const value = event.target.value;
                  previewController.current?.abort();
                  setLanguageId(value);
                  setCorpusId("");
                  setPreview([]);
                  setMatchingSourceRows(null);
                  setProjectionRatio(1);
                  setPreviewBusy(Boolean(value));
                }}
              >
                <option value="">{tx("Choose a display language…", "選擇顯示語言…")}</option>
                {data.languages.map((language) => (
                  <option value={language.id} key={language.id}>
                    {language.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {tx("Corpus", "語料庫")}
              <select
                value={corpusId}
                disabled={!languageId}
                onChange={(event) => setCorpusId(event.target.value)}
              >
                <option value="">{tx("All compatible corpora", "所有相容語料庫")}</option>
                {corpora.map((corpus) => (
                  <option value={corpus.id} key={corpus.id}>
                    {corpus.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {tx("Record unit", "記錄單位")}
              <select
                value={recordUnit}
                onChange={(event) => {
                  setRecordUnit(event.target.value as RecordUnit);
                  setPreview([]);
                }}
              >
                <option value="text">{tx("Text", "文本")}</option>
                <option value="sentence">{tx("Sentence", "句子")}</option>
                <option value="word">{tx("Word", "詞")}</option>
                <option value="morpheme">{tx("Morpheme", "語素")}</option>
                <option value="token">{tx("Token", "詞元")}</option>
                <option value="audio">{tx("Audio reference", "音訊參照")}</option>
              </select>
            </label>
            <label className="field">
              {tx("Optional query", "選用查詢")}
              <input
                value={query}
                maxLength={256}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx("Leave blank for the first rows in source order", "留白則依來源順序取得前幾筆")}
              />
            </label>
            <label className="field">
              {tx("Query mode", "查詢模式")}
              <select
                value={mode}
                disabled={!query.trim()}
                onChange={(event) => setMode(event.target.value as SearchMode)}
              >
                <option value="source">{tx("Source exact", "來源完全相符")}</option>
                <option value="exact">{tx("Normalized exact", "正規化後完全相符")}</option>
                <option value="prefix">{tx("Prefix", "前綴")}</option>
                <option value="contains">{tx("Contains", "包含")}</option>
                <option value="translation">{tx("Translation", "翻譯")}</option>
                <option value="phonology">{tx("Phonology", "音韻")}</option>
                <option value="gloss">{tx("Morpheme or gloss", "語素或詞彙註釋")}</option>
                <option value="fuzzy">{tx("Fuzzy", "模糊")}</option>
                <option value="regex">{tx("Scoped RE2", "限定範圍的 RE2")}</option>
              </select>
            </label>
          </div>
          <h2 className="builder__section-title">
            {tx("Choose the columns and file", "選擇欄位與檔案")}
          </h2>
          <fieldset className="field-checks">
            <legend>{tx("Included fields", "包含欄位")}</legend>
            {FIELDS.map((field) => (
              <label key={field}>
                <input
                  type="checkbox"
                  checked={fields.includes(field)}
                  onChange={() =>
                    setFields((current) =>
                      current.includes(field)
                        ? current.filter((value) => value !== field)
                        : [...current, field],
                    )
                  }
                />
                {field}
              </label>
            ))}
          </fieldset>
          <div className="form-grid">
            <label className="field">
              {tx("Output row cap", "輸出列數上限")}
              <select
                value={maxRows ?? "all"}
                onChange={(event) =>
                  setMaxRows(event.target.value === "all" ? null : Number(event.target.value))
                }
              >
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
                <option value={50000}>50,000</option>
                <option value={100000}>100,000</option>
                <option value="all">{tx("All rows in scope", "範圍內所有列")}</option>
              </select>
            </label>
            <label className="field">
              {tx("Format", "格式")}
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as ExportFormat)}
              >
                <option value="csv">CSV</option>
                <option value="tsv">TSV</option>
                <option value="json">JSON</option>
                <option value="jsonl">{tx("JSON Lines", "JSON 行格式")}</option>
                <option value="parquet">{tx("Parquet via DuckDB-Wasm", "透過 DuckDB-Wasm 產生 Parquet")}</option>
                <option value="plain">{tx("Plain text", "純文字")}</option>
                <option value="interlinear">{tx("Interlinear text", "逐行對譯文字")}</option>
                <option value="audio">{tx("Audio references", "音訊參照")}</option>
                <option value="recipe">{tx("Reproducible recipe", "可重現操作配方")}</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button
              className="button button--quiet"
              disabled={!languageId || Boolean(busy)}
              onClick={runPreview}
            >
              {busy === "preview" ? tx("Refreshing…", "更新中…") : tx("Refresh preview", "更新預覽")}
            </button>
            <button
              className="button button--primary"
              disabled={
                !languageId ||
                fields.length === 0 ||
                Boolean(busy) ||
                (format !== "recipe" && (overMemoryBudget || blockedRights.length > 0))
              }
              onClick={runExport}
            >
              {busy === "export" ? tx("Preparing export…", "準備匯出中…") : tx("Download", "下載")}
            </button>
            {busy && (
              <button className="text-button" onClick={() => controller.current?.abort()}>
                {tx("Cancel", "取消")}
              </button>
            )}
          </div>
        </div>
        <aside className="builder__estimate">
          <div className="builder__estimate-heading">
            <p className="eyebrow">{tx("Current selection", "目前選取範圍")}</p>
            {previewBusy && <span>{tx("Updating…", "更新中…")}</span>}
          </div>
          <dl>
            <div>
              <dt>
                {query.trim()
                  ? tx("Matching source sentences", "相符來源句子")
                  : tx("Source sentences", "來源句子")}
              </dt>
              <dd>{previewBusy ? "…" : number(selectedSourceRows)}</dd>
            </div>
            <div>
              <dt>{tx("Estimated output rows", "估計輸出列數")}</dt>
              <dd>
                {number(expectedRows)}
                {recordUnit !== "sentence" && (
                  <small>{tx("sample estimate", "樣本估算")}</small>
                )}
              </dd>
            </div>
            <div>
              <dt>{tx("Approximate output size", "估計輸出大小")}</dt>
              <dd>{estimatedOutputBytes ? size(estimatedOutputBytes) : "—"}</dd>
            </div>
            <div>
              <dt>{tx("Output limit", "輸出上限")}</dt>
              <dd>{maxRows === null ? tx("All rows", "所有列") : number(maxRows)}</dd>
            </div>
          </dl>
          <details className="builder__workload">
            <summary>{tx("Browser workload", "瀏覽器工作量")}</summary>
            <dl>
              <div>
                <dt>{tx("Network transfer", "網路傳輸量")}</dt>
                <dd>{size(estimate.compressedBytes)}</dd>
              </div>
              <div>
                <dt>{tx("Decoded input", "解碼後輸入量")}</dt>
                <dd>{size(estimate.uncompressedBytes)}</dd>
              </div>
            </dl>
          </details>
          {overMemoryBudget && (
            <p className="callout callout--warning">
              {tx("This scope exceeds the 1 GiB browser safety limit. Narrow it or use a prepared download.", "此範圍超過瀏覽器 1 GiB 安全限制。請縮小範圍或使用預備下載檔案。")}
            </p>
          )}
          {blockedRights.length > 0 && (
            <p className="callout callout--warning">
              {tx("Data export is disabled because at least one corpus does not have a reviewed redistribution decision. A recipe may still be saved.", "至少一個語料庫尚無經審查的再散布決定，因此停用資料匯出；仍可儲存操作配方。")}
            </p>
          )}
          <Link to="/downloads">{tx("Browse prepared packages →", "瀏覽預備套件 →")}</Link>
        </aside>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      <div className="builder__preview" aria-busy={previewBusy}>
        <div className="builder__preview-heading">
          <div>
            <h2>{tx("Dataset preview", "資料集預覽")}</h2>
            <p>
              {languageId
                ? tx(
                    `First ${preview.length} ${recordUnit} rows in deterministic source order.`,
                    `依可重現來源順序顯示前 ${preview.length} 筆 ${recordUnit} 列。`,
                  )
                : tx("Choose a language to inspect the dataset.", "選擇語言以檢視資料集。")}
            </p>
          </div>
          {previewBusy && <span className="status">{tx("Updating…", "更新中…")}</span>}
        </div>
        {languageId && !previewBusy && preview.length === 0 && (
          <div className="empty-state">
            {tx("No rows match this selection.", "沒有符合此選取範圍的列。")}
          </div>
        )}
        {preview.length > 0 && fields.length > 0 && (
          <div className="table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  {fields.map((field) => <th key={field}>{field}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.map((record) => (
                  <tr key={record.id}>
                    {fields.map((field) => (
                      <td key={field}>{previewValue(record, field) || "—"}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fields.length === 0 && (
          <div className="empty-state">
            {tx("Select at least one field to preview and export.", "請至少選擇一個欄位以預覽及匯出。")}
          </div>
        )}
      </div>
    </section>
  );
}
