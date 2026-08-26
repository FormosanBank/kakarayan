import {useCallback, useEffect, useMemo, useRef, useState} from "react";

import {
  datasetPreview,
  datasetUrl,
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
import {createDatasetRecipe, type DatasetFormat} from "../datasetRecipe";
import {useI18n} from "../i18n";
import {Link, useSearchParams} from "../routing";
import {translationLanguageName} from "../translationLanguages";
import type {AppData, MatchMode, SearchDirection} from "../types";
import {DatasetPreview} from "./DatasetPreview";

interface PreviewState {
  signature: string;
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
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
}

function initialFields(): DatasetFieldsByLevel {
  return {
    sentence: [...DEFAULT_DATASET_FIELDS.sentence],
    word: [...DEFAULT_DATASET_FIELDS.word],
    morpheme: [...DEFAULT_DATASET_FIELDS.morpheme],
  };
}

export function DatasetBuilder({data}: {data: AppData}) {
  const {languageName, locale, number, tx} = useI18n();
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
  const [levels, setLevels] = useState<DatasetLevel[]>(["sentence"]);
  const [activeColumnLevel, setActiveColumnLevel] = useState<DatasetLevel>("sentence");
  const [fields, setFields] = useState<DatasetFieldsByLevel>(initialFields);
  const [maxRows, setMaxRows] = useState(1000);
  const [format, setFormat] = useState<DatasetFormat>("csv");
  const [previewState, setPreviewState] = useState<PreviewState>({
    signature: "",
    values: {},
    pending: [],
    errors: {},
  });
  const [error, setError] = useState("");
  const [previewAttempt, setPreviewAttempt] = useState(0);
  const previewController = useRef<AbortController | null>(null);
  const previewSnapshot = useRef(previewState);
  const retryLevels = useRef<DatasetLevel[] | null>(null);

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
  ]);
  const canPreview = Boolean(
    languageId && selectionReady && translationSearchReady && data.query.available,
  );
  const previewIsCurrent = previewState.signature === previewSignature;
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
    includeFormat = false,
  ): URLSearchParams => {
    const values = new URLSearchParams({
      language_id: languageId,
      max_rows: String(limit),
      record_level: level,
      complete_fields: "true",
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
    if (includeFormat) values.set("format", format);
    return values;
  }, [corpusId, dialect, direction, format, languageId, match, query, translationLanguage]);

  useEffect(() => {
    if (!languageId || !data.query.available) return;
    const controller = new AbortController();
    translationLanguages(data.meta.release_id, languageId, corpusId, controller.signal).then(
      (options) => {
        if (controller.signal.aborted) return;
        setError("");
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
        setError(cause instanceof Error ? cause.message : String(cause));
        setTranslationOptions([]);
        setDirection("formosan");
      },
    );
    return () => controller.abort();
  }, [corpusId, data.meta.release_id, data.query.available, languageId, locale]);

  useEffect(() => {
    previewSnapshot.current = previewState;
  }, [previewState]);

  useEffect(() => {
    if (!canPreview) {
      return;
    }
    previewController.current?.abort();
    const next = new AbortController();
    previewController.current = next;
    const timer = window.setTimeout(() => {
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
        values: preserveCompleted ? snapshot.values : {},
        pending: requestedLevels,
        errors: retainedErrors,
      });
      const loadPreviews = async () => {
        for (const level of requestedLevels) {
          try {
            const result = await datasetPreview(
              data.meta.release_id,
              parameters(level, fields[level], 12),
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
      };
      void loadPreviews();
    }, 250);
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
    previewAttempt,
    previewSignature,
    tx,
  ]);

  function cancelPreview() {
    previewController.current?.abort();
    setPreviewState((current) => current.signature === previewSignature
      ? {...current, pending: []}
      : current);
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

  function exportDataset() {
    if (!languageId || !selectionReady || !translationSearchReady || exportBlocked) return;
    setError("");
    let route: "export" | "export-package" = "export";
    let values: URLSearchParams;
    let filename: string;
    if (levels.length === 1) {
      const level = levels[0];
      if (!level) return;
      values = parameters(level, fields[level], maxRows, true);
      filename = `kakarayan-${data.meta.release_id}-${level}s.${format}`;
    } else {
      route = "export-package";
      const firstLevel = levels.at(0);
      if (!firstLevel) return;
      values = parameters(firstLevel, [], maxRows, true);
      values.delete("record_level");
      values.delete("field");
      for (const level of levels) {
        values.append("record_level", level);
        for (const field of fields[level]) values.append(`${level}_field`, field);
      }
      filename = `kakarayan-${data.meta.release_id}-xml-levels.zip`;
    }
    startDownload(datasetUrl(data.meta.release_id, route, values), filename);
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
      recordLevels: levels,
      maxRows,
      fields,
      format,
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
    (total, level) => total + Math.min(previews[level]?.estimated_rows ?? 0, maxRows),
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
              "Rows include every selected field. TRANSL values expand into language-specific columns.",
              "每列包含所有選定欄位；TRANSL 值會展開為各語言專屬欄位。",
            )}</p>
          </div>
          {levels.length > 0 && (
            <>
              <div className="builder__column-tabs" role="tablist" aria-label={tx("Columns by XML level", "依 XML 層級顯示欄位")}>
                {levels.map((level) => {
                  const info = DATASET_LEVEL_INFO.find(([value]) => value === level) ?? DATASET_LEVEL_INFO[0];
                  return (
                    <button
                      aria-selected={columnLevel === level}
                      key={level}
                      onClick={() => setActiveColumnLevel(level)}
                      role="tab"
                      type="button"
                    >
                      <code>{info[1]}</code> {tx(info[2], info[3])}
                      <span>{fields[level].length}</span>
                    </button>
                  );
                })}
              </div>
              <section className="builder__level-columns">
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
            <div><dt>{tx("Rows downloaded", "下載列數")}</dt><dd>{languageId ? (previewComplete ? number(exportRows) : (previewBusy ? "…" : (Object.keys(previewErrors).length > 0 ? tx("Incomplete", "未完成") : "—"))) : "—"}</dd></div>
          </dl>
          <label className="field">{tx("Maximum per level", "每層級上限")}<select value={maxRows} onChange={(event) => setMaxRows(Number(event.target.value))}>{[1000, 10_000, 25_000, 50_000, 100_000].map((value) => <option key={value} value={value}>{number(value)}</option>)}</select></label>
          <label className="field">{tx("File type", "檔案類型")}<select value={format} onChange={(event) => setFormat(event.target.value as DatasetFormat)}><option value="csv">CSV</option><option value="tsv">TSV</option><option value="jsonl">JSON Lines</option></select></label>
          {levels.length > 1 && <p className="builder__package-note">{tx(`${levels.length} tables in one ZIP`, `${levels.length} 個資料表合併為一個 ZIP`)}</p>}
          <button
            aria-busy={previewBusy}
            className="button button--primary"
            disabled={!languageId || !selectionReady || exportBlocked || !data.query.available || previewBusy || !previewComplete}
            onClick={exportDataset}
          >
            {previewBusy ? tx("Calculating…", "計算中…") : tx("Download dataset", "下載資料集")}
          </button>
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
