import {useMemo, useRef, useState, type FormEvent} from "react";

import {useI18n} from "../i18n";
import type {Language, MatchMode, SearchDirection} from "../types";

type QueryRoute = "dictionary" | "concordance";

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
  const [response, setResponse] = useState("");
  const [bytes, setBytes] = useState(0);
  const [httpStatus, setHttpStatus] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);

  const url = useMemo(() => {
    const endpoint = new URL(
      `/v1/releases/${encodeURIComponent(releaseId)}/${route}`,
      `${base}/`,
    );
    endpoint.searchParams.set("q", query);
    endpoint.searchParams.set("language_id", languageId);
    endpoint.searchParams.set("direction", direction);
    endpoint.searchParams.set("match", match);
    endpoint.searchParams.set("limit", "5");
    if (direction === "translation" && translationLanguage.trim()) {
      endpoint.searchParams.set("translation_language", translationLanguage.trim());
    }
    return endpoint.toString();
  }, [base, direction, languageId, match, query, releaseId, route, translationLanguage]);

  async function load(event: FormEvent) {
    event.preventDefault();
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setStatus("");
    setResponse("");
    setHttpStatus(0);
    try {
      const result = await fetch(url, {
        headers: {Accept: "application/json", "X-Kakarayan-Client": "developer-playground-v1"},
        signal: next.signal,
      });
      const text = await result.text();
      let formatted = text;
      try {
        formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      } catch {
        // Keep a proxy error page readable when the response is not JSON.
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
      if (!(cause instanceof DOMException && cause.name === "AbortError")) {
        setStatus(cause instanceof Error ? cause.message : String(cause));
      }
    } finally {
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
    <section className="api-explorer">
      <div className="section-heading">
        <h2>{tx("Try the live API", "試用即時 API")}</h2>
        <p>{tx("Send a bounded, read-only request to the active corpus release.", "向目前語料版本傳送有限的唯讀請求。")}</p>
      </div>
      <form className="api-explorer__form" onSubmit={load}>
        <label className="field">
          {tx("Request", "請求")}
          <select value={route} onChange={(event) => setRoute(event.target.value as QueryRoute)}>
            <option value="dictionary">{tx("Dictionary", "詞典")}</option>
            <option value="concordance">{tx("Sentences", "句子")}</option>
          </select>
        </label>
        <label className="field">
          {tx("Query", "查詢")}
          <input required maxLength={256} value={query} onChange={(event) => setQuery(event.target.value)} />
        </label>
        <label className="field">
          {tx("Formosan language", "南島語言")}
          <select required value={languageId} onChange={(event) => setLanguageId(event.target.value)}>
            {languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
          </select>
        </label>
        <label className="field">
          {tx("Search field", "搜尋欄位")}
          <select value={direction} onChange={(event) => setDirection(event.target.value as SearchDirection)}>
            <option value="formosan">{tx("Formosan text", "南島語文本")}</option>
            <option value="translation">{tx("Translation", "翻譯")}</option>
          </select>
        </label>
        <label className="field">
          {tx("Match", "比對")}
          <select value={match} onChange={(event) => setMatch(event.target.value as MatchMode)}>
            <option value="exact">{tx("Exact", "完全相符")}</option>
            <option value="prefix">{tx("Prefix", "前綴")}</option>
            <option value="contains">{tx("Contains", "包含")}</option>
          </select>
        </label>
        {direction === "translation" && (
          <label className="field">
            {tx("Translation language tag", "翻譯語言標籤")}
            <input maxLength={32} value={translationLanguage} onChange={(event) => setTranslationLanguage(event.target.value)} />
          </label>
        )}
        <div className="api-explorer__endpoint">
          <span>{tx("GET request", "GET 請求")}</span>
          <code title={url}>{url}</code>
        </div>
        <div className="api-explorer__actions">
          <button className="button button--primary" disabled={busy || !available} type="submit">
            {busy ? tx("Requesting…", "請求中…") : tx("Run request", "執行請求")}
          </button>
          {busy && <button className="text-button" type="button" onClick={() => controller.current?.abort()}>{tx("Cancel", "取消")}</button>}
          <button className="text-button" type="button" onClick={() => copy(url, tx("Request URL copied.", "已複製請求網址。"))}>{tx("Copy URL", "複製網址")}</button>
        </div>
      </form>
      {!available && <p className="tool-note" role="status">{tx("The query service is not ready.", "查詢服務尚未就緒。")}</p>}
      {status && <p className="tool-note" role="status">{status}</p>}
      {response && (
        <div className="api-explorer__response">
          <div>
            <span>HTTP {httpStatus} · {number(bytes)} bytes</span>
            <div className="button-row">
              <button className="text-button" type="button" onClick={() => copy(response, tx("Shown response copied.", "已複製顯示的回應。"))}>{tx("Copy response", "複製回應")}</button>
              <a href={url}>{tx("Open response", "開啟回應")}</a>
            </div>
          </div>
          <pre tabIndex={0}><code>{response}</code></pre>
        </div>
      )}
    </section>
  );
}
