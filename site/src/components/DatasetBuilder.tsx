import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {datasetPreview, datasetUrl, translationLanguages} from "../apiClient";
import {
  DATASET_FIELD_INFO,
  DATASET_FIELDS,
  ESSENTIAL_DATASET_FIELDS,
  TIER_REQUIREMENTS,
  type DatasetField,
} from "../datasetSelection";
import {createDatasetRecipe, type DatasetFormat} from "../datasetRecipe";
import {useI18n} from "../i18n";
import {Link, useSearchParams} from "../routing";
import type {AppData, MatchMode, SearchDirection, TierRequirement} from "../types";
import {DatasetPreview} from "./DatasetPreview";

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function DatasetBuilder({data}: {data: AppData}) {
  const {languageName, number, tx} = useI18n();
  const [urlParams] = useSearchParams();
  const requestedLanguage = urlParams.get("language") ?? "";
  const [languageId, setLanguageId] = useState(
    data.languages.some((item) => item.id === requestedLanguage) ? requestedLanguage : "",
  );
  const [corpusId, setCorpusId] = useState(urlParams.get("corpus") ?? "");
  const [dialect, setDialect] = useState("");
  const [query, setQuery] = useState("");
  const [direction, setDirection] = useState<SearchDirection>("formosan");
  const [translationLanguage, setTranslationLanguage] = useState("");
  const [translationOptions, setTranslationOptions] = useState<
    Array<{xml_lang: string; records: number}>
  >([]);
  const [match, setMatch] = useState<MatchMode>("exact");
  const [requirements, setRequirements] = useState<TierRequirement[]>([]);
  const [fields, setFields] = useState<DatasetField[]>(ESSENTIAL_DATASET_FIELDS);
  const [maxRows, setMaxRows] = useState(1000);
  const [format, setFormat] = useState<DatasetFormat>("csv");
  const [preview, setPreview] = useState<Array<Record<string, string>>>([]);
  const [estimatedRows, setEstimatedRows] = useState(0);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const [error, setError] = useState("");
  const previewController = useRef<AbortController | null>(null);
  const corpora = useMemo(
    () => data.corpora.filter((corpus) => !languageId || corpus.languages.includes(languageId)),
    [data.corpora, languageId],
  );
  const selectedLanguage = data.languages.find((item) => item.id === languageId);
  const rights = new Map(data.rights.entries.map((entry) => [entry.id, entry]));
  const selectedCorpora = corpusId
    ? corpora.filter((corpus) => corpus.id === corpusId)
    : corpora;
  const exportBlocked = selectedCorpora.some(
    (corpus) => rights.get(corpus.rights_id)?.redistribution !== "allowed",
  );

  const parameters = useCallback((limit: number, includeFormat = false): URLSearchParams => {
    const values = new URLSearchParams({language_id: languageId, max_rows: String(limit)});
    if (corpusId) values.set("corpus_id", corpusId);
    if (dialect) values.set("dialect", dialect);
    if (query.trim()) values.set("q", query.trim());
    values.set("direction", direction);
    if (direction === "translation" && translationLanguage) {
      values.set("translation_language", translationLanguage);
    }
    values.set("match", match);
    for (const requirement of requirements) values.append("requirement", requirement);
    for (const field of fields) values.append("field", field);
    if (includeFormat) values.set("format", format);
    return values;
  }, [corpusId, dialect, direction, fields, format, languageId, match, query, requirements, translationLanguage]);

  useEffect(() => {
    if (direction !== "translation" || !languageId || !data.query.available) {
      return;
    }
    const controller = new AbortController();
    translationLanguages(
      data.meta.release_id,
      languageId,
      corpusId,
      controller.signal,
    ).then(
      (options) => {
        setTranslationOptions(options);
        setTranslationLanguage((current) =>
          options.some((option) => option.xml_lang === current)
            ? current
            : (options[0]?.xml_lang ?? ""),
        );
      },
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      },
    );
    return () => controller.abort();
  }, [corpusId, data.meta.release_id, data.query.available, direction, languageId]);

  useEffect(() => {
    if (!languageId || !fields.length || !data.query.available) {
      return;
    }
    previewController.current?.abort();
    const next = new AbortController();
    previewController.current = next;
    const timer = window.setTimeout(() => {
      setPreviewBusy(true);
      setError("");
      datasetPreview(data.meta.release_id, parameters(12), next.signal).then(
        (result) => {
          setPreview(result.items);
          setEstimatedRows(result.estimated_rows);
        },
        (cause: unknown) => {
          if (!next.signal.aborted) setError(cause instanceof Error ? cause.message : String(cause));
        },
      ).finally(() => {
        if (previewController.current === next) setPreviewBusy(false);
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
      next.abort();
    };
  }, [data.meta.release_id, data.query.available, fields.length, languageId, parameters]);

  async function exportDataset() {
    if (!languageId || !fields.length || exportBlocked) return;
    setExportBusy(true);
    setError("");
    try {
      const response = await fetch(
        datasetUrl(data.meta.release_id, "export", parameters(maxRows, true)),
        {headers: {Accept: "*/*", "X-Kakarayan-Client": "web-v1"}},
      );
      if (!response.ok) {
        const body = (await response.json()) as {error?: {message?: string}};
        throw new Error(body.error?.message || `${response.status} ${response.statusText}`);
      }
      downloadBlob(await response.blob(), `kakarayan-${data.meta.release_id}.${format}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setExportBusy(false);
    }
  }

  function downloadRecipe() {
    const recipe = createDatasetRecipe({
      releaseId: data.meta.release_id,
      query,
      match,
      direction,
      translationLanguage: direction === "translation" ? translationLanguage : "",
      languageId,
      corpusId,
      dialect,
      requirements,
      maxRows,
      fields,
      format,
    });
    downloadBlob(
      new Blob([`${JSON.stringify(recipe, null, 2)}\n`], {type: "application/json"}),
      `kakarayan-${data.meta.release_id}.recipe.json`,
    );
  }

  return (
    <section className="builder">
      <div className="builder__grid">
        <div className="builder__controls">
          <h2>{tx("Dataset selection", "資料集選取")}</h2>
          <div className="form-grid">
            <label className="field">{tx("Language", "語言")}<select value={languageId} onChange={(event) => { setLanguageId(event.target.value); setCorpusId(""); setDialect(""); setTranslationLanguage(""); setTranslationOptions([]); setPreview([]); setEstimatedRows(0); }}><option value="">{tx("Choose…", "請選擇…")}</option>{data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}</select></label>
            <label className="field">{tx("Corpus", "語料庫")}<select value={corpusId} disabled={!languageId} onChange={(event) => { setCorpusId(event.target.value); setTranslationLanguage(""); setTranslationOptions([]); }}><option value="">{tx("All compatible corpora", "所有相容語料庫")}</option>{corpora.map((corpus) => <option key={corpus.id} value={corpus.id}>{corpus.name}</option>)}</select></label>
            <label className="field">{tx("Dialect", "方言")}<select value={dialect} disabled={!languageId} onChange={(event) => setDialect(event.target.value)}><option value="">{tx("All dialects", "所有方言")}</option>{selectedLanguage?.dialects.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <label className="field">{tx("Optional word or phrase", "選填單詞或片語")}<input value={query} maxLength={256} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="field">{tx("Search field", "搜尋欄位")}<select value={direction} onChange={(event) => { const next = event.target.value as SearchDirection; setDirection(next); if (next === "formosan") { setTranslationLanguage(""); setTranslationOptions([]); } }}><option value="formosan">{tx("Formosan", "臺灣南島語")}</option><option value="translation">{tx("Translation", "翻譯")}</option></select></label>
            {direction === "translation" && <label className="field">{tx("Translation language", "翻譯語言")}<select value={translationLanguage} disabled={!translationOptions.length} onChange={(event) => setTranslationLanguage(event.target.value)}><option value="">{tx("Any translation language", "任何翻譯語言")}</option>{translationOptions.map((option) => <option key={option.xml_lang} value={option.xml_lang}>{option.xml_lang} · {number(option.records)}</option>)}</select></label>}
            <label className="field">{tx("Match", "比對方式")}<select value={match} onChange={(event) => setMatch(event.target.value as MatchMode)}><option value="exact">{tx("Exact", "完全相符")}</option><option value="prefix">{tx("Prefix", "前綴")}</option><option value="contains">{tx("Contains", "包含")}</option></select></label>
          </div>
          <fieldset className="builder__requirements"><legend>{tx("Required evidence", "必要證據")}</legend>{TIER_REQUIREMENTS.map(([value, label]) => <label key={value}><input type="checkbox" checked={requirements.includes(value)} onChange={() => setRequirements((current) => current.includes(value) ? current.filter((item) => item !== value) : [...current, value])} />{tx(label, label)}</label>)}</fieldset>
          <fieldset className="builder__fields"><legend>{tx("Columns", "欄位")}</legend><div className="field-actions"><button type="button" onClick={() => setFields([...DATASET_FIELDS])}>{tx("Select all", "全選")}</button><button type="button" onClick={() => { setFields([]); setPreview([]); }}>{tx("Clear", "清除")}</button></div><div className="field-check-grid">{DATASET_FIELD_INFO.map(([field, description, descriptionZh]) => <label key={field}><input type="checkbox" checked={fields.includes(field)} onChange={() => setFields((current) => current.includes(field) ? current.filter((item) => item !== field) : [...current, field])} /><span><code>{field}</code><small>{tx(description, descriptionZh)}</small></span></label>)}</div></fieldset>
        </div>
        <aside className="builder__summary">
          <h2>{tx("Export", "匯出")}</h2>
          <dl><div><dt>{tx("Matching rows", "相符列數")}</dt><dd>{languageId ? number(estimatedRows) : "—"}</dd></div><div><dt>{tx("Export limit", "匯出上限")}</dt><dd>{number(Math.min(estimatedRows, maxRows))}</dd></div></dl>
          <label className="field">{tx("Maximum rows", "最大列數")}<select value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}>{[100, 250, 500, 1000].map((value) => <option key={value} value={value}>{number(value)}</option>)}</select></label>
          <label className="field">{tx("File type", "檔案類型")}<select value={format} onChange={(event) => setFormat(event.target.value as DatasetFormat)}><option value="csv">CSV</option><option value="tsv">TSV</option><option value="jsonl">JSON Lines</option></select></label>
          <button className="button button--primary" disabled={!languageId || !fields.length || exportBusy || exportBlocked || !data.query.available} onClick={() => void exportDataset()}>{exportBusy ? tx("Preparing…", "準備中…") : tx("Download dataset", "下載資料集")}</button>
          <button className="button button--quiet" disabled={!languageId || !fields.length} onClick={downloadRecipe}>{tx("Download recipe", "下載操作配方")}</button>
          {exportBlocked && <p className="callout callout--warning">{tx("This scope includes data without reviewed redistribution permission.", "此範圍包含尚未審查再散布權限的資料。")}</p>}
          <Link to="/downloads">{tx("Prepared full datasets", "預備完整資料集")}</Link>
        </aside>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      <DatasetPreview fields={fields} languageSelected={Boolean(languageId)} preview={preview} previewBusy={previewBusy} />
    </section>
  );
}
