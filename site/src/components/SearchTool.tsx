import {useEffect, useMemo, useRef, useState, type FormEvent} from "react";
import {matchingShards, searchRecords, type SearchMode} from "../data";
import {downloadExport, type ExportFormat} from "../exports";
import {useI18n} from "../i18n";
import {Link, useSearchParams} from "../routing";
import {cardFromRecord, saveCard} from "../study";
import type {AppData, SearchRecord} from "../types";

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
  const [truncated, setTruncated] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [exportFormat, setExportFormat] = useState<ExportFormat>("csv");
  const [exporting, setExporting] = useState(false);
  const controller = useRef<AbortController | null>(null);

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

  useEffect(
    () => () => {
      controller.current?.abort();
    },
    [],
  );

  async function runSearch(event: FormEvent) {
    event.preventDefault();
    if (!languageId || !query.trim()) return;
    controller.current?.abort();
    const nextController = new AbortController();
    controller.current = nextController;
    setBusy(true);
    setError("");
    setNotice("");
    setParams({q: query.trim(), language: languageId, ...(corpusId && {corpus: corpusId}), mode});
    try {
      const result = await searchRecords(
        shards,
        query,
        mode,
        nextController.signal,
        learner ? 60 : 200,
      );
      setRecords(result.records);
      setScanned(result.scanned);
      setTruncated(result.truncated);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") return;
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      if (controller.current === nextController) setBusy(false);
    }
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
      {error && <p className="callout callout--error">{error}</p>}
      {notice && (
        <p className="callout callout--success" role="status">
          {notice}
        </p>
      )}

      {(records.length > 0 || (!busy && scanned > 0)) && (
        <div className="results-heading" aria-live="polite">
          <p>
            <strong>{records.length}</strong> {t("search.results")} · {scanned.toLocaleString()}{" "}
            records scanned
            {truncated && " · first 200 shown"}
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

      {!busy && scanned > 0 && records.length === 0 && (
        <div className="empty-state">{t("search.noResults")}</div>
      )}

      <div className="result-list">
        {records.map((record) => (
          <article className="result-card" key={record.id}>
            <div className="result-card__scope">
              <span>{data.languages.find((item) => item.id === record.language_id)?.name}</span>
              {record.dialect && <span>{record.dialect}</span>}
              <span>{data.corpora.find((item) => item.id === record.corpus_id)?.name}</span>
            </div>
            <h3>{record.standard || record.original || "Untranscribed sentence"}</h3>
            {record.original && record.original !== record.standard && (
              <dl className="tier-pair">
                <div>
                  <dt>{t("search.original")}</dt>
                  <dd lang={record.language_id}>{record.original}</dd>
                </div>
                <div>
                  <dt>{t("search.standard")}</dt>
                  <dd lang={record.language_id}>{record.standard}</dd>
                </div>
              </dl>
            )}
            {(record.phonology.length > 0 ||
              record.tier_translations.some((item) => item.owner_type !== "sentence")) && (
              <details className="tier-details">
                <summary>Word, morpheme, and phonology tiers</summary>
                {record.phonology.map((item) => (
                  <p key={`${item.owner_type}-${item.owner_id}-${item.position}`}>
                    <strong>PHON · {item.owner_type}</strong> {item.text}
                  </p>
                ))}
                {record.tier_translations
                  .filter((item) => item.owner_type !== "sentence")
                  .map((item) => (
                    <p key={`${item.owner_type}-${item.owner_id}-${item.position}`}>
                      <strong>
                        {item.kind || "TRANSL"} · {item.owner_type}
                      </strong>{" "}
                      {item.text}
                    </p>
                  ))}
                {record.words.map((word) => (
                  <p key={word.id}>
                    <strong>W {word.position + 1}</strong>
                    {word.class && ` · class ${word.class}`}
                    {word.sclass && ` · sclass ${word.sclass}`}
                    {word.morphemes.length > 0 &&
                      ` · ${word.morphemes.length} morpheme${word.morphemes.length === 1 ? "" : "s"}`}
                  </p>
                ))}
              </details>
            )}
            <div className="translations">
              {record.translations.map((translation, index) => (
                <p key={`${translation.xml_lang}-${index}`} lang={translation.xml_lang}>
                  <span>{translation.xml_lang || "translation"}</span>
                  {translation.text}
                </p>
              ))}
            </div>
            <footer>
              <code>{record.xml_id}</code>
              <a
                href={`https://github.com/FormosanBank/FormosanBank/blob/${data.meta.source.commit}/${record.source_path}`}
                target="_blank"
                rel="noreferrer"
              >
                Source XML
              </a>
              <button className="text-button" onClick={() => addToDeck(record)}>
                {t("search.save")}
              </button>
              {learner && (
                <Link
                  className="text-button"
                  to={`/search?q=${encodeURIComponent(query)}&language=${record.language_id}`}
                >
                  {t("search.research")}
                </Link>
              )}
            </footer>
          </article>
        ))}
      </div>
    </section>
  );
}
