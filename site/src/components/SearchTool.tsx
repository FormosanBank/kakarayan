import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FormEvent,
} from "react";

import {matchingIndexes, matchingShards, searchRecords, type SearchMode} from "../data";
import {downloadExport, type ExportFormat} from "../exports";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import {cardFromDictionary, cardFromRecord, saveCard} from "../study";
import {translationLanguageName} from "../translationLanguages";
import type {AppData, SearchRecord} from "../types";
import {CandidateGroups} from "./CandidateGroups";
import {Diagnostics} from "./Diagnostics";
import {SearchResultCard} from "./SearchResultCard";

export type LookupKind = "dictionary" | "sentences";

const DICTIONARY_MODES: SearchMode[] = ["exact", "prefix", "fuzzy"];
const SENTENCE_MODES: SearchMode[] = [
  "exact",
  "contains",
  "translation",
  "phonology",
  "gloss",
  "regex",
  "source",
];

export function SearchTool({
  data,
  kind,
  learner = false,
}: {
  data: AppData;
  kind: LookupKind;
  learner?: boolean;
}) {
  const {locale, number, t, tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const amis = data.languages.find((language) => language.name === "Amis");
  const initialLanguage =
    params.get("language") ?? amis?.id ?? data.languages[0]?.id ?? "";
  const modes = kind === "dictionary" ? DICTIONARY_MODES : SENTENCE_MODES;
  const requestedMode = params.get("mode") as SearchMode | null;
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [languageId, setLanguageId] = useState(initialLanguage);
  const [corpusId, setCorpusId] = useState(params.get("corpus") ?? "");
  const [selectedTarget, setSelectedTarget] = useState(params.get("target") ?? "");
  const [mode, setMode] = useState<SearchMode>(
    requestedMode && modes.includes(requestedMode) ? requestedMode : "exact",
  );
  const [records, setRecords] = useState<SearchRecord[]>([]);
  const [scanned, setScanned] = useState(0);
  const [matches, setMatches] = useState(0);
  const [truncated, setTruncated] = useState(false);
  const initialLimit = learner ? 30 : kind === "dictionary" ? 200 : 25;
  const [visibleLimit, setVisibleLimit] = useState(initialLimit);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const initialStarted = useRef(false);
  const hasInitialQuery = useRef(Boolean(params.get("q") && initialLanguage));

  const relevantCorpora = useMemo(
    () => data.corpora.filter((corpus) => corpus.languages.includes(languageId)),
    [data.corpora, languageId],
  );
  const targets = useMemo(
    () =>
      data.search.translation_targets
        .map((target) => {
          const scopes = target.scopes.filter(
            (scope) =>
              scope.language_id === languageId &&
              (!corpusId || scope.corpus_id === corpusId),
          );
          const records = scopes.reduce(
            (total, scope) =>
              total + (kind === "sentences" ? scope.sentence_records : scope.records),
            0,
          );
          return {...target, records};
        })
        .filter((target) => target.records > 0)
        .sort((left, right) =>
          translationLanguageName(left.xml_lang, locale).localeCompare(
            translationLanguageName(right.xml_lang, locale),
          ),
        ),
    [corpusId, data.search.translation_targets, kind, languageId, locale],
  );
  const targetLanguage = useMemo(() => {
    const available = new Set(targets.map((target) => target.xml_lang));
    if (selectedTarget && available.has(selectedTarget)) return selectedTarget;
    const preferred = locale === "zh-Hant" ? "zho" : "eng";
    return available.has(preferred) ? preferred : targets[0]?.xml_lang ?? "";
  }, [locale, selectedTarget, targets]);
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

  const performSearch = useCallback(
    async (limit: number, updateUrl: boolean) => {
      if (!languageId || !targetLanguage || !query.trim()) return;
      controller.current?.abort();
      const nextController = new AbortController();
      controller.current = nextController;
      setBusy(true);
      setError("");
      setNotice("");
      setSearched(false);
      if (updateUrl) {
        setParams({
          type: kind,
          q: query.trim(),
          language: languageId,
          target: targetLanguage,
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
          targetLanguage,
          kind === "dictionary" ? "any" : "sentence",
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
    },
    [corpusId, indexes, kind, languageId, mode, query, setParams, shards, targetLanguage],
  );

  useEffect(() => {
    if (!hasInitialQuery.current || initialStarted.current || !targetLanguage) return;
    const timer = window.setTimeout(() => {
      initialStarted.current = true;
      void performSearch(initialLimit, false);
    });
    return () => window.clearTimeout(timer);
  }, [initialLimit, performSearch, targetLanguage]);

  useEffect(() => {
    const recordId = params.get("record");
    if (!searched || !recordId) return;
    document.getElementById(`record-${recordId}`)?.scrollIntoView({block: "center"});
  }, [params, searched, records]);

  function runSearch(event: FormEvent) {
    event.preventDefault();
    void performSearch(initialLimit, true);
  }

  async function addSentence(record: SearchRecord) {
    try {
      await saveCard(cardFromRecord(record, data.meta.release_id, targetLanguage));
      setNotice(tx("Sentence saved.", "已儲存句子。"));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function addWord(record: SearchRecord, front: string, meanings: string[]) {
    try {
      await saveCard(
        cardFromDictionary(
          record,
          data.meta.release_id,
          front,
          meanings,
          targetLanguage,
        ),
      );
      setNotice(tx(`${front} saved.`, `已儲存「${front}」。`));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const resultLabel = kind === "dictionary"
    ? tx("matching corpus records", "筆相符語料記錄")
    : tx(matches === 1 ? "sentence" : "sentences", "句子");

  return (
    <section className={`search-tool search-tool--${kind} ${learner ? "search-tool--learner" : ""}`}>
      <form className="search-form" onSubmit={runSearch}>
        <div className="field field--query">
          <label htmlFor={`query-${kind}-${learner ? "learn" : "research"}`}>
            {kind === "dictionary" ? tx("Word", "單詞") : tx("Word, phrase, or translation", "單詞、片語或翻譯")}
          </label>
          <input
            id={`query-${kind}-${learner ? "learn" : "research"}`}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            autoComplete="off"
            placeholder={kind === "dictionary" ? "fangcalay" : tx("word in a sentence", "句子中的單詞")}
          />
        </div>
        <div className="field">
          <label htmlFor={`language-${kind}-${learner ? "learn" : "research"}`}>
            {tx("Formosan language", "臺灣南島語")}
          </label>
          <select
            id={`language-${kind}-${learner ? "learn" : "research"}`}
            value={languageId}
            onChange={(event) => {
              setLanguageId(event.target.value);
              setCorpusId("");
            }}
          >
            {data.languages.map((language) => (
              <option key={language.id} value={language.id}>{language.name}</option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor={`target-${kind}-${learner ? "learn" : "research"}`}>
            {tx("Translation", "翻譯語言")}
          </label>
          <select
            id={`target-${kind}-${learner ? "learn" : "research"}`}
            value={targetLanguage}
            onChange={(event) => setSelectedTarget(event.target.value)}
          >
            {targets.map((target) => (
              <option key={target.xml_lang} value={target.xml_lang}>
                {translationLanguageName(target.xml_lang, locale)} ({number(target.records)})
              </option>
            ))}
          </select>
        </div>
        <button
          className="button button--primary"
          disabled={busy || !languageId || !targetLanguage || !query.trim()}
        >
          {busy ? tx("Searching…", "搜尋中…") : t("search.submit")}
        </button>
        <details className="lookup-options">
          <summary>{tx("Search options", "搜尋選項")}</summary>
          <div className="lookup-options__grid">
            <label className="field">
              {t("search.corpus")}
              <select value={corpusId} onChange={(event) => setCorpusId(event.target.value)}>
                <option value="">{tx("All corpora", "所有語料庫")}</option>
                {relevantCorpora.map((corpus) => (
                  <option key={corpus.id} value={corpus.id}>{corpus.name}</option>
                ))}
              </select>
            </label>
            <fieldset className="mode-picker">
              <legend>{t("search.mode")}</legend>
              {modes.map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name={`mode-${kind}-${learner ? "learn" : "research"}`}
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  <span>{t(`search.${value}`)}</span>
                </label>
              ))}
            </fieldset>
          </div>
        </details>
      </form>

      {targets.length === 0 && (
        <p className="callout callout--warning">
          {tx("No translated records are available for this scope.", "此範圍沒有可用的翻譯記錄。")}
        </p>
      )}
      {languageId && shards.length === 0 && (
        <p className="callout callout--warning">
          {tx("No browser search data is available for this scope.", "此範圍沒有瀏覽器搜尋資料。")}
        </p>
      )}
      {error && (
        <div className="callout callout--error">
          <p>{error}</p>
          <Diagnostics releaseId={data.meta.release_id} error={new Error(error)} />
        </div>
      )}
      {notice && <p className="callout callout--success" role="status">{notice}</p>}

      {(records.length > 0 || (!busy && searched)) && (
        <div className="results-heading" aria-live="polite">
          <dl className="result-summary">
            <div>
              <dt>{tx("Matches", "相符結果")}</dt>
              <dd><strong>{number(matches)}</strong> {resultLabel}</dd>
            </div>
            <div>
              <dt>{tx("Displayed", "目前顯示")}</dt>
              <dd>{number(records.length)}</dd>
            </div>
            <div>
              <dt>{tx("Records searched", "已搜尋記錄")}</dt>
              <dd>{number(scanned)}</dd>
            </div>
          </dl>
          {kind === "sentences" && !learner && records.length > 0 && (
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
                  <option value="jsonl">JSON Lines</option>
                  <option value="parquet">Parquet</option>
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
                {exporting ? tx("Preparing…", "準備中…") : tx("Download shown", "下載目前結果")}
              </button>
            </div>
          )}
        </div>
      )}

      {exportBlocked && kind === "sentences" && records.length > 0 && (
        <p className="callout callout--warning">
          {tx("This selection includes a corpus with restricted redistribution.", "此選取範圍包含限制再散布的語料庫。")}
        </p>
      )}
      {!busy && searched && records.length === 0 && <div className="empty-state">{t("search.noResults")}</div>}

      {kind === "dictionary" ? (
        <CandidateGroups
          data={data}
          records={records}
          query={query}
          mode={mode}
          targetLanguage={targetLanguage}
          corpusId={corpusId}
          onSave={(record, front, meanings) => void addWord(record, front, meanings)}
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
              targetLanguage={targetLanguage}
              learner={learner}
              onSave={(value) => void addSentence(value)}
              onNotice={setNotice}
            />
          ))}
        </div>
      )}

      {truncated && (
        <div className="pagination-actions">
          <p>{tx("More matches are available.", "還有更多相符結果。")}</p>
          {visibleLimit < 2_000 && (
            <button
              className="button button--quiet"
              disabled={busy}
              onClick={() =>
                void performSearch(
                  Math.min(visibleLimit + (kind === "dictionary" ? 200 : 25), 2_000),
                  false,
                )
              }
            >
              {tx("Load more", "載入更多")}
            </button>
          )}
        </div>
      )}
    </section>
  );
}
