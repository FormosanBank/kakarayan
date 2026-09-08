import {useEffect, useRef, useState} from "react";

import {summaries} from "../apiClient";
import {apiErrorMessage, isAbortError} from "../apiErrors";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData} from "../types";
import {LoadingState} from "./LoadingState";
import {Tabs} from "./Tabs";

type SummaryResult = Awaited<ReturnType<typeof summaries>>;
type TableKind = "source" | "normalized" | "translation" | "distribution";
const TABLE_KINDS: TableKind[] = ["source", "normalized", "translation", "distribution"];

function rows(result: SummaryResult, kind: TableKind) {
  return {
    source: result.source_frequencies,
    normalized: result.normalized_frequencies,
    translation: result.translation_frequencies,
    distribution: result.distributions,
  }[kind];
}

function download(values: Array<{value: string; count: number}>, kind: TableKind) {
  const csv = `value,count\n${values.map(({value, count}) => `"${(/^[=+@\-\t\r]/u.test(value) ? `'${value}` : value).replaceAll('"', '""')}",${count}`).join("\n")}\n`;
  const url = URL.createObjectURL(new Blob([csv], {type: "text/csv;charset=utf-8"}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `kakarayan-${kind}.csv`;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Summaries({data, active = true}: {data: AppData; active?: boolean}) {
  const {languageName, number, tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const language = data.languages.find((item) => item.id === (params.get("summary_language") ?? params.get("language")));
  const languageId = language?.id ?? "";
  const corpusId = data.corpora.find((item) => item.id === params.get("summary_corpus") && item.languages.includes(languageId))?.id ?? "";
  const dialect = language?.dialects.find((value) => value === params.get("summary_dialect")) ?? "";
  const kind = TABLE_KINDS.find((value) => value === params.get("summary_table")) ?? "source";
  const scope = JSON.stringify([data.meta.release_id, languageId, corpusId, dialect]);
  const [state, setState] = useState<{scope: string; busy: boolean; result: SummaryResult | null; error: string} | null>(null);
  const current = state?.scope === scope ? state : null;
  const result = current?.result ?? null;
  const busy = current?.busy ?? false;
  const error = current?.error ?? "";
  const controller = useRef<AbortController | null>(null);
  const corpora = data.corpora.filter((corpus) => !languageId || corpus.languages.includes(languageId));

  useEffect(() => () => controller.current?.abort(), [scope, active]);

  function select(values: Record<string, string>) {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(values)) next.set(`summary_${key}`, value);
    setParams(next);
  }

  async function run() {
    if (!languageId || !active) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setState({scope, busy: true, error: "", result: null});
    try {
      const value = await summaries(data.meta.release_id, languageId, corpusId, dialect, next.signal);
      if (!next.signal.aborted && controller.current === next) setState({scope, busy: false, error: "", result: value});
    } catch (cause) {
      if (!next.signal.aborted && !isAbortError(cause) && controller.current === next) {
        setState({scope, busy: false, error: apiErrorMessage(cause, tx), result: null});
      }
    } finally {
      if (next.signal.aborted && controller.current === next) setState(null);
    }
  }

  const currentRows = result ? rows(result, kind) : [];
  const tableLabel = (value: TableKind) => ({
    source: tx("Source forms", "來源形式"),
    normalized: tx("Normalized forms", "正規化形式"),
    translation: tx("Translations", "翻譯"),
    distribution: tx("Distribution", "分布"),
  })[value];
  return (
    <section className="summaries">
      <div className="summary-controls">
        <h2>{tx("Corpus summaries", "語料摘要")}</h2>
        <div className="form-grid">
          <label className="field">
            {tx("Language", "語言")}
            <select value={languageId} onChange={(event) => select({language: event.target.value, corpus: "", dialect: ""})}>
              <option value="">{tx("Choose…", "請選擇…")}</option>
              {data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
            </select>
          </label>
          <label className="field">
            {tx("Corpus", "語料庫")}
            <select value={corpusId} disabled={!languageId} onChange={(event) => select({corpus: event.target.value})}>
              <option value="">{tx("All compatible corpora", "所有相容語料庫")}</option>
              {corpora.map((corpus) => <option key={corpus.id} value={corpus.id}>{corpus.name}</option>)}
            </select>
          </label>
          <label className="field">
            {tx("Dialect", "方言")}
            <select value={dialect} disabled={!languageId} onChange={(event) => select({dialect: event.target.value})}>
              <option value="">{tx("All dialects", "所有方言")}</option>
              {language?.dialects.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </label>
        </div>
        <div className="button-row">
          <button className="button button--primary" disabled={!languageId || busy || !data.query.available} onClick={() => void run()}>
            {busy ? tx("Computing…", "計算中…") : tx("Compute summaries", "計算摘要")}
          </button>
          {busy && (
            <button className="text-button" type="button" onClick={() => controller.current?.abort()}>
              {tx("Cancel", "取消")}
            </button>
          )}
        </div>
      </div>
      {error && (
        <div className="callout callout--error callout--action">
          <span>{error}</span>
          <button className="text-button" type="button" onClick={() => void run()}>
            {tx("Try again", "重試")}
          </button>
        </div>
      )}
      {busy && (
        <LoadingState
          columns={[tx("Form", "形式"), tx("Count", "數量")]}
          kind="table"
          label={tx("Computing corpus summary", "正在計算語料摘要")}
        />
      )}
      {result && (
        <>
          <div className="summary-stats">
            <div><strong>{number(result.sentences)}</strong><span>{tx("sentences", "句子")}</span></div>
            <div><strong>{number(result.tokens)}</strong><span>{tx("tokens", "詞元")}</span></div>
            <div><strong>{number(result.source_types)}</strong><span>{tx("source forms", "來源形式")}</span></div>
            <div><strong>{number(result.normalized_types)}</strong><span>{tx("normalized forms", "正規化形式")}</span></div>
          </div>
          <Tabs items={TABLE_KINDS.map((value) => [value, tableLabel(value)])} value={kind}
            onChange={(table) => select({table})} prefix="summary" panelId="summary-panel" className="summary-tabs"
            label={tx("Summary table", "摘要表格")} />
          <div className="summary-export"><button onClick={() => download(currentRows, kind)}>CSV</button></div>
          <div className="table-scroll" tabIndex={0} role="tabpanel" id="summary-panel" aria-labelledby={`summary-tab-${kind}`}>
            <table className="summary-table" id="summary-table">
              <colgroup><col /><col className="summary-table__count" /></colgroup>
              <thead><tr><th scope="col">{tableLabel(kind)}</th><th scope="col">{tx("Count", "數量")}</th></tr></thead><tbody>
              {currentRows.map((row) => <tr key={row.value}><td>{row.value}</td><td>{number(row.count)}</td></tr>)}
              </tbody>
            </table>
          </div>
        </>
      )}
    </section>
  );
}
