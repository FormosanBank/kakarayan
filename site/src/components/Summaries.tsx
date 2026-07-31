import {useMemo, useRef, useState} from "react";

import type {AnalysisResult, CountRow} from "../analysis";
import {runAnalysis} from "../analysisClient";
import {estimateScope, loadScopeRecords, matchingShards} from "../data";
import {Link} from "../routing";
import type {AppData} from "../types";

type TableKind =
  | "source"
  | "normalized"
  | "translation"
  | "distribution"
  | "ngrams"
  | "collocates";

function table(result: AnalysisResult, kind: TableKind): CountRow[] {
  const values = {
    source: result.sourceFrequencies,
    normalized: result.normalizedFrequencies,
    translation: result.translationFrequencies,
    distribution: result.distributions,
    ngrams: result.ngrams,
    collocates: result.collocates,
  };
  return values[kind];
}

function downloadRows(result: AnalysisResult, kind: TableKind, format: "csv" | "json") {
  const values = table(result, kind);
  const contents =
    format === "json"
      ? `${JSON.stringify(
          {
            seed: result.seed,
            ngram_size: result.ngramSize,
            collocate: result.collocate,
            rows: values,
          },
          null,
          2,
        )}\n`
      : `value,count\n${values
          .map(({value, count}) => {
            const safe = /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
            return `"${safe.replaceAll('"', '""')}",${count}`;
          })
          .join("\n")}\n`;
  const url = URL.createObjectURL(
    new Blob([contents], {
      type: format === "json" ? "application/json" : "text/csv;charset=utf-8",
    }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kakarayan-${kind}.${format}`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Summaries({data}: {data: AppData}) {
  const [languageId, setLanguageId] = useState("");
  const [corpusId, setCorpusId] = useState("");
  const [ngramSize, setNgramSize] = useState(2);
  const [collocate, setCollocate] = useState("");
  const [seed, setSeed] = useState("kakarayan-1");
  const [kind, setKind] = useState<TableKind>("source");
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const corpora = useMemo(
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
  const estimate = useMemo(() => estimateScope(shards), [shards]);

  async function run() {
    if (!languageId) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setError("");
    try {
      const records = await loadScopeRecords(shards, next.signal, 50_000);
      setResult(
        await runAnalysis(
          records,
          {ngramSize, collocate: collocate.trim(), seed: seed.trim() || "kakarayan-1"},
          next.signal,
        ),
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controller.current === next) setBusy(false);
    }
  }

  const rows = result ? table(result, kind) : [];
  return (
    <section className="summaries">
      <div className="summary-controls">
        <div>
          <h2>Scoped linguistic summaries</h2>
          <p>
            Descriptive corpus counts are not claims about speakers, vitality,
            grammaticality, or population-wide language use.
          </p>
        </div>
        <div className="form-grid">
          <label className="field">
            Language
            <select
              value={languageId}
              onChange={(event) => {
                setLanguageId(event.target.value);
                setCorpusId("");
                setResult(null);
              }}
            >
              <option value="">Choose…</option>
              {data.languages.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Corpus
            <select value={corpusId} onChange={(event) => setCorpusId(event.target.value)}>
              <option value="">All compatible corpora</option>
              {corpora.map((corpus) => (
                <option key={corpus.id} value={corpus.id}>
                  {corpus.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            N-gram size
            <select value={ngramSize} onChange={(event) => setNgramSize(Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Collocate token
            <input
              value={collocate}
              maxLength={80}
              onChange={(event) => setCollocate(event.target.value)}
              placeholder="Optional, ±2 tokens"
            />
          </label>
          <label className="field">
            Sample seed
            <input
              value={seed}
              maxLength={80}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
        </div>
        <p className="tool-note">
          Scope: {estimate.records.toLocaleString()} sentences,{" "}
          {(estimate.uncompressedBytes / 1024 / 1024).toFixed(1)} MiB decoded. Browser
          summaries are limited to 50,000 sentences.
        </p>
        <div className="button-row">
          <button
            className="button button--primary"
            disabled={!languageId || busy || estimate.records > 50_000}
            onClick={run}
          >
            {busy ? "Computing in worker…" : "Compute summaries"}
          </button>
          {busy && (
            <button className="text-button" onClick={() => controller.current?.abort()}>
              Cancel
            </button>
          )}
          {estimate.records > 50_000 && <Link to="/downloads">Use prepared data →</Link>}
        </div>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      {result && (
        <>
          <div className="summary-stats">
            <div>
              <strong>{result.records.toLocaleString()}</strong>
              <span>sentences</span>
            </div>
            <div>
              <strong>{result.tokens.toLocaleString()}</strong>
              <span>tokens</span>
            </div>
            <div>
              <strong>{result.sourceTypes.toLocaleString()}</strong>
              <span>source-exact types</span>
            </div>
            <div>
              <strong>{result.normalizedTypes.toLocaleString()}</strong>
              <span>normalized types</span>
            </div>
            <div>
              <strong>
                {result.tokens ? (result.normalizedTypes / result.tokens).toFixed(3) : "0"}
              </strong>
              <span>type/token ratio</span>
            </div>
          </div>
          <div className="summary-tabs" role="tablist" aria-label="Summary table">
            {(
              [
                "source",
                "normalized",
                "translation",
                "distribution",
                "ngrams",
                "collocates",
              ] as TableKind[]
            ).map((value) => (
              <button
                role="tab"
                aria-selected={kind === value}
                key={value}
                onClick={() => setKind(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <div className="summary-export">
            <span>
              Seed <code>{result.seed}</code> · deterministic sample{" "}
              {result.sampleIds.slice(0, 5).join(", ")}
            </span>
            <button onClick={() => downloadRows(result, kind, "csv")}>CSV</button>
            <button onClick={() => downloadRows(result, kind, "json")}>JSON</button>
          </div>
          <div className="table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>{kind}</th>
                  <th>Count</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.value}>
                    <td>{row.value}</td>
                    <td>{row.count.toLocaleString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
