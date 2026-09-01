import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from "react";

import {concordance, dictionary, translationLanguages} from "../apiClient";
import {apiErrorMessage, isAbortError} from "../apiErrors";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import {cardFromDictionaryEntry, cardFromRecord, saveCard} from "../study";
import {translationLanguageName} from "../translationLanguages";
import type {
  AppData,
  DictionaryEntry,
  MatchMode,
  SearchDirection,
  SearchRecord,
  SentenceSummary,
  TierRequirement,
} from "../types";
import {CandidateGroups} from "./CandidateGroups";
import {Diagnostics} from "./Diagnostics";
import {LoadingState} from "./LoadingState";
import {SearchResultCard} from "./SearchResultCard";

export type LookupKind = "dictionary" | "sentences";
const MATCH_MODES: MatchMode[] = ["exact", "prefix", "contains"];
const REQUIREMENTS: TierRequirement[] = [
  "translation",
  "audio",
  "phonology",
  "interlinear",
  "unclear",
];

export function SearchTool({
  data,
  kind,
  learner = false,
  initialQuery,
  autoSearch = false,
  selectedLanguageId,
  selectedDialect,
  onPractice,
  onViewSentences,
}: {
  data: AppData;
  kind: LookupKind;
  learner?: boolean;
  initialQuery?: string;
  autoSearch?: boolean;
  selectedLanguageId?: string;
  selectedDialect?: string;
  onPractice?: (record: SearchRecord, targetLanguage: string) => void;
  onViewSentences?: (entry: DictionaryEntry) => void;
}) {
  const {dialectName, languageName, locale, number, t, tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const amis = data.languages.find((language) => language.name === "Amis");
  const [query, setQuery] = useState(initialQuery ?? params.get("q") ?? "");
  const [languageId, setLanguageId] = useState(
    selectedLanguageId ?? params.get("language") ?? amis?.id ?? data.languages[0]?.id ?? "",
  );
  const [corpusId, setCorpusId] = useState(params.get("corpus") ?? "");
  const [dialect, setDialect] = useState(selectedDialect ?? params.get("dialect") ?? "");
  const [direction, setDirection] = useState<SearchDirection>(
    !autoSearch && params.get("direction") === "translation" ? "translation" : "formosan",
  );
  const requestedMode = params.get("mode");
  const [match, setMatch] = useState<MatchMode>(
    MATCH_MODES.includes(requestedMode as MatchMode)
      ? (requestedMode as MatchMode)
      : kind === "sentences" ? "contains" : "exact",
  );
  const [requirements, setRequirements] = useState<TierRequirement[]>([]);
  const [targets, setTargets] = useState<Array<{xml_lang: string; records: number}>>([]);
  const [targetsLoading, setTargetsLoading] = useState(true);
  const [translationLanguage, setTranslationLanguage] = useState(params.get("target") ?? "eng");
  const [dictionaryEntries, setDictionaryEntries] = useState<DictionaryEntry[]>([]);
  const [sentences, setSentences] = useState<SentenceSummary[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [searched, setSearched] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loadingMode, setLoadingMode] = useState<"replace" | "append" | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const controller = useRef<AbortController | null>(null);
  const initialSearchStarted = useRef(false);

  const selectedLanguage = data.languages.find((language) => language.id === languageId);
  const selectedTranslationLanguage = translationLanguageName(translationLanguage, locale);
  const resultTranslationLanguage = translationLanguage;
  const translationSearchReady = !targetsLoading && (
    direction === "formosan" || targets.some((target) => target.xml_lang === translationLanguage)
  );
  const searchLanguageValue = direction === "formosan"
    ? "formosan"
    : `translation:${translationLanguage}`;
  const queryLabel = direction === "formosan"
    ? (kind === "dictionary"
        ? tx(
            `${selectedLanguage ? languageName(selectedLanguage) : "Formosan"} word`,
            `${selectedLanguage ? languageName(selectedLanguage) : "臺灣南島語"}單詞`,
          )
        : tx(
            `${selectedLanguage ? languageName(selectedLanguage) : "Formosan"} word or phrase`,
            `${selectedLanguage ? languageName(selectedLanguage) : "臺灣南島語"}單詞或片語`,
          ))
    : (kind === "dictionary"
        ? tx(`${selectedTranslationLanguage} word or meaning`, `${selectedTranslationLanguage}單詞或釋義`)
        : tx(`${selectedTranslationLanguage} word or phrase`, `${selectedTranslationLanguage}單詞或片語`));
  const relevantCorpora = useMemo(
    () => data.corpora.filter((corpus) => corpus.languages.includes(languageId)),
    [data.corpora, languageId],
  );

  const resetResults = useCallback(() => {
    controller.current?.abort();
    controller.current = null;
    setDictionaryEntries([]);
    setSentences([]);
    setCursor(null);
    setSearched(false);
    setBusy(false);
    setLoadingMode(null);
    setError("");
    setNotice("");
  }, []);

  useEffect(() => {
    if (!languageId || !data.query.available) return;
    const next = new AbortController();
    translationLanguages(data.meta.release_id, languageId, corpusId, next.signal).then(
      (values) => {
        if (next.signal.aborted) return;
        setTargets(values);
        setTargetsLoading(false);
        const available = new Set(values.map((item) => item.xml_lang));
        setTranslationLanguage((current) => {
          if (available.has(current)) return current;
          const preferred = locale === "zh-Hant" ? "zho" : "eng";
          return available.has(preferred) ? preferred : values[0]?.xml_lang ?? "";
        });
        if (values.length === 0) setDirection("formosan");
      },
      () => {
        if (next.signal.aborted) return;
        setTargets([]);
        setTargetsLoading(false);
        setTranslationLanguage("");
        setDirection("formosan");
      },
    );
    return () => next.abort();
  }, [corpusId, data.meta.release_id, data.query.available, languageId, locale]);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (append: boolean) => {
      if (!query.trim() || !languageId || !data.query.available || !translationSearchReady) return;
      controller.current?.abort();
      const next = new AbortController();
      controller.current = next;
      setBusy(true);
      setLoadingMode(append ? "append" : "replace");
      setError("");
      if (!append) {
        setDictionaryEntries([]);
        setSentences([]);
        setCursor(null);
        setSearched(false);
      }
      try {
        const options = {
          q: query.trim(),
          languageId,
          corpusId,
          dialect,
          direction,
          translationLanguage,
          match,
          requirements: kind === "sentences" ? requirements : [],
          limit: 25,
          cursor: append ? cursor : null,
        };
        if (kind === "dictionary") {
          const result = await dictionary(data.meta.release_id, options, next.signal);
          if (next.signal.aborted || controller.current !== next) return;
          setDictionaryEntries((current) => append ? [...current, ...result.items] : result.items);
          setCursor(result.next_cursor);
        } else {
          const result = await concordance(data.meta.release_id, options, next.signal);
          if (next.signal.aborted || controller.current !== next) return;
          setSentences((current) => append ? [...current, ...result.items] : result.items);
          setCursor(result.next_cursor);
        }
        setSearched(true);
        if (!append) {
          setParams({
            type: kind,
            q: query.trim(),
            language: languageId,
            direction,
            mode: match,
            ...(translationLanguage && {target: translationLanguage}),
            ...(corpusId && {corpus: corpusId}),
            ...(dialect && {dialect}),
          });
        }
      } catch (cause) {
        if (!isAbortError(cause)) {
          setError(apiErrorMessage(cause, tx));
        }
      } finally {
        if (controller.current === next) {
          setBusy(false);
          setLoadingMode(null);
        }
      }
    },
    [
      corpusId, cursor, data.meta.release_id, data.query.available, dialect, direction,
      kind, languageId, match, query, requirements, setParams, translationLanguage,
      translationSearchReady, tx,
    ],
  );

  useEffect(() => {
    if (!autoSearch || initialSearchStarted.current || !translationSearchReady) return;
    initialSearchStarted.current = true;
    void run(false);
  }, [autoSearch, run, translationSearchReady]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(false);
  }

  function changeSearchLanguage(value: string) {
    resetResults();
    setQuery("");
    if (value === "formosan") {
      setDirection("formosan");
      return;
    }
    const target = value.replace(/^translation:/u, "");
    setTranslationLanguage(target);
    setDirection("translation");
  }

  async function saveDictionary(entry: DictionaryEntry) {
    try {
      await saveCard(
        cardFromDictionaryEntry(entry, data.meta.release_id, resultTranslationLanguage),
      );
      setNotice(tx(`${entry.display_form} saved.`, `已儲存「${entry.display_form}」。`));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveSentence(record: SearchRecord) {
    try {
      await saveCard(cardFromRecord(record, data.meta.release_id, resultTranslationLanguage));
      setNotice(tx("Sentence saved.", "已儲存句子。"));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const resultCount = kind === "dictionary" ? dictionaryEntries.length : sentences.length;
  const replacingResults = busy && loadingMode === "replace";
  return (
    <section className={`search-tool search-tool--${kind} ${learner ? "search-tool--learner" : ""}`}>
      {!data.query.available && (
        <div className="callout callout--error">
          <p>{tx("Corpus search is temporarily unavailable.", "語料搜尋暫時無法使用。")}</p>
          <Diagnostics releaseId={data.meta.release_id} error={new Error(data.query.error)} />
        </div>
      )}
      <form className="search-form" onSubmit={submit}>
        <div className={`search-form__fields ${selectedLanguageId ? "search-form__fields--controlled" : ""}`}>
          {!selectedLanguageId && (
            <label className="field search-form__formosan-language">
              {tx("Formosan language", "臺灣南島語")}
              <select value={languageId} onChange={(event) => {
                if (event.target.value === languageId) return;
                resetResults();
                setLanguageId(event.target.value);
                setCorpusId("");
                setDialect("");
                setTargets([]);
                setTargetsLoading(true);
              }}>
                {data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
              </select>
            </label>
          )}
          <label className="field search-form__search-language">
            {tx("Search text language", "搜尋文字語言")}
            <select
              disabled={targetsLoading && direction === "translation"}
              value={searchLanguageValue}
              onChange={(event) => changeSearchLanguage(event.target.value)}
            >
              <option value="formosan">
                {selectedLanguage ? languageName(selectedLanguage) : tx("Formosan", "臺灣南島語")}
              </option>
              {targets.map((target) => (
                <option key={target.xml_lang} value={`translation:${target.xml_lang}`}>
                  {translationLanguageName(target.xml_lang, locale)}
                </option>
              ))}
            </select>
          </label>
          {direction === "formosan" ? (
            <label className="field search-form__result-language">
              {tx("Results language", "結果語言")}
              <select
                disabled={targetsLoading || targets.length === 0}
                value={translationLanguage}
                onChange={(event) => {
                  resetResults();
                  setTranslationLanguage(event.target.value);
                }}
              >
                {targetsLoading && <option value={translationLanguage}>{tx("Loading…", "載入中…")}</option>}
                {!targetsLoading && targets.length === 0 && <option value="">{tx("No translation", "沒有翻譯")}</option>}
                {!targetsLoading && translationLanguage && !targets.some(
                  (target) => target.xml_lang === translationLanguage,
                ) && (
                  <option value={translationLanguage}>{selectedTranslationLanguage}</option>
                )}
                {targets.map((target) => (
                  <option key={target.xml_lang} value={target.xml_lang}>
                    {translationLanguageName(target.xml_lang, locale)}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <div className="field search-form__result-language">
              <span>{tx("Results language", "結果語言")}</span>
              <output className="field-output">
                {selectedLanguage ? languageName(selectedLanguage) : tx("Formosan", "臺灣南島語")}
              </output>
            </div>
          )}
          <div className="field field--query search-form__query">
            <label htmlFor={`query-${kind}`}>{queryLabel}</label>
            <input id={`query-${kind}`} value={query} maxLength={2048} onChange={(event) => {
              resetResults();
              setQuery(event.target.value);
            }} autoComplete="off" />
          </div>
          <div className="search-form__actions">
            <button className="button button--primary" disabled={busy || !query.trim() || !data.query.available || !translationSearchReady}>
              {busy ? tx("Searching…", "搜尋中…") : t("search.submit")}
            </button>
          </div>
        </div>
        <details className="lookup-options">
          <summary>{tx("Search options", "搜尋選項")}</summary>
          <div className="lookup-options__grid">
            <div className="search-scope-note">
              <strong>{tx("Search fields", "搜尋欄位")}</strong>
              <span>{direction === "formosan"
                ? kind === "dictionary"
                  ? tx("Standard; original fallback; W / M forms", "標準形式；原始形式備用；W / M 形式")
                  : tx("Original + standard + alternate · S / W / M", "原始 + 標準 + 替代 · S / W / M")
                : tx(`${selectedTranslationLanguage} translations · S / W / M`, `${selectedTranslationLanguage}翻譯 · S / W / M`)}</span>
            </div>
            <label className="field">
              {tx("Corpus", "語料庫")}
              <select value={corpusId} onChange={(event) => {
                if (event.target.value === corpusId) return;
                resetResults();
                setCorpusId(event.target.value);
                setTargets([]);
                setTargetsLoading(true);
              }}>
                <option value="">{tx("All corpora", "所有語料庫")}</option>
                {relevantCorpora.map((corpus) => <option key={corpus.id} value={corpus.id}>{corpus.name}</option>)}
              </select>
            </label>
            <fieldset className="mode-picker">
              <legend>{tx("Match", "比對方式")}</legend>
              {MATCH_MODES.map((value) => <label key={value}><input type="radio" checked={match === value} onChange={() => {
                resetResults();
                setMatch(value);
              }} /><span>{t(`search.${value}`)}</span></label>)}
            </fieldset>
            {selectedDialect === undefined && selectedLanguage?.dialects.length ? (
              <label className="field">
                {tx("Dialect", "方言")}
                <select value={dialect} onChange={(event) => {
                  resetResults();
                  setDialect(event.target.value);
                }}>
                  <option value="">{tx("All dialects", "所有方言")}</option>
                  {selectedLanguage.dialects.map((value) => (
                    <option key={value} value={value}>{dialectName(value)}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {kind === "sentences" && (
              <fieldset className="filter-checks">
                <legend>{tx("Require tiers", "必須包含")}</legend>
                {REQUIREMENTS.map((value) => (
                  <label key={value}>
                    <input
                      type="checkbox"
                      checked={requirements.includes(value)}
                      onChange={() => {
                        resetResults();
                        setRequirements((current) => current.includes(value)
                          ? current.filter((item) => item !== value)
                          : [...current, value]);
                      }}
                    />
                    <span>{tx(value, {
                      translation: "翻譯",
                      audio: "音訊",
                      phonology: "音韻",
                      interlinear: "逐行分析",
                      unclear: "不確定標註",
                    }[value])}</span>
                  </label>
                ))}
              </fieldset>
            )}
          </div>
        </details>
      </form>

      <div className="search-feedback" aria-live="polite">
        {error && (
          <div className="callout callout--error callout--action">
            <span>{error}</span>
            <button className="text-button" type="button" onClick={() => void run(false)}>
              {tx("Try again", "重試")}
            </button>
          </div>
        )}
        {busy && (
          <button
            className="text-button search-feedback__cancel"
            type="button"
            onClick={() => controller.current?.abort()}
          >
            {tx("Cancel", "取消")}
          </button>
        )}
        {searched && !error && !replacingResults && <p className="result-count">{number(resultCount)} {tx("shown", "筆顯示")}</p>}
      </div>
      {notice && <p className="search-notice" role="status">{notice}</p>}
      {!busy && searched && resultCount === 0 && <div className="empty-state">{t("search.noResults")}</div>}

      {replacingResults ? (
        <LoadingState
          kind="results"
          label={tx("Searching the corpus", "正在搜尋語料庫")}
        />
      ) : kind === "dictionary" ? (
        <CandidateGroups
          data={data}
          entries={dictionaryEntries}
          targetLanguage={resultTranslationLanguage}
          corpusId={corpusId}
          query={query}
          mode={match}
          direction={direction}
          onSave={(entry) => void saveDictionary(entry)}
          {...(onViewSentences && {onViewSentences})}
        />
      ) : (
        <div className="result-list">
          {sentences.map((summary) => (
            <SearchResultCard
              data={data}
              key={summary.id}
              summary={summary}
              query={query}
              mode={match}
              direction={direction}
              targetLanguage={resultTranslationLanguage}
              learner={learner}
              onSave={(record) => void saveSentence(record)}
              onNotice={setNotice}
              {...(onPractice
                ? {
                    onPractice: (record: SearchRecord) =>
                      onPractice(record, resultTranslationLanguage),
                  }
                : {})}
            />
          ))}
        </div>
      )}
      {loadingMode === "append" && (
        <LoadingState compact label={tx("Loading more results", "正在載入更多結果")} />
      )}
      {cursor && loadingMode !== "append" && <div className="pagination-actions"><button className="button button--quiet" disabled={busy} onClick={() => void run(true)}>{tx("Load more", "載入更多")}</button></div>}
    </section>
  );
}
