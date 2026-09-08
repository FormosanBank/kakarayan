import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {
  datasetPreview,
  datasetUrl,
  preflightExport,
  translationLanguages,
  type DatasetPreviewResult,
} from "../apiClient";
import {apiErrorMessage} from "../apiErrors";
import {
  DATASET_FIELD_INFO,
  DATASET_FIELDS_BY_LEVEL,
  DATASET_LEVEL_INFO,
  DEFAULT_DATASET_FIELDS,
  type DatasetField,
  type DatasetFieldsByLevel,
  type DatasetLevel,
} from "../datasetSelection";
import {createDatasetRecipe, datasetScopeFromUrl, datasetScopeToUrl, type DatasetFormat} from "../datasetRecipe";
import {useI18n} from "../i18n";
import {Link, useSearchParams} from "../routing";
import {translationLanguageName} from "../translationLanguages";
import type {AppData, MatchMode, SearchDirection} from "../types";
import {DatasetPreview} from "./DatasetPreview";
import {Tabs} from "./Tabs";

interface PreviewState {
  signature: string;
  status: "idle" | "loading" | "ready" | "error" | "cancelled";
  values: Partial<Record<DatasetLevel, DatasetPreviewResult>>;
  pending: DatasetLevel[];
  errors: Partial<Record<DatasetLevel, string>>;
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

function startDownload(url: string, filename: string) {
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.rel = "noopener";
  // A late server error must not navigate away from the user's selection.
  anchor.target = "kakarayan-export";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

export function DatasetBuilder({data, active = true}: {data: AppData; active?: boolean}) {
  const {languageName, locale, number, tx} = useI18n();
  const [urlParams, setUrlParams] = useSearchParams();
  const urlScope = useMemo(() => datasetScopeFromUrl(urlParams, data), [urlParams, data]);
  const acceptedScope = useRef(datasetScopeToUrl(urlScope).toString());
  const currentView = useRef(urlParams.get("view") ?? "builder");
  const [languageId, setLanguageId] = useState(urlScope.languageId);
  const [corpusId, setCorpusId] = useState(urlScope.corpusId);
  const [dialect, setDialect] = useState(urlScope.dialect);
  const [query, setQuery] = useState(urlScope.query);
  const [direction, setDirection] = useState<SearchDirection>(urlScope.direction);
  const [translationLanguage, setTranslationLanguage] = useState(urlScope.translationLanguage);
  const [translationOptions, setTranslationOptions] = useState<
    Array<{xml_lang: string; records: number}>
  >([]);
  const [match, setMatch] = useState<MatchMode>(urlScope.match);
  const [levels, setLevels] = useState<DatasetLevel[]>(urlScope.recordLevels);
  const [activeColumnLevel, setActiveColumnLevel] = useState<DatasetLevel>("sentence");
  const [fields, setFields] = useState<DatasetFieldsByLevel>(urlScope.fields);
  const [maxRows, setMaxRows] = useState(urlScope.maxRows);
  const [format, setFormat] = useState<DatasetFormat>(urlScope.format);
  const [completeFields, setCompleteFields] = useState(urlScope.completeFields);
  const [previewState, setPreviewState] = useState<PreviewState>({
    signature: "",
    status: "idle",
    values: {},
    pending: [],
    errors: {},
  });
  const [error, setError] = useState("");
  const [exportAttempt, setExportAttempt] = useState<{signature: string; status: "idle" | "checking" | "started"}>({signature: "", status: "idle"});
  const exportController = useRef<AbortController | null>(null);
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const previewController = useRef<AbortController | null>(null);
  const previewTimer = useRef<number | null>(null);
  const previewSnapshot = useRef(previewState);
  const retryLevels = useRef<DatasetLevel[] | null>(null);
  const [facetError, setFacetError] = useState("");
  const [facetAttempt, setFacetAttempt] = useState(0);
  useEffect(() => {
    currentView.current = urlParams.get("view") ?? "builder";
    const key = datasetScopeToUrl(urlScope).toString();
    if (acceptedScope.current === key) return;
    acceptedScope.current = key;
    setLanguageId(urlScope.languageId); setCorpusId(urlScope.corpusId); setDialect(urlScope.dialect);
    setQuery(urlScope.query); setDirection(urlScope.direction); setTranslationLanguage(urlScope.translationLanguage);
    setMatch(urlScope.match); setLevels(urlScope.recordLevels); setFields(urlScope.fields);
    setMaxRows(urlScope.maxRows); setFormat(urlScope.format); setCompleteFields(urlScope.completeFields);
  }, [urlScope, urlParams]);
  const scope = useMemo(() => ({releaseId: data.meta.release_id, languageId, corpusId, dialect, query,
    direction, translationLanguage, match, recordLevels: levels, fields, maxRows, format, completeFields}),
  [data.meta.release_id, languageId, corpusId, dialect, query, direction, translationLanguage, match, levels, fields, maxRows, format, completeFields]);
  // URL persistence is independent of preview requests, including format-only changes.
  const pendingScope = useRef(scope);
  useEffect(() => { pendingScope.current = scope; }, [scope]);
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const value = pendingScope.current;
      acceptedScope.current = datasetScopeToUrl(value).toString();
      setUrlParams(datasetScopeToUrl(value, currentView.current));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [scope, setUrlParams]);

  const corpora = useMemo(
    () => data.corpora.filter((corpus) => !languageId || corpus.languages.includes(languageId)),
    [data.corpora, languageId],
  );
  const selectedLanguage = data.languages.find((item) => item.id === languageId);
  const selectedTranslationLanguage = translationLanguageName(translationLanguage, locale);
  const translationSearchReady = direction === "formosan" || translationOptions.some(
    (option) => option.xml_lang === translationLanguage,
  );
  const queryLabel = !languageId
    ? tx("Word or phrase", "單詞或片語")
    : direction === "formosan"
      ? tx(
          `${selectedLanguage ? languageName(selectedLanguage) : "Formosan"} word or phrase`,
          `${selectedLanguage ? languageName(selectedLanguage) : "臺灣南島語"}單詞或片語`,
        )
      : tx(
          `${selectedTranslationLanguage} word or phrase`,
          `${selectedTranslationLanguage}單詞或片語`,
        );
  const rights = new Map(data.rights.entries.map((entry) => [entry.id, entry]));
  const selectedCorpora = corpusId
    ? corpora.filter((corpus) => corpus.id === corpusId)
    : corpora;
  const exportBlocked = selectedCorpora.some(
    (corpus) => rights.get(corpus.rights_id)?.redistribution !== "allowed",
  );
  const selectionReady = levels.length > 0 && levels.every((level) => fields[level].length > 0);
  const columnLevel = levels.includes(activeColumnLevel)
    ? activeColumnLevel
    : (levels[0] ?? "sentence");
  const columnInfo = DATASET_LEVEL_INFO.find(([value]) => value === columnLevel)
    ?? DATASET_LEVEL_INFO[0];
  const previewSignature = useMemo(() => JSON.stringify({
    releaseId: data.meta.release_id,
    languageId,
    corpusId,
    dialect,
    query: query.trim(),
    direction,
    translationLanguage: direction === "translation" ? translationLanguage : "",
    match,
    levels: levels.map((level) => [level, fields[level]]),
    maxRows,
    completeFields,
  }), [
    corpusId,
    data.meta.release_id,
    dialect,
    direction,
    fields,
    languageId,
    levels,
    match,
    query,
    translationLanguage,
    maxRows,
    completeFields,
  ]);
  const canPreview = Boolean(
    active && languageId && selectionReady && translationSearchReady && !facetError && data.query.available,
  );
  const previewIsCurrent = previewState.signature === previewSignature;
  const exportSignature = `${previewSignature}|${format}`;
  const exportState = active && exportAttempt.signature === exportSignature ? exportAttempt.status : "idle";
  const previews = previewIsCurrent ? previewState.values : {};
  const previewLoadingLevels = canPreview
    ? (previewIsCurrent ? previewState.pending : levels)
    : [];
  const previewBusy = previewLoadingLevels.length > 0;
  const previewErrors = previewIsCurrent ? previewState.errors : {};

  const parameters = useCallback((
    level: DatasetLevel,
    selectedFields: DatasetField[],
    limit: number,
  ): URLSearchParams => {
    const values = new URLSearchParams({
      language_id: languageId,
      max_rows: String(limit),
      record_level: level,
      complete_fields: String(completeFields),
    });
    if (corpusId) values.set("corpus_id", corpusId);
    if (dialect) values.set("dialect", dialect);
    if (query.trim()) values.set("q", query.trim());
    values.set("direction", direction);
    if (direction === "translation" && translationLanguage) {
      values.set("translation_language", translationLanguage);
    }
    values.set("match", match);
    for (const field of selectedFields) values.append("field", field);
    return values;
  }, [corpusId, dialect, direction, completeFields, languageId, match, query, translationLanguage]);

  useEffect(() => {
    if (!languageId || !data.query.available) return;
    const controller = new AbortController();
    translationLanguages(data.meta.release_id, languageId, corpusId, controller.signal).then(
      (options) => {
        if (controller.signal.aborted) return;
        setError("");
        setFacetError("");
        setTranslationOptions(options);
        setTranslationLanguage((current) => {
          if (options.some((option) => option.xml_lang === current)) return current;
          const preferred = locale === "zh-Hant" ? "zho" : "eng";
          return options.some((option) => option.xml_lang === preferred)
            ? preferred
            : (options[0]?.xml_lang ?? "");
        });
        if (options.length === 0) {
          setDirection((current) => current === "translation" ? "formosan" : current);
        }
      },
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setFacetError(apiErrorMessage(cause, tx));
      },
    );
    return () => controller.abort();
  }, [corpusId, data.meta.release_id, data.query.available, languageId, locale, facetAttempt, tx]);

  useEffect(() => {
    previewSnapshot.current = previewState;
  }, [previewState]);

  useEffect(() => {
    previewController.current?.abort();
    if (!canPreview) return;
    if (previewSnapshot.current.signature === previewSignature && previewSnapshot.current.status === "ready" && !retryLevels.current) return;
    const next = new AbortController();
    previewController.current = next;
    const timer = window.setTimeout(() => {
      if (next.signal.aborted) return;
      const requestedRetry = retryLevels.current;
      retryLevels.current = null;
      const snapshot = previewSnapshot.current;
      const preserveCompleted = requestedRetry !== null && snapshot.signature === previewSignature;
      const requestedLevels = preserveCompleted
        ? requestedRetry.filter((level) => levels.includes(level))
        : [...levels];
      const retainedErrors = preserveCompleted ? {...snapshot.errors} : {};
      for (const level of requestedLevels) delete retainedErrors[level];
      setPreviewState({
        signature: previewSignature,
        status: "loading",
        values: preserveCompleted ? snapshot.values : {},
        pending: requestedLevels,
        errors: retainedErrors,
      });
      const loadPreviews = async () => {
        for (const level of requestedLevels) {
          try {
            const values = parameters(level, fields[level], Math.min(12, maxRows));
            values.set("selection_rows", String(maxRows));
            const result = await datasetPreview(
              data.meta.release_id,
              values,
              next.signal,
            );
            if (next.signal.aborted) {
              return;
            }
            setPreviewState((current) => current.signature === previewSignature
              ? (() => {
                  const errors = {...current.errors};
                  delete errors[level];
                  return {
                    ...current,
                    values: {...current.values, [level]: result},
                    pending: current.pending.filter((item) => item !== level),
                    errors,
                  };
                })()
              : current);
          } catch (cause) {
            if (next.signal.aborted) return;
            const message = apiErrorMessage(cause, tx);
            setPreviewState((current) => current.signature === previewSignature
              ? {
                  ...current,
                  pending: current.pending.filter((item) => item !== level),
                  errors: {...current.errors, [level]: message},
                }
              : current);
          }
        }
        if (!next.signal.aborted) setPreviewState((current) => current.signature === previewSignature
          ? {...current, status: Object.keys(current.errors).length ? "error" : "ready"} : current);
      };
      void loadPreviews();
    }, 250);
    previewTimer.current = timer;
    return () => {
      window.clearTimeout(timer);
      next.abort();
    };
  }, [
    canPreview,
    data.meta.release_id,
    fields,
    levels,
    parameters,
    maxRows,
    previewAttempt,
    previewSignature,
    tx,
  ]);

  function cancelPreview() {
    if (previewTimer.current !== null) window.clearTimeout(previewTimer.current);
    previewController.current?.abort();
    setPreviewState((current) => ({signature: previewSignature, status: "cancelled", pending: [],
      values: current.signature === previewSignature ? current.values : {}, errors: {}}));
  }

  function retryPreview(level?: DatasetLevel) {
    const requested = level
      ? [level]
      : levels.filter((item) => !previews[item] || previewErrors[item]);
    retryLevels.current = requested.length > 0 ? requested : [...levels];
    setPreviewAttempt((value) => value + 1);
  }

  function toggleLevel(level: DatasetLevel) {
    if (!levels.includes(level)) setActiveColumnLevel(level);
    setLevels((current) =>
      current.includes(level)
        ? current.filter((item) => item !== level)
        : DATASET_LEVEL_INFO.map(([value]) => value).filter(
            (value) => value === level || current.includes(value),
          ),
    );
  }

  function setLevelFields(level: DatasetLevel, next: DatasetField[]) {
    setFields((current) => ({...current, [level]: next}));
  }

  function toggleField(level: DatasetLevel, field: DatasetField) {
    setLevelFields(
      level,
      fields[level].includes(field)
        ? fields[level].filter((item) => item !== field)
        : DATASET_FIELDS_BY_LEVEL[level].filter(
            (item) => item === field || fields[level].includes(item),
          ),
    );
  }

  async function exportDataset() {
    if (!languageId || !selectionReady || !translationSearchReady || exportBlocked) return;
    setError("");
    let route: "export" | "export-package" = "export";
    let values: URLSearchParams;
    let filename: string;
    if (levels.length === 1) {
      const level = levels[0];
      if (!level) return;
      values = parameters(level, fields[level], maxRows);
      values.set("format", format);
      filename = `kakarayan-${data.meta.release_id}-${level}s.${format}`;
    } else {
      route = "export-package";
      const firstLevel = levels.at(0);
      if (!firstLevel) return;
      values = parameters(firstLevel, [], maxRows);
      values.set("format", format);
      values.delete("record_level");
      values.delete("field");
      for (const level of levels) {
        values.append("record_level", level);
        for (const field of fields[level]) values.append(`${level}_field`, field);
      }
      filename = `kakarayan-${data.meta.release_id}-xml-levels.zip`;
    }
    const controller = new AbortController();
    exportController.current?.abort();
    exportController.current = controller;
    setExportAttempt({signature: exportSignature, status: "checking"});
    try {
      await preflightExport(data.meta.release_id, route, values, controller.signal);
      if (controller.signal.aborted) return;
      startDownload(datasetUrl(data.meta.release_id, route, values), filename);
      setExportAttempt({signature: exportSignature, status: "started"});
    } catch (cause) {
      if (controller.signal.aborted) return;
      setExportAttempt({signature: exportSignature, status: "idle"});
      setError(apiErrorMessage(cause, tx));
    }
  }

  useEffect(() => () => exportController.current?.abort(), []);
  useEffect(() => {
    exportController.current?.abort();
  }, [previewSignature, active, format]);

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
      recordLevels: levels,
      maxRows,
      fields,
      format,
      completeFields,
    });
    downloadBlob(
      new Blob([`${JSON.stringify(recipe, null, 2)}\n`], {type: "application/json"}),
      `kakarayan-${data.meta.release_id}.recipe.json`,
    );
  }

  const estimatedRows = levels.reduce(
    (total, level) => total + (previews[level]?.estimated_rows ?? 0),
    0,
  );
  const exportRows = levels.reduce(
    (total, level) => total + (previews[level]?.selected_rows ?? 0),
    0,
  );
  const previewComplete = levels.length > 0 && levels.every((level) => previews[level]);

  return (
    <section className="builder">
      <div className="builder__grid">
        <div className="builder__controls">
          <h2>{tx("Build a dataset", "建立資料集")}</h2>
          <div className="form-grid">
            <label className="field">{tx("Formosan language", "臺灣南島語")}<select value={languageId} onChange={(event) => { setLanguageId(event.target.value); setCorpusId(""); setDialect(""); setTranslationOptions([]); }}><option value="">{tx("Choose…", "請選擇…")}</option>{data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}</select></label>
            <label className="field">{tx("Corpus", "語料庫")}<select value={corpusId} disabled={!languageId} onChange={(event) => { setCorpusId(event.target.value); setTranslationOptions([]); }}><option value="">{tx("All compatible corpora", "所有相容語料庫")}</option>{corpora.map((corpus) => <option key={corpus.id} value={corpus.id}>{corpus.name}</option>)}</select></label>
            <label className="field">{tx("Dialect", "方言")}<select value={dialect} disabled={!languageId} onChange={(event) => setDialect(event.target.value)}><option value="">{tx("All dialects", "所有方言")}</option>{selectedLanguage?.dialects.map((value) => <option key={value} value={value}>{value}</option>)}</select></label>
            <fieldset className="search-intent builder__search-intent" disabled={!languageId}>
              <legend>{tx("Search within", "搜尋範圍")}</legend>
              <div className="search-intent__options">
                <label>
                  <input checked={direction === "formosan"} name="dataset-search-intent" onChange={() => setDirection("formosan")} type="radio" />
                  <span><strong>{tx("Formosan text", "族語文字")}</strong><small>{tx("Original, standardized, and alternate forms", "原始、標準化及替代形式")}</small></span>
                </label>
                <label>
                  <input checked={direction === "translation"} disabled={translationOptions.length === 0} name="dataset-search-intent" onChange={() => setDirection("translation")} type="radio" />
                  <span><strong>{tx("Translations", "翻譯文字")}</strong><small>{tx("English, Chinese, or another language", "中文、英文或其他語言")}</small></span>
                </label>
              </div>
            </fieldset>
            {direction === "translation" && (
              <label className="field">
                {tx("Translation language", "翻譯語言")}
                <select
                  disabled={!languageId || translationOptions.length === 0}
                  value={translationLanguage}
                  onChange={(event) => setTranslationLanguage(event.target.value)}
                >
                  {translationOptions.length === 0 && <option value="">{tx("Loading…", "載入中…")}</option>}
                  {translationLanguage && !translationOptions.some(
                    (option) => option.xml_lang === translationLanguage,
                  ) && <option value={translationLanguage}>{selectedTranslationLanguage}</option>}
                  {translationOptions.map((option) => (
                    <option key={option.xml_lang} value={option.xml_lang}>
                      {translationLanguageName(option.xml_lang, locale)} ({number(option.records)})
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label className="field">{queryLabel}<input value={query} maxLength={2048} onChange={(event) => setQuery(event.target.value)} /></label>
            <label className="field">{tx("Match", "比對方式")}<select value={match} onChange={(event) => setMatch(event.target.value as MatchMode)}><option value="exact">{tx("Exact", "完全相符")}</option><option value="prefix">{tx("Prefix", "前綴")}</option><option value="contains">{tx("Contains", "包含")}</option></select></label>
          </div>

          <details className="builder__search-scope">
            <summary>{tx("Fields searched", "搜尋欄位")}</summary>
            <p>
              {direction === "formosan"
                ? tx(
                    "Original, standardized, and alternate FORM values at the selected S, W, and M levels.",
                    "所選 S、W、M 層級的原始、標準化及替代 FORM 值。",
                  )
                : tx(
                    `${selectedTranslationLanguage} TRANSL values at the selected S, W, and M levels.`,
                    `所選 S、W、M 層級的${selectedTranslationLanguage} TRANSL 值。`,
                  )}
            </p>
          </details>

          <fieldset className="builder__levels">
            <legend>{tx("XML levels", "XML 層級")}</legend>
            <div className="builder__level-options">
              {DATASET_LEVEL_INFO.map(([level, code, label, labelZh, detail, detailZh]) => (
                <label key={level}>
                  <input type="checkbox" checked={levels.includes(level)} onChange={() => toggleLevel(level)} />
                  <code>{code}</code>
                  <span><strong>{tx(label, labelZh)}</strong><small>{tx(detail, detailZh)}</small></span>
                </label>
              ))}
            </div>
          </fieldset>

          <div className="builder__column-heading">
            <h2>{tx("Columns", "欄位")}</h2>
            <p>{tx(
              "TRANSL values expand into language-specific columns.",
              "TRANSL 值會展開為各語言專屬欄位。",
            )}</p>
            <label className="checkbox-row"><input type="checkbox" checked={completeFields} onChange={(event) => setCompleteFields(event.target.checked)} />
              {tx("Require selected tiers on each S / W / M record", "每個 S / W / M 元素須具有選定層級")}</label>
          </div>
          {levels.length > 0 && (
            <>
              <Tabs items={levels.map((level) => { const info = DATASET_LEVEL_INFO.find(([value]) => value === level) ?? DATASET_LEVEL_INFO[0];
                return [level, `${info[1]} ${tx(info[2], info[3])} (${fields[level].length})`]; })}
                value={columnLevel} onChange={setActiveColumnLevel} prefix="columns" panelId="columns-panel"
                className="builder__column-tabs" label={tx("Columns by XML level", "依 XML 層級顯示欄位")} />
              <section className="builder__level-columns" id="columns-panel" role="tabpanel" aria-labelledby={`columns-tab-${columnLevel}`}>
                <header>
                  <h3><code>{columnInfo[1]}</code> {tx(columnInfo[2], columnInfo[3])}</h3>
                  <div className="field-actions">
                    <button type="button" onClick={() => setLevelFields(columnLevel, [...DEFAULT_DATASET_FIELDS[columnLevel]])}>{tx("Defaults", "預設")}</button>
                    <button type="button" onClick={() => setLevelFields(columnLevel, [...DATASET_FIELDS_BY_LEVEL[columnLevel]])}>{tx("All", "全選")}</button>
                    <button type="button" onClick={() => setLevelFields(columnLevel, [])}>{tx("Clear", "清除")}</button>
                  </div>
                </header>
                <div className="dataset-fields" role="group" aria-label={tx(`${columnInfo[1]} columns`, `${columnInfo[1]} 欄位`)}>
                  {DATASET_FIELDS_BY_LEVEL[columnLevel].map((field) => (
                    <label key={field}>
                      <input type="checkbox" checked={fields[columnLevel].includes(field)} onChange={() => toggleField(columnLevel, field)} />
                      <span><code>{field}</code><small>{tx(DATASET_FIELD_INFO[field][0], DATASET_FIELD_INFO[field][1])}</small></span>
                    </label>
                  ))}
                </div>
              </section>
            </>
          )}
        </div>

        <aside className="builder__summary">
          <h2>{tx("Export", "匯出")}</h2>
          <dl>
            {levels.map((level) => {
              const info = DATASET_LEVEL_INFO.find(([value]) => value === level) ?? DATASET_LEVEL_INFO[0];
              const status = previews[level]
                ? number(previews[level].estimated_rows)
                : previewLoadingLevels.includes(level)
                  ? "…"
                  : previewErrors[level]
                    ? tx("Error", "錯誤")
                    : "—";
              return <div key={level}><dt><code>{info[1]}</code> {tx(info[2], info[3])}</dt><dd>{languageId ? status : "—"}</dd></div>;
            })}
            <div><dt>{tx("Matching rows", "相符列數")}</dt><dd>{languageId ? (previewComplete ? number(estimatedRows) : (previewBusy ? "…" : (Object.keys(previewErrors).length > 0 ? tx("Incomplete", "未完成") : "—"))) : "—"}</dd></div>
            <div><dt>{tx("Rows to export", "將匯出的列數")}</dt><dd>{languageId ? (previewComplete ? number(exportRows) : (previewBusy ? "…" : (Object.keys(previewErrors).length > 0 ? tx("Incomplete", "未完成") : "—"))) : "—"}</dd></div>
          </dl>
          <label className="field">{tx("Maximum per level", "每層級上限")}<select value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}>{[1000, 10_000, 25_000, 50_000, 100_000].map((value) => <option key={value} value={value}>{number(value)}</option>)}</select></label>
          <label className="field">{tx("File type", "檔案類型")}<select value={format} onChange={(event) => setFormat(event.target.value as DatasetFormat)}><option value="csv">CSV</option><option value="tsv">TSV</option><option value="jsonl">JSON Lines</option></select></label>
          {levels.length > 1 && <p className="builder__package-note">{tx(`${levels.length} tables in one ZIP`, `${levels.length} 個資料表合併為一個 ZIP`)}</p>}
          <button
            aria-busy={previewBusy || exportState === "checking"}
            className="button button--primary"
            disabled={!languageId || !selectionReady || exportBlocked || !data.query.available || previewBusy || !previewComplete || exportState === "checking"}
            onClick={exportDataset}
          >
            {exportState === "checking" ? tx("Checking…", "檢查中…") : previewBusy ? tx("Calculating…", "計算中…") : tx("Download dataset", "下載資料集")}
          </button>
          {exportState === "started" && <p role="status">{tx("Download started", "已開始下載")}</p>}
          <iframe name="kakarayan-export" title={tx("Dataset download", "資料集下載")} hidden />
          {previewBusy && (
            <button className="text-button" type="button" onClick={cancelPreview}>
              {tx("Cancel preview", "取消預覽")}
            </button>
          )}
          {canPreview && !previewBusy && !previewComplete && (
            <button className="text-button" type="button" onClick={() => retryPreview()}>
              {tx("Retry preview", "重試預覽")}
            </button>
          )}
          <button className="button button--quiet" disabled={!languageId || !selectionReady || !translationSearchReady} onClick={downloadRecipe}>{tx("Download recipe", "下載操作配方")}</button>
          {exportBlocked && <p className="callout callout--warning">{tx("This scope includes data without reviewed redistribution permission.", "此範圍包含尚未審查再散布權限的資料。")}</p>}
          <Link to="/downloads">{tx("Prepared full datasets", "預備完整資料集")}</Link>
        </aside>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      {facetError && <div className="callout callout--error" role="alert">{tx("Translation languages could not be loaded.", "無法載入翻譯語言。")}
        <button onClick={() => setFacetAttempt((value) => value + 1)}>{tx("Retry", "重試")}</button></div>}
      {previewIsCurrent && previewState.status === "cancelled" && <p role="status">{tx("Preview cancelled", "已取消預覽")}</p>}
      <DatasetPreview
        errors={previewErrors}
        fields={fields}
        languageSelected={Boolean(languageId)}
        levels={levels}
        previews={previews}
        loadingLevels={previewLoadingLevels}
        onRetry={retryPreview}
      />
    </section>
  );
}
