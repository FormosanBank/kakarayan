import {useMemo, useRef, useState} from "react";

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

export function DatasetBuilder({data}: {data: AppData}) {
  const {number, tx} = useI18n();
  const [languageId, setLanguageId] = useState("");
  const [corpusId, setCorpusId] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("exact");
  const [recordUnit, setRecordUnit] = useState<RecordUnit>("sentence");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [maxRows, setMaxRows] = useState(1_000);
  const [fields, setFields] = useState<string[]>(FIELDS.slice(0, 8));
  const [preview, setPreview] = useState<SearchRecord[]>([]);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);

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

  async function recordsForExport(signal: AbortSignal): Promise<SearchRecord[]> {
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
        await searchRecords(shards, query.trim(), mode, signal, maxRows, indexes)
      ).records;
    } else {
      sourceRecords = await loadPreviewRecords(shards, signal, maxRows);
    }
    return projectRecordUnits(sourceRecords, recordUnit).slice(0, maxRows);
  }

  async function runPreview() {
    if (!languageId) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy("preview");
    setError("");
    try {
      const sourceRecords = query.trim()
        ? (
            await searchRecords(
              shards,
              query.trim(),
              mode,
              next.signal,
              12,
              indexes,
            )
          ).records
        : await loadPreviewRecords(shards, next.signal, 12);
      setPreview(projectRecordUnits(sourceRecords, recordUnit).slice(0, 12));
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
      const records = await recordsForExport(next.signal);
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
      <div className="builder__steps">
        <div>
          <span>01</span>
          <strong>{tx("Scope", "範圍")}</strong>
        </div>
        <div>
          <span>02</span>
          <strong>{tx("Fields", "欄位")}</strong>
        </div>
        <div>
          <span>03</span>
          <strong>{tx("Preview", "預覽")}</strong>
        </div>
        <div>
          <span>04</span>
          <strong>{tx("Export", "匯出")}</strong>
        </div>
      </div>
      <div className="builder__grid">
        <div className="builder__controls">
          <h2>{tx("Build a bounded linguistic dataset", "建立有界限的語言學資料集")}</h2>
          <div className="form-grid">
            <label className="field">
              {tx("Language", "語言")}
              <select
                value={languageId}
                onChange={(event) => {
                  setLanguageId(event.target.value);
                  setCorpusId("");
                  setPreview([]);
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
              <select value={corpusId} onChange={(event) => setCorpusId(event.target.value)}>
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
              <select value={mode} onChange={(event) => setMode(event.target.value as SearchMode)}>
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
                value={maxRows}
                onChange={(event) => setMaxRows(Number(event.target.value))}
              >
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
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
              {busy === "preview" ? tx("Loading preview…", "載入預覽中…") : tx("Preview", "預覽")}
            </button>
            <button
              className="button button--primary"
              disabled={
                !languageId ||
                fields.length === 0 ||
                Boolean(busy) ||
                overMemoryBudget ||
                (blockedRights.length > 0 && format !== "recipe")
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
          <p className="eyebrow">{tx("Selection estimate", "選取範圍估算")}</p>
          <dl>
            <div>
              <dt>{tx("Source sentences in scope", "範圍內來源句子")}</dt>
              <dd>{number(estimate.records)}</dd>
            </div>
            <div>
              <dt>{tx("Network transfer", "網路傳輸量")}</dt>
              <dd>{size(estimate.compressedBytes)}</dd>
            </div>
            <div>
              <dt>{tx("Decoded input", "解碼後輸入量")}</dt>
              <dd>{size(estimate.uncompressedBytes)}</dd>
            </div>
            <div>
              <dt>{recordUnit} {tx("row bound", "列數上限")}</dt>
              <dd>{number(Math.min(maxRows, estimate.records))} {tx("rows", "列")}</dd>
            </div>
          </dl>
          <p>
            {tx(
              "The estimate covers source shards, not the final file. Queries may return fewer rows. Word, morpheme, token, and audio totals are known after the bounded source records load. Ordering follows source path and tier order.",
              "估算涵蓋來源分片，而非最終檔案。查詢可能傳回較少列數。詞、語素、詞元與音訊總數會在載入有界限的來源記錄後確定；排列順序依來源路徑與層級順序。",
            )}
          </p>
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
      {preview.length > 0 && (
        <div className="builder__preview">
          <h2>{tx("Preview in deterministic source order", "依可重現來源順序預覽")}</h2>
          <p>
            {tx("Showing", "顯示")} {number(preview.length)} {tx("projected", "筆投影的")}{" "}
            {recordUnit} {tx("rows. Empty units mean the selected source lacks that structure.", "列。空白單位表示所選來源缺少該結構。")}
          </p>
          <div className="table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>{tx("Source form", "來源形式")}</th>
                  <th>{tx("Translation", "翻譯")}</th>
                  <th>{tx("Corpus", "語料庫")}</th>
                  <th>{tx("Locator", "定位資訊")}</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((record) => (
                  <tr key={record.id}>
                    <td>{record.standard || record.original}</td>
                    <td>{record.translations.map((item) => item.text).join(" | ")}</td>
                    <td>
                      {data.corpora.find((corpus) => corpus.id === record.corpus_id)?.name}
                    </td>
                    <td>
                      <code>{record.xml_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
