import {useMemo, useRef, useState} from "react";

import {
  estimateScope,
  loadPreviewRecords,
  matchingIndexes,
  matchingShards,
  searchRecords,
  type SearchMode,
} from "../data";
import {downloadExport, type ExportFormat} from "../exports";
import {
  projectRecordUnits,
  type RecordUnit,
} from "../recordUnits";
import {Link} from "../routing";
import type {AppData, SearchRecord} from "../types";

const FIELDS = [
  "id",
  "text_id",
  "standard",
  "original",
  "translations",
  "tokens",
  "phonology",
  "glosses",
  "language_id",
  "corpus_id",
  "dialect",
  "source_path",
  "audio",
];

function size(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function DatasetBuilder({data}: {data: AppData}) {
  const [languageId, setLanguageId] = useState("");
  const [corpusId, setCorpusId] = useState("");
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<SearchMode>("exact");
  const [recordUnit, setRecordUnit] = useState<RecordUnit>("sentence");
  const [format, setFormat] = useState<ExportFormat>("csv");
  const [maxRows, setMaxRows] = useState(1_000);
  const [fields, setFields] = useState<string[]>(FIELDS.slice(0, 8));
  const [preview, setPreview] = useState<SearchRecord[]>([]);
  const [busy, setBusy] = useState<"preview" | "export" | null>(null);
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
  const indexes = useMemo(
    () => matchingIndexes(data.search, languageId, corpusId),
    [corpusId, data.search, languageId],
  );
  const estimate = useMemo(() => estimateScope(shards), [shards]);
  const selectedCorpora = corpusId
    ? data.corpora.filter((corpus) => corpus.id === corpusId)
    : corpora;
  const rightsById = new Map(data.rights.entries.map((entry) => [entry.id, entry]));
  const blockedRights = selectedCorpora
    .map((corpus) => rightsById.get(corpus.rights_id))
    .filter((entry) => entry && entry.redistribution !== "allowed");
  const overMemoryBudget = estimate.uncompressedBytes > 1024 ** 3;

  async function recordsForExport(signal: AbortSignal): Promise<SearchRecord[]> {
    let sourceRecords: SearchRecord[];
    if (query.trim()) {
      if (estimate.uncompressedBytes > 512 * 1024 ** 2) {
        throw new Error(
          "A filtered browser export would scan more than 512 MiB. Narrow the corpus or use a prepared package.",
        );
      }
      sourceRecords = (
        await searchRecords(shards, query.trim(), mode, signal, maxRows, indexes)
      ).records;
    } else {
      sourceRecords = await loadPreviewRecords(shards, signal, maxRows);
    }
    return projectRecordUnits(sourceRecords, recordUnit).slice(0, maxRows);
  }

  async function runPreview() {
    if (!languageId) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy("preview");
    setError("");
    try {
      const sourceRecords = query.trim()
        ? (
            await searchRecords(
              shards,
              query.trim(),
              mode,
              next.signal,
              12,
              indexes,
            )
          ).records
        : await loadPreviewRecords(shards, next.signal, 12);
      setPreview(projectRecordUnits(sourceRecords, recordUnit).slice(0, 12));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controller.current === next) setBusy(null);
    }
  }

  async function runExport() {
    if (!languageId || fields.length === 0) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy("export");
    setError("");
    try {
      const records = await recordsForExport(next.signal);
      await downloadExport(
        records,
        {
          releaseId: data.meta.release_id,
          query: query.trim(),
          mode,
          languageId,
          corpusId,
          fields,
          recordUnit,
        },
        format,
        next.signal,
      );
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controller.current === next) setBusy(null);
    }
  }

  return (
    <section className="builder">
      <div className="builder__steps">
        <div>
          <span>01</span>
          <strong>Scope</strong>
        </div>
        <div>
          <span>02</span>
          <strong>Fields</strong>
        </div>
        <div>
          <span>03</span>
          <strong>Preview</strong>
        </div>
        <div>
          <span>04</span>
          <strong>Export</strong>
        </div>
      </div>
      <div className="builder__grid">
        <div className="builder__controls">
          <h2>Build a bounded linguistic dataset</h2>
          <div className="form-grid">
            <label className="field">
              Language
              <select
                value={languageId}
                onChange={(event) => {
                  setLanguageId(event.target.value);
                  setCorpusId("");
                  setPreview([]);
                }}
              >
                <option value="">Choose a display language…</option>
                {data.languages.map((language) => (
                  <option value={language.id} key={language.id}>
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
                  <option value={corpus.id} key={corpus.id}>
                    {corpus.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="field">
              Record unit
              <select
                value={recordUnit}
                onChange={(event) => {
                  setRecordUnit(event.target.value as RecordUnit);
                  setPreview([]);
                }}
              >
                <option value="text">Text</option>
                <option value="sentence">Sentence</option>
                <option value="word">Word</option>
                <option value="morpheme">Morpheme</option>
                <option value="token">Token</option>
                <option value="audio">Audio reference</option>
              </select>
            </label>
            <label className="field">
              Optional query
              <input
                value={query}
                maxLength={256}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Leave blank for the first rows in source order"
              />
            </label>
            <label className="field">
              Query mode
              <select value={mode} onChange={(event) => setMode(event.target.value as SearchMode)}>
                <option value="source">Source exact</option>
                <option value="exact">Normalized exact</option>
                <option value="prefix">Prefix</option>
                <option value="contains">Contains</option>
                <option value="translation">Translation</option>
                <option value="phonology">Phonology</option>
                <option value="gloss">Morpheme or gloss</option>
                <option value="fuzzy">Fuzzy</option>
                <option value="regex">Scoped RE2</option>
              </select>
            </label>
          </div>
          <fieldset className="field-checks">
            <legend>Included fields</legend>
            {FIELDS.map((field) => (
              <label key={field}>
                <input
                  type="checkbox"
                  checked={fields.includes(field)}
                  onChange={() =>
                    setFields((current) =>
                      current.includes(field)
                        ? current.filter((value) => value !== field)
                        : [...current, field],
                    )
                  }
                />
                {field}
              </label>
            ))}
          </fieldset>
          <div className="form-grid">
            <label className="field">
              Output row cap
              <select
                value={maxRows}
                onChange={(event) => setMaxRows(Number(event.target.value))}
              >
                <option value={1000}>1,000</option>
                <option value={5000}>5,000</option>
                <option value={10000}>10,000</option>
              </select>
            </label>
            <label className="field">
              Format
              <select
                value={format}
                onChange={(event) => setFormat(event.target.value as ExportFormat)}
              >
                <option value="csv">CSV</option>
                <option value="tsv">TSV</option>
                <option value="json">JSON</option>
                <option value="jsonl">JSON Lines</option>
                <option value="parquet">Parquet via DuckDB-Wasm</option>
                <option value="plain">Plain text</option>
                <option value="interlinear">Interlinear text</option>
                <option value="audio">Audio references</option>
                <option value="recipe">Reproducible recipe</option>
              </select>
            </label>
          </div>
          <div className="button-row">
            <button
              className="button button--quiet"
              disabled={!languageId || Boolean(busy)}
              onClick={runPreview}
            >
              {busy === "preview" ? "Loading preview…" : "Preview"}
            </button>
            <button
              className="button button--primary"
              disabled={
                !languageId ||
                fields.length === 0 ||
                Boolean(busy) ||
                overMemoryBudget ||
                (blockedRights.length > 0 && format !== "recipe")
              }
              onClick={runExport}
            >
              {busy === "export" ? "Preparing export…" : "Download"}
            </button>
            {busy && (
              <button className="text-button" onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        </div>
        <aside className="builder__estimate">
          <p className="eyebrow">Selection estimate</p>
          <dl>
            <div>
              <dt>Source sentences in scope</dt>
              <dd>{estimate.records.toLocaleString()}</dd>
            </div>
            <div>
              <dt>Network transfer</dt>
              <dd>{size(estimate.compressedBytes)}</dd>
            </div>
            <div>
              <dt>Decoded input</dt>
              <dd>{size(estimate.uncompressedBytes)}</dd>
            </div>
            <div>
              <dt>{recordUnit} row bound</dt>
              <dd>{Math.min(maxRows, estimate.records).toLocaleString()} rows</dd>
            </div>
          </dl>
          <p>
            The estimate covers source shards, not the final file. Queries may return fewer
            rows. Word, morpheme, token, and audio totals are known after the bounded source
            records load. Ordering follows source path and tier order.
          </p>
          {overMemoryBudget && (
            <p className="callout callout--warning">
              This scope exceeds the 1 GiB browser safety limit. Narrow it or use a prepared
              download.
            </p>
          )}
          {blockedRights.length > 0 && (
            <p className="callout callout--warning">
              Data export is disabled because at least one corpus does not have a reviewed
              redistribution decision. A recipe may still be saved.
            </p>
          )}
          <Link to="/downloads">Browse prepared packages →</Link>
        </aside>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      {preview.length > 0 && (
        <div className="builder__preview">
          <h2>Preview in deterministic source order</h2>
          <p>
            Showing {preview.length.toLocaleString()} projected {recordUnit} row
            {preview.length === 1 ? "" : "s"}. Empty units mean the selected source lacks that
            structure.
          </p>
          <div className="table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>
                  <th>Source form</th>
                  <th>Translation</th>
                  <th>Corpus</th>
                  <th>Locator</th>
                </tr>
              </thead>
              <tbody>
                {preview.map((record) => (
                  <tr key={record.id}>
                    <td>{record.standard || record.original}</td>
                    <td>{record.translations.map((item) => item.text).join(" | ")}</td>
                    <td>
                      {data.corpora.find((corpus) => corpus.id === record.corpus_id)?.name}
                    </td>
                    <td>
                      <code>{record.xml_id}</code>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
}
