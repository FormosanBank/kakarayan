import {useMemo, useRef, useState, type FormEvent} from "react";

import {useI18n} from "../i18n";
import type {Language, MatchMode, SearchDirection} from "../types";
import {CodeLines, RequestExamples} from "./DeveloperCode";
import {LoadingState} from "./LoadingState";

type QueryRoute = "dictionary" | "concordance";
const PLAYGROUND_TIMEOUT_MS = 12_000;

export function ApiExplorer({
  available,
  base,
  languages,
  releaseId,
}: {
  available: boolean;
  base: string;
  languages: Language[];
  releaseId: string;
}) {
  const {languageName, number, tx} = useI18n();
  const defaultLanguage = languages.find((language) => language.id === "lang_amis")?.id
    ?? languages[0]?.id
    ?? "";
  const [route, setRoute] = useState<QueryRoute>("dictionary");
  const [query, setQuery] = useState("lima");
  const [languageId, setLanguageId] = useState(defaultLanguage);
  const [direction, setDirection] = useState<SearchDirection>("formosan");
  const [translationLanguage, setTranslationLanguage] = useState("eng");
  const [match, setMatch] = useState<MatchMode>("exact");
  const [limit, setLimit] = useState(5);
  const [response, setResponse] = useState("");
  const [bytes, setBytes] = useState(0);
  const [httpStatus, setHttpStatus] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const request = useMemo(() => {
    const endpoint = new URL(
      `/v1/releases/${encodeURIComponent(releaseId)}/${route}`,
      `${base}/`,
    );
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("language_id", languageId);
    endpoint.searchParams.set("direction", direction);
    endpoint.searchParams.set("match", match);
    endpoint.searchParams.set("limit", String(limit));
    if (direction === "translation" && translationLanguage.trim()) {
      endpoint.searchParams.set("translation_language", translationLanguage.trim());
    }
    return {
      parameters: [...endpoint.searchParams.entries()],
      path: endpoint.pathname,
      url: endpoint.toString(),
    };
  }, [base, direction, languageId, limit, match, query, releaseId, route, translationLanguage]);

  async function load(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setStatus("");
    setResponse("");
    setHttpStatus(0);
    let timedOut = false;
    const timeout = window.setTimeout(() => {
      timedOut = true;
      next.abort();
    }, PLAYGROUND_TIMEOUT_MS);
    try {
      const result = await fetch(request.url, {
        headers: {Accept: "application/json", "X-Kakarayan-Client": "developer-playground-v1"},
        signal: next.signal,
      });
      const text = await result.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        // Preserve a non-JSON proxy response so the developer can inspect it.
      }
      setBytes(new TextEncoder().encode(text).byteLength);
      setHttpStatus(result.status);
      setResponse(formatted.slice(0, 30_000));
      if (!result.ok) {
        setStatus(tx(`Request returned HTTP ${result.status}.`, `請求回傳 HTTP ${result.status}。`));
      } else if (formatted.length > 30_000) {
        setStatus(tx("Preview truncated at 30,000 characters.", "預覽於 30,000 字元處截斷。"));
      } else {
        setStatus(tx("Request complete.", "請求完成。"));
      }
    } catch (cause) {
      if (timedOut) {
        setStatus(tx("Request timed out after 12 seconds. Narrow the query or try again.", "請求在 12 秒後逾時。請縮小查詢範圍或重試。"));
      } else if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
      window.clearTimeout(timeout);
      if (controller.current === next) setBusy(false);
    }
  }

  async function copy(value: string, message: string) {
    try {
      await navigator.clipboard.writeText(value);
      setStatus(message);
    } catch {
      setStatus(tx("Clipboard access was unavailable.", "無法存取剪貼簿。"));
    }
  }

  return (
    <section className="api-explorer" aria-labelledby="api-playground-title">
      <div className="section-heading api-explorer__heading">
        <div>
          <h2 id="api-playground-title">{tx("API playground", "API 測試工具")}</h2>
          <p>{tx("Build a request and inspect the response.", "建立請求並檢視回應。")}</p>
        </div>
        <span className="api-explorer__release"><span>release</span> {releaseId}</span>
      </div>
      <div className="api-explorer__workspace">
        <form className="api-explorer__request" onSubmit={load}>
          <div className="api-pane-heading">
            <h3>{tx("Request", "請求")}</h3>
            <span>GET · JSON</span>
          </div>
          <fieldset className="api-route-picker">
            <legend>{tx("Endpoint", "端點")}</legend>
            <div>
              <button type="button" aria-pressed={route === "dictionary"} onClick={() => setRoute("dictionary")}>
                {tx("Dictionary", "詞典")}
              </button>
              <button type="button" aria-pressed={route === "concordance"} onClick={() => setRoute("concordance")}>
                {tx("Sentences", "句子")}
              </button>
            </div>
          </fieldset>
          <div className="api-explorer__fields">
            <label className="field field--api-wide">
              {tx("Query", "查詢")}
              <input required maxLength={2048} value={query} onChange={(event) => setQuery(event.target.value)} />
            </label>
            <label className="field field--api-wide">
              {tx("Formosan language", "臺灣南島語")}
              <select required value={languageId} onChange={(event) => setLanguageId(event.target.value)}>
                {languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
              </select>
            </label>
            <label className="field">
              {tx("Search in", "搜尋範圍")}
              <select value={direction} onChange={(event) => setDirection(event.target.value as SearchDirection)}>
                <option value="formosan">{tx("Formosan text", "臺灣南島語文本")}</option>
                <option value="translation">{tx("Translations", "翻譯")}</option>
              </select>
            </label>
            <label className="field">
              {tx("Match", "比對方式")}
              <select value={match} onChange={(event) => setMatch(event.target.value as MatchMode)}>
                <option value="exact">{tx("Exact", "完全相符")}</option>
                <option value="prefix">{tx("Prefix", "前綴")}</option>
                <option value="contains">{tx("Contains", "包含")}</option>
              </select>
            </label>
            <label className="field">
              {tx("Results", "結果數")}
              <select value={limit} onChange={(event) => setLimit(Number(event.target.value))}>
                {[5, 25, 100, 250, 500, 1000].map((value) => <option key={value} value={value}>{number(value)}</option>)}
              </select>
            </label>
            {direction === "translation" && (
              <label className="field">
                {tx("Translation language tag", "翻譯語言標籤")}
                <input maxLength={32} value={translationLanguage} onChange={(event) => setTranslationLanguage(event.target.value)} />
              </label>
            )}
          </div>
          <div className="api-request-preview" aria-label={tx("Generated request", "產生的請求")}>
            <div className="api-request-preview__route">
              <span>GET</span>
              <code>{request.path}</code>
            </div>
            <dl>
              {request.parameters.map(([key, value]) => (
                <div key={key}><dt>{key}</dt><dd>{value}</dd></div>
              ))}
            </dl>
          </div>
          <div className="api-explorer__actions">
            <button className="button button--primary" disabled={busy || !available} type="submit">
              {busy ? tx("Requesting…", "請求中…") : tx("Run request", "執行請求")}
            </button>
            {busy && <button className="text-button" type="button" onClick={() => controller.current?.abort()}>{tx("Cancel", "取消")}</button>}
            <button className="text-button" type="button" onClick={() => void copy(request.url, tx("Request URL copied.", "已複製請求網址。"))}>{tx("Copy URL", "複製網址")}</button>
          </div>
          {!available && <p className="tool-note" role="status">{tx("The query service is unavailable.", "查詢服務目前無法使用。")}</p>}
        </form>
        <section className="api-explorer__response" aria-labelledby="api-response-title">
          <div className="api-pane-heading">
            <h3 id="api-response-title">{tx("Response", "回應")}</h3>
            <span>
              {busy
                ? tx("waiting", "等待中")
                : httpStatus
                  ? `HTTP ${httpStatus} · ${number(bytes)} bytes`
                  : tx("not run", "尚未執行")}
            </span>
          </div>
          {busy ? (
            <LoadingState
              kind="code"
              label={tx("Waiting for API response", "正在等待 API 回應")}
            />
          ) : response ? (
            <>
              <div className="api-explorer__response-actions">
                <button className="text-button" type="button" onClick={() => void copy(response, tx("Response copied.", "已複製回應。"))}>{tx("Copy response", "複製回應")}</button>
                <a href={request.url} target="_blank" rel="noreferrer">{tx("Open JSON", "開啟 JSON")}</a>
              </div>
              <CodeLines label={tx("JSON response", "JSON 回應")} value={response} />
            </>
          ) : (
            <div className="api-explorer__empty">
              <span>{"{ }"}</span>
              <p>{tx("Run the request to inspect its JSON response.", "執行請求以檢視 JSON 回應。")}</p>
            </div>
          )}
          {status && <p className="api-explorer__status" role="status">{status}</p>}
        </section>
      </div>
      <RequestExamples url={request.url} />
    </section>
  );
}
