import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {
  estimateScope,
  loadPreviewRecords,
  searchRecords,
  type SearchMode,
} from "../data";
import {
  DATASET_FIELD_INFO,
  DATASET_FIELDS,
  datasetFieldValue,
  ESSENTIAL_DATASET_FIELDS,
  recordMeetsFilters,
  TIER_REQUIREMENTS,
  type TierRequirement,
} from "../datasetSelection";
import {downloadExport, type ExportFormat} from "../exports";
import {useI18n} from "../i18n";
import {
  projectRecordUnits,
  recordHasUnit,
  type RecordUnit,
} from "../recordUnits";
import {Link, useSearchParams} from "../routing";
import type {AppData, SearchRecord} from "../types";
import {DatasetPreview} from "./DatasetPreview";

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

function unitCountKey(unit: RecordUnit): "texts" | "sentences" | "words" | "morphemes" | "tokens" | "audio" {
  return unit === "audio" ? "audio" : `${unit}s`;
}

export function DatasetBuilder({data}: {data: AppData}) {
  const {dialectName, languageName, number, tx} = useI18n();
  const [params] = useSearchParams();
  const requestedCorpus = data.corpora.find((corpus) => corpus.id === params.get("corpus"));
  const requestedLanguageId = data.languages.some(
    (language) => language.id === params.get("language"),
  )
    ? params.get("language") ?? ""
    : "";
  const initialLanguageId = requestedCorpus
    ? requestedCorpus.languages.includes(requestedLanguageId)
      ? requestedLanguageId
      : requestedCorpus.languages[0] ?? ""
    : requestedLanguageId;
  const initialCorpusId = requestedCorpus?.languages.includes(initialLanguageId)
    ? requestedCorpus.id
    : "";
  const tierLabels: Record<TierRequirement, string> = {
    translation: tx("translation", "翻譯"),
    audio: tx("audio evidence", "音訊證據"),
    phonology: tx("phonology", "音韻"),
    interlinear: tx("word or morpheme analysis", "詞或語素分析"),
    unclear: tx("an unclear annotation", "不確定標註"),
  };
  const [languageId, setLanguageId] = useState(initialLanguageId);
  const [additionalLanguageIds, setAdditionalLanguageIds] = useState<string[]>([]);
  const [corpusId, setCorpusId] = useState(initialCorpusId);
  const [additionalCorpusIds, setAdditionalCorpusIds] = useState<string[]>([]);
  const [dialects, setDialects] = useState<string[]>([]);
  const [requirements, setRequirements] = useState<TierRequirement[]>([]);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("exact");
  const [recordUnit, setRecordUnit] = useState<RecordUnit>("sentence");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [maxRows, setMaxRows] = useState<number | null>(1_000);
  const [fields, setFields] = useState<string[]>(ESSENTIAL_DATASET_FIELDS);
  const [preview, setPreview] = useState<SearchRecord[]>([]);
  const [matchingSourceRows, setMatchingSourceRows] = useState<number | null>(null);
  const [projectionRatio, setProjectionRatio] = useState(1);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const previewController = useRef<AbortController | null>(null);

  const languageIds = useMemo(
    () => [languageId, ...additionalLanguageIds].filter(Boolean),
    [additionalLanguageIds, languageId],
  );
  const corpora = useMemo(
    () =>
      data.corpora.filter(
        (corpus) => !languageIds.length || corpus.languages.some((id) => languageIds.includes(id)),
      ),
    [data.corpora, languageIds],
  );
  const corpusIds = useMemo(
    () => corpusId ? [corpusId, ...additionalCorpusIds].filter((id) => corpora.some((item) => item.id === id)) : [],
    [additionalCorpusIds, corpora, corpusId],
  );
  const availableDialects = useMemo(
    () => [...new Set(data.languages.filter((item) => languageIds.includes(item.id)).flatMap((item) => item.dialects))].sort(),
    [data.languages, languageIds],
  );
  const shards = useMemo(
    () => data.search.shards.filter(
      (shard) => languageIds.includes(shard.language_id) && (!corpusIds.length || corpusIds.includes(shard.corpus_id)),
    ),
    [corpusIds, data.search.shards, languageIds],
  );
  const unitShards = useMemo(
    () => shards.filter((shard) => {
      if (!shard.unit_counts || recordUnit === "sentence") return true;
      return shard.unit_counts[unitCountKey(recordUnit)] > 0;
    }),
    [recordUnit, shards],
  );
  const indexes = useMemo(
    () => data.search.indexes.filter(
      (index) => languageIds.includes(index.language_id) && (!corpusIds.length || corpusIds.includes(index.corpus_id)),
    ),
    [corpusIds, data.search.indexes, languageIds],
  );
  const estimate = useMemo(() => estimateScope(unitShards), [unitShards]);
  const exactUnitRows = useMemo(() => {
    if (!unitShards.length || unitShards.some((shard) => !shard.unit_counts)) return null;
    const key = unitCountKey(recordUnit);
    return unitShards.reduce((total, shard) => total + (shard.unit_counts?.[key] ?? 0), 0);
  }, [recordUnit, unitShards]);
  const selectedCorpora = corpusIds.length
    ? data.corpora.filter((corpus) => corpusIds.includes(corpus.id))
    : corpora;
  const rightsById = new Map(data.rights.entries.map((entry) => [entry.id, entry]));
  const blockedRights = selectedCorpora
    .map((corpus) => rightsById.get(corpus.rights_id))
    .filter((entry) => entry && entry.redistribution !== "allowed");
  const overMemoryBudget = estimate.uncompressedBytes > 1024 ** 3;
  const selectedSourceRows = matchingSourceRows ?? estimate.records;
  const estimatedProjectedRows = !dialects.length &&
      !requirements.length && !query.trim() && exactUnitRows !== null
    ? exactUnitRows
    : Math.round(selectedSourceRows * projectionRatio);
  const expectedRows = maxRows === null
    ? estimatedProjectedRows
    : Math.min(maxRows, estimatedProjectedRows);
  const estimatedOutputBytes = useMemo(() => {
    if (!preview.length || !expectedRows || !fields.length) return 0;
    const sampleBytes = new TextEncoder().encode(
      JSON.stringify(preview.map((record) => fields.map((field) => datasetFieldValue(record, field)))),
    ).byteLength;
    return Math.round((sampleBytes / preview.length) * expectedRows);
  }, [expectedRows, fields, preview]);

  const previewSelection = useCallback(async (signal: AbortSignal) => {
    const sampleLimit = Math.min(500, estimate.records);
    const result = query.trim()
      ? await searchRecords(
          unitShards,
          query.trim(),
          mode,
          signal,
          sampleLimit,
          indexes,
          "",
          "sentence",
          (record) => recordHasUnit(record, recordUnit),
        )
      : null;
    const sourceRecords = result?.records ?? await loadPreviewRecords(
      unitShards,
      signal,
      sampleLimit,
      (record) => recordHasUnit(record, recordUnit),
    );
    const filtered = sourceRecords.filter((record) => recordMeetsFilters(record, dialects, requirements));
    const baseRows = result?.matches ?? estimate.records;
    const filterRatio = sourceRecords.length ? filtered.length / sourceRecords.length : 0;
    const filteredRows = dialects.length || requirements.length
      ? Math.round(baseRows * filterRatio)
      : baseRows;
    const projected = projectRecordUnits(filtered, recordUnit);
    setMatchingSourceRows(filteredRows);
    setProjectionRatio(filtered.length ? projected.length / filtered.length : 0);
    setPreview(projected.slice(0, 12));
  }, [dialects, estimate.records, indexes, mode, query, recordUnit, requirements, unitShards]);

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
          await previewSelection(next.signal);
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
  }, [languageId, previewSelection, query]);

  async function recordsForExport(signal: AbortSignal): Promise<SearchRecord[]> {
    const sourceLimit = estimate.records;
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
        await searchRecords(
          unitShards,
          query.trim(),
          mode,
          signal,
          sourceLimit,
          indexes,
          "",
          "sentence",
          (record) => recordHasUnit(record, recordUnit),
        )
      ).records;
    } else {
      sourceRecords = await loadPreviewRecords(
        unitShards,
        signal,
        sourceLimit,
        (record) => recordHasUnit(record, recordUnit),
      );
    }
    const filtered = sourceRecords.filter((record) => recordMeetsFilters(record, dialects, requirements));
    const projected = projectRecordUnits(filtered, recordUnit);
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
      await previewSelection(next.signal);
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
          languageIds,
          corpusIds,
          dialects,
          requirements,
          maxRows,
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
                  setAdditionalLanguageIds([]);
                  setCorpusId("");
                  setAdditionalCorpusIds([]);
                  setDialects([]);
                  setPreview([]);
                  setMatchingSourceRows(null);
                  setProjectionRatio(1);
                  setPreviewBusy(Boolean(value));
                }}
              >
                <option value="">{tx("Choose a display language…", "選擇顯示語言…")}</option>
                {data.languages.map((language) => (
                  <option value={language.id} key={language.id}>
                    {languageName(language)}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              {tx("Corpus", "語料庫")}
              <select
                value={corpusId}
                disabled={!languageId}
                onChange={(event) => {
                  setCorpusId(event.target.value);
                  setAdditionalCorpusIds([]);
                }}
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
              {tx("Query", "查詢")}
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
          <details className="builder__scope-details">
            <summary>{tx("Combine languages and corpora", "合併語言與語料庫")}</summary>
            <div className="builder__scope-options">
              <fieldset className="field-checks">
                <legend>{tx("Additional languages", "其他語言")}</legend>
                {data.languages.filter((language) => language.id !== languageId).map((language) => (
                  <label key={language.id}>
                    <input
                      type="checkbox"
                      checked={additionalLanguageIds.includes(language.id)}
                      disabled={!languageId}
                      onChange={() => {
                        setAdditionalLanguageIds((current) =>
                          current.includes(language.id)
                            ? current.filter((value) => value !== language.id)
                            : [...current, language.id],
                        );
                        setCorpusId("");
                        setAdditionalCorpusIds([]);
                        setDialects([]);
                      }}
                    />
                    <span>{languageName(language)}</span>
                  </label>
                ))}
              </fieldset>
              <fieldset className="field-checks">
                <legend>{tx("Additional corpora", "其他語料庫")}</legend>
                {!corpusId && <small>{tx("Choose a primary corpus first. Leaving it at all already includes every compatible corpus.", "請先選擇主要語料庫。保留為全部時已包含所有相容語料庫。")}</small>}
                {corpora.filter((corpus) => corpus.id !== corpusId).map((corpus) => (
                  <label key={corpus.id}>
                    <input
                      type="checkbox"
                      checked={additionalCorpusIds.includes(corpus.id)}
                      disabled={!corpusId}
                      onChange={() => setAdditionalCorpusIds((current) =>
                        current.includes(corpus.id)
                          ? current.filter((value) => value !== corpus.id)
                          : [...current, corpus.id]
                      )}
                    />
                    <span>{corpus.name}</span>
                  </label>
                ))}
              </fieldset>
            </div>
          </details>
          {languageId && <div className="builder__filters">
            <fieldset className="field-checks">
              <legend>{tx("Dialect filter", "方言篩選")}</legend>
              {availableDialects.map((value) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={dialects.includes(value)}
                    onChange={() => setDialects((current) =>
                      current.includes(value)
                        ? current.filter((item) => item !== value)
                        : [...current, value]
                    )}
                  />
                  <span>{value}</span>
                </label>
              ))}
            </fieldset>
            <fieldset className="field-checks">
              <legend>{tx("Require tiers", "必須包含的層級")}</legend>
              {TIER_REQUIREMENTS.map(([value, label]) => (
                <label key={value}>
                  <input
                    type="checkbox"
                    checked={requirements.includes(value)}
                    onChange={() => setRequirements((current) =>
                      current.includes(value)
                        ? current.filter((item) => item !== value)
                        : [...current, value]
                    )}
                  />
                  <span>{tierLabels[value] ?? label}</span>
                </label>
              ))}
            </fieldset>
          </div>}
          <div className="builder__field-heading">
            <h2>{tx("Columns", "欄位")}</h2>
            <div
              className="builder__field-actions"
              role="group"
              aria-label={tx("Column presets", "欄位預設")}
            >
              <button
                className="text-button"
                aria-pressed={
                  fields.length === ESSENTIAL_DATASET_FIELDS.length &&
                  fields.every((field) => ESSENTIAL_DATASET_FIELDS.includes(field))
                }
                onClick={() => setFields(ESSENTIAL_DATASET_FIELDS)}
              >
                {tx("Essential", "基本欄位")}
              </button>
              <button
                className="text-button"
                aria-pressed={fields.length === DATASET_FIELDS.length}
                onClick={() => setFields([...DATASET_FIELDS])}
              >
                {tx("Select all", "全選")}
              </button>
              <button
                className="text-button"
                aria-pressed={fields.length === 0}
                onClick={() => setFields([])}
              >
                {tx("Clear", "清除")}
              </button>
            </div>
          </div>
          <fieldset className="dataset-fields">
            <legend className="sr-only">{tx("Included fields", "包含欄位")}</legend>
            {DATASET_FIELD_INFO.map(([field, description, descriptionZh]) => (
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
                <span><code>{field}</code><small>{tx(description, descriptionZh)}</small></span>
              </label>
            ))}
          </fieldset>
          <h2 className="builder__file-title">{tx("File", "檔案")}</h2>
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
              <dt>{tx("Languages", "語言")}</dt>
              <dd>{number(languageIds.length)}</dd>
            </div>
            <div>
              <dt>{tx("Corpora", "語料庫")}</dt>
              <dd>{number(languageIds.length ? corpusIds.length || corpora.length : 0)}</dd>
            </div>
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
          {(dialects.length > 0 || requirements.length > 0) && (
            <div className="builder__active-filters">
              {dialects.map((value) => <span key={`dialect-${value}`}>{tx("dialect", "方言")}: {dialectName(value)}</span>)}
              {requirements.map((value) => <span key={`tier-${value}`}>{tx("has", "包含")}: {tierLabels[value]}</span>)}
            </div>
          )}
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
          <details className="builder__rights">
            <summary>{tx("Rights and provenance", "權利與來源")}</summary>
            <ul>
              {selectedCorpora.map((corpus) => {
                const rights = rightsById.get(corpus.rights_id);
                return (
                  <li key={corpus.id}>
                    <Link to={`/corpora/${corpus.id}`}>{corpus.name}</Link>
                    <span>{rights?.redistribution ?? tx("unknown", "未知")} · {corpus.rights_id}</span>
                  </li>
                );
              })}
            </ul>
            <small>{tx("Every export is pinned to release", "每份匯出皆固定於版本")} <code>{data.meta.release_id}</code>.</small>
          </details>
          <Link to="/downloads">{tx("Browse prepared packages →", "瀏覽預備套件 →")}</Link>
        </aside>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      <DatasetPreview
        fields={fields}
        languageSelected={Boolean(languageId)}
        preview={preview}
        previewBusy={previewBusy}
        recordUnit={recordUnit}
      />
    </section>
  );
}
