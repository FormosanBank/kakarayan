import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";
import {
  matchingIndexes,
  matchingShards,
  searchRecords,
  type SearchMode,
} from "../data";
import {downloadExport, type ExportFormat} from "../exports";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import {cardFromRecord, saveCard} from "../study";
import type {AppData, SearchRecord} from "../types";
import {Diagnostics} from "./Diagnostics";
import {CandidateGroups} from "./CandidateGroups";
import {SearchResultCard} from "./SearchResultCard";

const VALID_MODES: SearchMode[] = [
  "source",
  "exact",
  "prefix",
  "contains",
  "translation",
  "phonology",
  "gloss",
  "fuzzy",
  "regex",
];

export function SearchTool({
  data,
  learner = false,
}: {
  data: AppData;
  learner?: boolean;
}) {
  const {number, t, tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const amis = data.languages.find((language) => language.name === "Amis");
  const initialLanguage = params.get("language") ?? (learner ? (amis?.id ?? "") : "");
  const initialMode = params.get("mode");
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [languageId, setLanguageId] = useState(initialLanguage);
  const [corpusId, setCorpusId] = useState(params.get("corpus") ?? "");
  const [mode, setMode] = useState<SearchMode>(
    VALID_MODES.includes(initialMode as SearchMode) ? (initialMode as SearchMode) : "exact",
  );
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [scanned, setScanned] = useState(0);
  const [matches, setMatches] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const [visibleLimit, setVisibleLimit] = useState(learner ? 60 : 200);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [resultView, setResultView] = useState<"occurrences" | "candidates">("occurrences");
  const [exporting, setExporting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const initialStarted = useRef(false);
  const hasInitialQuery = useRef(Boolean(params.get("q") && initialLanguage));

  const relevantCorpora = useMemo(
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
  const exportBlocked = useMemo(() => {
    const corporaById = new Map(data.corpora.map((corpus) => [corpus.id, corpus]));
    const rightsById = new Map(data.rights.entries.map((entry) => [entry.id, entry]));
    return records.some((record) => {
      const corpus = corporaById.get(record.corpus_id);
      const rights = corpus ? rightsById.get(corpus.rights_id) : undefined;
      return rights?.redistribution !== "allowed";
    });
  }, [data.corpora, data.rights.entries, records]);

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  const performSearch = useCallback(async (limit: number, updateUrl: boolean) => {
    if (!languageId || !query.trim()) return;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setBusy(true);
    setError("");
    setNotice("");
    setSearched(false);
    if (updateUrl) {
      setParams({
        q: query.trim(),
        language: languageId,
        ...(corpusId && {corpus: corpusId}),
        mode,
      });
    }
    try {
      const result = await searchRecords(
        shards,
        query,
        mode,
        nextController.signal,
        limit,
        indexes,
      );
      setRecords(result.records);
      setScanned(result.scanned);
      setMatches(result.matches);
      setTruncated(result.truncated);
      setVisibleLimit(limit);
      setSearched(true);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === nextController) setBusy(false);
    }
  }, [
    corpusId,
    indexes,
    languageId,
    mode,
    query,
    setParams,
    shards,
  ]);

  useEffect(() => {
    if (!hasInitialQuery.current || initialStarted.current) return;
    initialStarted.current = true;
    void performSearch(learner ? 60 : 200, false);
  }, [learner, performSearch]);

  useEffect(() => {
    const recordId = params.get("record");
    if (!searched || !recordId) return;
    document.getElementById(`record-${recordId}`)?.scrollIntoView({block: "center"});
  }, [params, searched, records]);

  function runSearch(event: FormEvent) {
    event.preventDefault();
    void performSearch(learner ? 60 : 200, true);
  }

  async function addToDeck(record: SearchRecord) {
    try {
      await saveCard(cardFromRecord(record, data.meta.release_id));
      setNotice(
        tx(
          `${record.standard || record.original} saved locally.`,
          `已將「${record.standard || record.original}」儲存在本機。`,
        ),
      );
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className={`search-tool ${learner ? "search-tool--learner" : ""}`}>
      <form className="search-form" onSubmit={runSearch}>
        <div className="field field--query">
          <label htmlFor={`query-${learner ? "learn" : "research"}`}>{t("search.query")}</label>
          <input
            id={`query-${learner ? "learn" : "research"}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            placeholder={
              learner
                ? "fangcalay, salikaka…"
                : tx("form, translation, gloss…", "形式、翻譯、詞彙註釋…")
            }
          />
        </div>
        <div className="field">
          <label htmlFor={`language-${learner ? "learn" : "research"}`}>
            {t("search.language")}
          </label>
          <select
            id={`language-${learner ? "learn" : "research"}`}
            value={languageId}
            onChange={(event) => {
              setLanguageId(event.target.value);
              setCorpusId("");
            }}
          >
            {!learner && <option value="">{tx("Choose…", "請選擇…")}</option>}
            {data.languages.map((language) => (
              <option key={language.id} value={language.id}>
                {language.name}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`corpus-${learner ? "learn" : "research"}`}>
            {t("search.corpus")}
          </label>
          <select
            id={`corpus-${learner ? "learn" : "research"}`}
            value={corpusId}
            onChange={(event) => setCorpusId(event.target.value)}
          >
            <option value="">{tx("All available", "全部可用語料庫")}</option>
            {relevantCorpora.map((corpus) => (
              <option key={corpus.id} value={corpus.id}>
                {corpus.name}
              </option>
            ))}
          </select>
        </div>
        <fieldset className="mode-picker">
          <legend>{t("search.mode")}</legend>
          {VALID_MODES.map((value) => (
            <label key={value}>
              <input
                type="radio"
                name={`mode-${learner ? "learn" : "research"}`}
                checked={mode === value}
                onChange={() => setMode(value)}
              />
              <span>{t(`search.${value}`)}</span>
            </label>
          ))}
        </fieldset>
        {(mode === "regex" || mode === "fuzzy") && (
          <p className="tool-note">
            {mode === "regex"
              ? tx(
                  "RE2 provides linear-time Unicode matching. Backreferences and look-around are not supported.",
                  "RE2 提供線性時間的 Unicode 比對，不支援反向參照與前後查找。",
                )
              : tx(
                  "Fuzzy lookup uses Unicode edit distance 1 for short queries and 2 otherwise.",
                  "模糊查詢對短字串使用 Unicode 編輯距離 1，其餘使用距離 2。",
                )}
          </p>
        )}
        <button className="button button--primary" disabled={busy || !languageId || !query.trim()}>
          {busy ? tx("Searching…", "搜尋中…") : t("search.submit")}
        </button>
      </form>

      {!languageId && <p className="tool-note">{t("search.scope")}</p>}
      {languageId && shards.length === 0 && (
        <p className="callout callout--warning">
          {tx(
            "This release has no interactive search shard for the selected scope. Use a prepared download or choose another scope.",
            "此版本沒有符合所選範圍的互動搜尋分片。請使用預先製作的下載檔案，或選擇其他範圍。",
          )}
        </p>
      )}
      {error && (
        <div className="callout callout--error">
          <p>{error}</p>
          <Diagnostics releaseId={data.meta.release_id} error={new Error(error)} />
        </div>
      )}
      {notice && (
        <p className="callout callout--success" role="status">
          {notice}
        </p>
      )}

      {(records.length > 0 || (!busy && searched)) && (
        <div className="results-heading" aria-live="polite">
          <p>
            <strong>{number(matches)}</strong> {t("search.results")} ·{" "}
            {tx("showing", "顯示")} {number(records.length)} · {tx("checked", "已檢查")}{" "}
            {number(scanned)} {tx("candidate records", "筆候選記錄")}
          </p>
          {records.length > 0 && (
            <div className="result-export">
              <label>
                {tx("Export", "匯出")}
                <select
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                >
                  <option value="csv">CSV</option>
                  <option value="tsv">TSV</option>
                  <option value="json">JSON</option>
                  <option value="jsonl">{tx("JSON Lines", "JSON 行格式")}</option>
                  <option value="parquet">Parquet (DuckDB-Wasm)</option>
                  <option value="plain">{tx("Plain text", "純文字")}</option>
                  <option value="interlinear">{tx("Interlinear text", "逐行對譯文字")}</option>
                  <option value="audio">{tx("Audio references", "音訊參照")}</option>
                  <option value="recipe">{tx("Reproducible recipe", "可重現操作配方")}</option>
                </select>
              </label>
              <button
                className="button button--quiet"
                disabled={exporting || (exportBlocked && exportFormat !== "recipe")}
                onClick={async () => {
                  setExporting(true);
                  setError("");
                  try {
                    await downloadExport(
                      records,
                      {
                        releaseId: data.meta.release_id,
                        query: query.trim(),
                        mode,
                        languageId,
                        corpusId,
                      },
                      exportFormat,
                    );
                  } catch (cause) {
                    setError(cause instanceof Error ? cause.message : String(cause));
                  } finally {
                    setExporting(false);
                  }
                }}
              >
                {exporting ? tx("Preparing…", "準備中…") : tx("Download", "下載")}
              </button>
            </div>
          )}
          {exportBlocked && records.length > 0 && (
            <p className="callout callout--warning">
              {tx(
                "Search-result data export is disabled because one or more source corpora do not have reviewed redistribution permission. A reproducible recipe remains available.",
                "一個或多個來源語料庫尚無經審查的再散布許可，因此停用搜尋結果資料匯出。仍可下載可重現的操作配方。",
              )}
            </p>
          )}
        </div>
      )}

      {!busy && searched && records.length === 0 && (
        <div className="empty-state">{t("search.noResults")}</div>
      )}

      {records.length > 0 && (
        <div className="segmented result-view">
          <button
            aria-pressed={resultView === "occurrences"}
            onClick={() => setResultView("occurrences")}
          >
            {tx("Concordance occurrences", "索引行出現項目")}
          </button>
          <button
            aria-pressed={resultView === "candidates"}
            disabled={!["source", "exact", "prefix", "contains", "fuzzy"].includes(mode)}
            onClick={() => setResultView("candidates")}
          >
            {tx("Headword candidates", "詞目候選")}
          </button>
        </div>
      )}
      {resultView === "candidates" &&
      ["source", "exact", "prefix", "contains", "fuzzy"].includes(mode) ? (
        <CandidateGroups
          data={data}
          records={records}
          query={query}
          mode={mode}
          onSave={addToDeck}
          onOpen={(record) => {
            setResultView("occurrences");
            window.setTimeout(
              () =>
                document
                  .getElementById(`record-${record.id}`)
                  ?.scrollIntoView({block: "center"}),
              0,
            );
          }}
        />
      ) : (
        <div className="result-list">
          {records.map((record) => (
            <SearchResultCard
              data={data}
              key={record.id}
              record={record}
              query={query}
              mode={mode}
              learner={learner}
              onSave={addToDeck}
              onNotice={setNotice}
            />
          ))}
        </div>
      )}
      {truncated && (
        <div className="pagination-actions">
          <p>
            {tx(
              "Results are in deterministic source order. Browser display is capped at 2,000; use Dataset builder for a bounded export.",
              "結果依可重現的來源順序排列。瀏覽器最多顯示 2,000 筆；如需有界限的匯出，請使用資料集產生器。",
            )}
          </p>
          {visibleLimit < 2_000 && (
            <button
              className="button button--quiet"
              disabled={busy}
              onClick={() => void performSearch(Math.min(visibleLimit + 200, 2_000), false)}
            >
              {tx("Show next", "再顯示")} {number(Math.min(200, 2_000 - visibleLimit))}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
