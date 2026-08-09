import {useMemo, useRef, useState} from "react";

import type {AnalysisResult, CountRow} from "../analysis";
import {runAnalysis} from "../analysisClient";
import {estimateScope, loadScopeRecords, matchingShards} from "../data";
import {useI18n} from "../i18n";
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
  const {number, tx} = useI18n();
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
  const analysisRows = Math.min(estimate.records, 50_000);

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
          <h2>{tx("Scoped linguistic summaries", "限定範圍的語言學摘要")}</h2>
          <p>
            {tx(
              "Descriptive corpus counts are not claims about speakers, vitality, grammaticality, or population-wide language use.",
              "描述性的語料數量並不代表使用者人數、語言活力、合語法性或整體人口的語言使用情況。",
            )}
          </p>
        </div>
        <div className="form-grid">
          <label className="field">
            {tx("Language", "語言")}
            <select
              value={languageId}
              onChange={(event) => {
                setLanguageId(event.target.value);
                setCorpusId("");
                setResult(null);
              }}
            >
              <option value="">{tx("Choose…", "請選擇…")}</option>
              {data.languages.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tx("Corpus", "語料庫")}
            <select
              value={corpusId}
              disabled={!languageId}
              onChange={(event) => {
                setCorpusId(event.target.value);
                setResult(null);
              }}
            >
              <option value="">{tx("All compatible corpora", "所有相容語料庫")}</option>
              {corpora.map((corpus) => (
                <option key={corpus.id} value={corpus.id}>
                  {corpus.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tx("N-gram size", "N-gram 大小")}
            <select value={ngramSize} onChange={(event) => setNgramSize(Number(event.target.value))}>
              {[1, 2, 3, 4, 5].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tx("Collocate token", "搭配詞詞元")}
            <input
              value={collocate}
              maxLength={80}
              onChange={(event) => setCollocate(event.target.value)}
              placeholder={tx("±2 tokens", "前後各 2 個詞元")}
            />
          </label>
          <label className="field">
            {tx("Sample seed", "抽樣種子")}
            <input
              value={seed}
              maxLength={80}
              onChange={(event) => setSeed(event.target.value)}
            />
          </label>
        </div>
        <p className="tool-note">
          {!languageId
            ? tx("Choose a language to see the analysis scope.", "請選擇語言以查看分析範圍。")
            : (
              <>
                {tx("Available scope:", "可用範圍：")} {number(estimate.records)} {tx("sentences", "句")}
                {tx(", ", "，")}{(estimate.uncompressedBytes / 1024 / 1024).toFixed(1)} MiB {tx("decoded", "解碼後")}.
                {" "}{estimate.records > 50_000
                  ? tx(
                      `This browser run analyzes the first ${number(analysisRows)} sentences in deterministic source order. Use prepared data for the full scope.`,
                      `此次瀏覽器分析會依固定來源順序處理前 ${number(analysisRows)} 句。完整範圍請使用預備資料。`,
                    )
                  : tx("The complete selected scope will be analyzed.", "將分析完整的選定範圍。")}
              </>
            )}
        </p>
        <div className="button-row">
          <button
            className="button button--primary"
            disabled={!languageId || busy}
            onClick={run}
          >
            {busy ? tx("Computing in worker…", "背景執行緒計算中…") : tx("Compute summaries", "計算摘要")}
          </button>
          {busy && (
            <button className="text-button" onClick={() => controller.current?.abort()}>
              {tx("Cancel", "取消")}
            </button>
          )}
          {languageId && estimate.records > 50_000 && <Link to="/downloads">{tx("Open full prepared data →", "開啟完整預備資料 →")}</Link>}
        </div>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      {result && (
        <>
          <div className="summary-stats">
            <div>
              <strong>{number(result.records)}</strong>
              <span>{tx("sentences", "句子")}</span>
            </div>
            <div>
              <strong>{number(result.tokens)}</strong>
              <span>{tx("tokens", "詞元")}</span>
            </div>
            <div>
              <strong>{number(result.sourceTypes)}</strong>
              <span>{tx("source-exact types", "來源完全相符類型")}</span>
            </div>
            <div>
              <strong>{number(result.normalizedTypes)}</strong>
              <span>{tx("normalized types", "正規化類型")}</span>
            </div>
            <div>
              <strong>
                {result.tokens ? (result.normalizedTypes / result.tokens).toFixed(3) : "0"}
              </strong>
              <span>{tx("type/token ratio", "類型／詞元比")}</span>
            </div>
          </div>
          <div className="summary-tabs" role="tablist" aria-label={tx("Summary table", "摘要表")}>
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
                {{
                  source: tx("source", "來源"),
                  normalized: tx("normalized", "正規化"),
                  translation: tx("translation", "翻譯"),
                  distribution: tx("distribution", "分布"),
                  ngrams: "n-grams",
                  collocates: tx("collocates", "搭配詞"),
                }[value]}
              </button>
            ))}
          </div>
          <div className="summary-export">
            <span>
              {tx("Seed", "種子")} <code>{result.seed}</code> · {tx("deterministic sample", "可重現樣本")}{" "}
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
                  <th>{tx("Count", "數量")}</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.value}>
                    <td>{row.value}</td>
                    <td>{number(row.count)}</td>
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
