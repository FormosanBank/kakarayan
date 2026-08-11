import {useMemo, useRef, useState} from "react";

import {summaries} from "../apiClient";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

type SummaryResult = Awaited<ReturnType<typeof summaries>>;
type TableKind = "source" | "normalized" | "translation" | "distribution";

function rows(result: SummaryResult, kind: TableKind) {
  return {
    source: result.source_frequencies,
    normalized: result.normalized_frequencies,
    translation: result.translation_frequencies,
    distribution: result.distributions,
  }[kind];
}

function download(values: Array<{value: string; count: number}>, kind: TableKind) {
  const csv = `value,count\n${values.map(({value, count}) => `"${value.replaceAll('"', '""')}",${count}`).join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kakarayan-${kind}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Summaries({data}: {data: AppData}) {
  const {languageName, number, tx} = useI18n();
  const [languageId, setLanguageId] = useState("");
  const [corpusId, setCorpusId] = useState("");
  const [kind, setKind] = useState<TableKind>("source");
  const [result, setResult] = useState<SummaryResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const controller = useRef<AbortController | null>(null);
  const corpora = useMemo(
    () => data.corpora.filter((corpus) => !languageId || corpus.languages.includes(languageId)),
    [data.corpora, languageId],
  );

  async function run() {
    if (!languageId) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setError("");
    try {
      setResult(await summaries(data.meta.release_id, languageId, corpusId, next.signal));
    } catch (cause) {
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      if (controller.current === next) setBusy(false);
    }
  }

  const currentRows = result ? rows(result, kind) : [];
  return (
    <section className="summaries">
      <div className="summary-controls">
        <h2>{tx("Corpus summaries", "語料摘要")}</h2>
        <div className="form-grid">
          <label className="field">
            {tx("Language", "語言")}
            <select value={languageId} onChange={(event) => { setLanguageId(event.target.value); setCorpusId(""); setResult(null); }}>
              <option value="">{tx("Choose…", "請選擇…")}</option>
              {data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
            </select>
          </label>
          <label className="field">
            {tx("Corpus", "語料庫")}
            <select value={corpusId} disabled={!languageId} onChange={(event) => { setCorpusId(event.target.value); setResult(null); }}>
              <option value="">{tx("All compatible corpora", "所有相容語料庫")}</option>
              {corpora.map((corpus) => <option key={corpus.id} value={corpus.id}>{corpus.name}</option>)}
            </select>
          </label>
        </div>
        <button className="button button--primary" disabled={!languageId || busy || !data.query.available} onClick={() => void run()}>
          {busy ? tx("Computing…", "計算中…") : tx("Compute summaries", "計算摘要")}
        </button>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      {result && (
        <>
          <div className="summary-stats">
            <div><strong>{number(result.sentences)}</strong><span>{tx("sentences", "句子")}</span></div>
            <div><strong>{number(result.tokens)}</strong><span>{tx("tokens", "詞元")}</span></div>
            <div><strong>{number(result.source_types)}</strong><span>{tx("source forms", "來源形式")}</span></div>
            <div><strong>{number(result.normalized_types)}</strong><span>{tx("normalized forms", "正規化形式")}</span></div>
          </div>
          <div className="summary-tabs" role="tablist">
            {(["source", "normalized", "translation", "distribution"] as TableKind[]).map((value) => (
              <button key={value} role="tab" aria-selected={kind === value} onClick={() => setKind(value)}>{value}</button>
            ))}
          </div>
          <div className="summary-export"><button onClick={() => download(currentRows, kind)}>CSV</button></div>
          <div className="table-scroll" tabIndex={0}>
            <table><thead><tr><th>{kind}</th><th>{tx("Count", "數量")}</th></tr></thead><tbody>
              {currentRows.map((row) => <tr key={row.value}><td>{row.value}</td><td>{number(row.count)}</td></tr>)}
            </tbody></table>
          </div>
        </>
      )}
    </section>
  );
}
