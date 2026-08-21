import {useCallback, useEffect, useMemo, useRef, useState, type FormEvent} from "react";

import {concordance, dictionary, translationLanguages} from "../apiClient";
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
  onLanguageChange,
  onPractice,
  onViewSentences,
}: {
  data: AppData;
  kind: LookupKind;
  learner?: boolean;
  initialQuery?: string;
  autoSearch?: boolean;
  selectedLanguageId?: string;
  onLanguageChange?: (languageId: string) => void;
  onPractice?: (record: SearchRecord, targetLanguage: string) => void;
  onViewSentences?: (entry: DictionaryEntry) => void;
}) {
  const {languageName, locale, number, t, tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const amis = data.languages.find((language) => language.name === "Amis");
  const [query, setQuery] = useState(initialQuery ?? params.get("q") ?? "");
  const [languageId, setLanguageId] = useState(
    selectedLanguageId ?? params.get("language") ?? amis?.id ?? data.languages[0]?.id ?? "",
  );
  const [corpusId, setCorpusId] = useState(params.get("corpus") ?? "");
  const [dialect, setDialect] = useState(params.get("dialect") ?? "");
  const [direction, setDirection] = useState<SearchDirection>(
    params.get("direction") === "translation" ? "translation" : "formosan",
  );
  const requestedMode = params.get("mode");
  const [match, setMatch] = useState<MatchMode>(
    MATCH_MODES.includes(requestedMode as MatchMode) ? (requestedMode as MatchMode) : "exact",
  );
  const [requirements, setRequirements] = useState<TierRequirement[]>([]);
  const [targets, setTargets] = useState<Array<{xml_lang: string; records: number}>>([]);
  const [targetLanguage, setTargetLanguage] = useState(params.get("target") ?? "eng");
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
  const selectedTranslationLanguage = translationLanguageName(targetLanguage, locale);
  const relevantCorpora = useMemo(
    () => data.corpora.filter((corpus) => corpus.languages.includes(languageId)),
    [data.corpora, languageId],
  );

  useEffect(() => {
    if (!languageId || !data.query.available) return;
    const next = new AbortController();
    translationLanguages(data.meta.release_id, languageId, corpusId, next.signal).then(
      (values) => {
        setTargets(values);
        const available = new Set(values.map((item) => item.xml_lang));
        if (!available.has(targetLanguage)) {
          const preferred = locale === "zh-Hant" ? "zho" : "eng";
          setTargetLanguage(available.has(preferred) ? preferred : values[0]?.xml_lang ?? "");
        }
      },
      () => setTargets([]),
    );
    return () => next.abort();
  }, [corpusId, data.meta.release_id, data.query.available, languageId, locale, targetLanguage]);

  useEffect(() => () => controller.current?.abort(), []);

  const run = useCallback(
    async (append: boolean) => {
      if (!query.trim() || !languageId || !data.query.available) return;
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
          dialect: kind === "sentences" ? dialect : "",
          direction,
          translationLanguage: targetLanguage,
          match,
          requirements: kind === "sentences" ? requirements : [],
          limit: 25,
          cursor: append ? cursor : null,
        };
        if (kind === "dictionary") {
          const result = await dictionary(data.meta.release_id, options, next.signal);
          setDictionaryEntries((current) => append ? [...current, ...result.items] : result.items);
          setCursor(result.next_cursor);
        } else {
          const result = await concordance(data.meta.release_id, options, next.signal);
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
            ...(targetLanguage && {target: targetLanguage}),
            ...(corpusId && {corpus: corpusId}),
            ...(dialect && {dialect}),
          });
        }
      } catch (cause) {
        if (!(cause instanceof DOMException && cause.name === "AbortError")) {
          setError(cause instanceof Error ? cause.message : String(cause));
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
      kind, languageId, match, query, requirements, setParams, targetLanguage,
    ],
  );

  useEffect(() => {
    if (!autoSearch || initialSearchStarted.current) return;
    initialSearchStarted.current = true;
    void run(false);
  }, [autoSearch, run]);

  function submit(event: FormEvent) {
    event.preventDefault();
    void run(false);
  }

  async function saveDictionary(entry: DictionaryEntry) {
    try {
      await saveCard(cardFromDictionaryEntry(entry, data.meta.release_id, targetLanguage));
      setNotice(tx(`${entry.display_form} saved.`, `已儲存「${entry.display_form}」。`));
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function saveSentence(record: SearchRecord) {
    try {
      await saveCard(cardFromRecord(record, data.meta.release_id, targetLanguage));
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
        <fieldset className="lookup-direction">
          <legend>{tx("Search text language", "搜尋文字的語言")}</legend>
          <div className="lookup-direction__options">
            <label>
              <input type="radio" checked={direction === "formosan"} onChange={() => setDirection("formosan")} />
              <span>
                <strong>
                  {tx("Search in", "搜尋")}{" "}
                  {selectedLanguage ? languageName(selectedLanguage) : "Formosan"}
                </strong>
              </span>
            </label>
            <label>
              <input type="radio" checked={direction === "translation"} onChange={() => setDirection("translation")} />
              <span>
                <strong>{tx("Search in", "搜尋")} {selectedTranslationLanguage}</strong>
              </span>
            </label>
          </div>
        </fieldset>
        <div className="field field--query">
          <label htmlFor={`query-${kind}`}>{kind === "dictionary" ? tx("Word or meaning", "單詞或釋義") : tx("Word or phrase", "單詞或片語")}</label>
          <input id={`query-${kind}`} value={query} maxLength={2048} onChange={(event) => setQuery(event.target.value)} autoComplete="off" />
        </div>
        <label className="field">
          {tx("Formosan language", "臺灣南島語")}
          <select value={languageId} onChange={(event) => {
            setLanguageId(event.target.value);
            setCorpusId("");
            onLanguageChange?.(event.target.value);
          }}>
            {data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
          </select>
        </label>
        <label className="field">
          {tx("Translation", "翻譯語言")}
          <select value={targetLanguage} onChange={(event) => setTargetLanguage(event.target.value)}>
            {targets.map((target) => <option key={target.xml_lang} value={target.xml_lang}>{translationLanguageName(target.xml_lang, locale)} ({number(target.records)})</option>)}
          </select>
        </label>
        <div className="search-form__actions">
          <button className="button button--primary" disabled={busy || !query.trim() || !data.query.available}>
            {busy ? tx("Searching…", "搜尋中…") : t("search.submit")}
          </button>
        </div>
        <details className="lookup-options">
          <summary>{tx("Search options", "搜尋選項")}</summary>
          <div className="lookup-options__grid">
            <label className="field">
              {tx("Corpus", "語料庫")}
              <select value={corpusId} onChange={(event) => setCorpusId(event.target.value)}>
                <option value="">{tx("All corpora", "所有語料庫")}</option>
                {relevantCorpora.map((corpus) => <option key={corpus.id} value={corpus.id}>{corpus.name}</option>)}
              </select>
            </label>
            <fieldset className="mode-picker">
              <legend>{tx("Match", "比對方式")}</legend>
              {MATCH_MODES.map((value) => <label key={value}><input type="radio" checked={match === value} onChange={() => setMatch(value)} /><span>{t(`search.${value}`)}</span></label>)}
            </fieldset>
            {kind === "sentences" && selectedLanguage && (
              <>
                <label className="field">
                  {tx("Dialect", "方言")}
                  <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
                    <option value="">{tx("All dialects", "所有方言")}</option>
                    {selectedLanguage.dialects.map((value) => <option key={value} value={value}>{value}</option>)}
                  </select>
                </label>
                <fieldset className="filter-checks">
                  <legend>{tx("Require tiers", "必須包含")}</legend>
                  {REQUIREMENTS.map((value) => (
                    <label key={value}>
                      <input
                        type="checkbox"
                        checked={requirements.includes(value)}
                        onChange={() => setRequirements((current) => current.includes(value)
                          ? current.filter((item) => item !== value)
                          : [...current, value])}
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
              </>
            )}
          </div>
        </details>
      </form>

      <div className="search-feedback" aria-live="polite">
        {error && <p className="callout callout--error">{error}</p>}
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
          targetLanguage={targetLanguage}
          corpusId={corpusId}
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
              targetLanguage={targetLanguage}
              learner={learner}
              onSave={(record) => void saveSentence(record)}
              onNotice={setNotice}
              {...(onPractice ? {onPractice: (record: SearchRecord) => onPractice(record, targetLanguage)} : {})}
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
