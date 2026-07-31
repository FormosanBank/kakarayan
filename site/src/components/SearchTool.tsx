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
  const {t} = useI18n();
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
      setNotice(`${record.standard || record.original} saved locally.`);
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
            placeholder={learner ? "fangcalay, salikaka…" : "form, translation, gloss…"}
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
            {!learner && <option value="">Choose…</option>}
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
            <option value="">All available</option>
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
              ? "RE2 provides linear-time Unicode matching. Backreferences and look-around are not supported."
              : "Fuzzy lookup uses Unicode edit distance 1 for short queries and 2 otherwise."}
          </p>
        )}
        <button className="button button--primary" disabled={busy || !languageId || !query.trim()}>
          {busy ? "Searching…" : t("search.submit")}
        </button>
      </form>

      {!languageId && <p className="tool-note">{t("search.scope")}</p>}
      {languageId && shards.length === 0 && (
        <p className="callout callout--warning">
          This release has no interactive search shard for the selected scope. Use a prepared
          download or choose another scope.
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
            <strong>{matches.toLocaleString()}</strong> {t("search.results")} · showing{" "}
            {records.length.toLocaleString()} · {scanned.toLocaleString()} candidate records
            checked
          </p>
          {records.length > 0 && (
            <div className="result-export">
              <label>
                Export
                <select
                  value={exportFormat}
                  onChange={(event) => setExportFormat(event.target.value as ExportFormat)}
                >
                  <option value="csv">CSV</option>
                  <option value="tsv">TSV</option>
                  <option value="json">JSON</option>
                  <option value="jsonl">JSON Lines</option>
                  <option value="parquet">Parquet (DuckDB-Wasm)</option>
                  <option value="plain">Plain text</option>
                  <option value="interlinear">Interlinear text</option>
                  <option value="audio">Audio references</option>
                  <option value="recipe">Reproducible recipe</option>
                </select>
              </label>
              <button
                className="button button--quiet"
                disabled={exporting}
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
                {exporting ? "Preparing…" : "Download"}
              </button>
            </div>
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
            Concordance occurrences
          </button>
          <button
            aria-pressed={resultView === "candidates"}
            disabled={!["source", "exact", "prefix", "contains", "fuzzy"].includes(mode)}
            onClick={() => setResultView("candidates")}
          >
            Headword candidates
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
            Results are in deterministic source order. Browser display is capped at 2,000;
            use Dataset builder for a bounded export.
          </p>
          {visibleLimit < 2_000 && (
            <button
              className="button button--quiet"
              disabled={busy}
              onClick={() => void performSearch(Math.min(visibleLimit + 200, 2_000), false)}
            >
              Show next {Math.min(200, 2_000 - visibleLimit)}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
