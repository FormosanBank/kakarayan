import {useRef, useState} from "react";

import {useI18n} from "../i18n";

export interface ApiEndpoint {
  path: string;
  description: string;
}

export function ApiExplorer({base, endpoints}: {base: string; endpoints: ApiEndpoint[]}) {
  const {number, tx} = useI18n();
  const [path, setPath] = useState(endpoints[0]?.path ?? "meta.json");
  const [response, setResponse] = useState("");
  const [bytes, setBytes] = useState(0);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const url = `${base}/${path}`;

  async function load() {
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setBusy(true);
    setStatus("");
    setResponse("");
    try {
      const result = await fetch(url, {signal: next.signal});
      if (!result.ok) throw new Error(`HTTP ${result.status}`);
      const text = await result.text();
      const formatted = JSON.stringify(JSON.parse(text) as unknown, null, 2);
      setBytes(new TextEncoder().encode(text).byteLength);
      setResponse(formatted.slice(0, 30_000));
      setStatus(
        formatted.length > 30_000
          ? tx("Preview truncated at 30,000 characters. Open the endpoint for the complete response.", "預覽於 30,000 字元處截斷。請開啟端點查看完整回應。")
          : tx("Complete response shown.", "已顯示完整回應。"),
      );
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
        <p className="eyebrow">{tx("Executable documentation", "可執行文件")}</p>
        <h2>{tx("Inspect a release endpoint", "檢視版本端點")}</h2>
        <p>{tx("Fetch the same static JSON your application will receive. No token or backend is involved.", "取得應用程式會收到的相同靜態 JSON。不需要權杖或後端。")}</p>
      </div>
      <div className="api-explorer__controls">
        <label className="field">
          {tx("Endpoint", "端點")}
          <select value={path} onChange={(event) => {
            setPath(event.target.value);
            setResponse("");
            setStatus("");
          }}>
            {endpoints.map((endpoint) => <option key={endpoint.path} value={endpoint.path}>{endpoint.path}</option>)}
          </select>
        </label>
        <code>{url}</code>
        <button className="button button--primary" disabled={busy} onClick={load}>
          {busy ? tx("Loading…", "載入中…") : tx("Run request", "執行請求")}
        </button>
        {busy && <button className="text-button" onClick={() => controller.current?.abort()}>{tx("Cancel", "取消")}</button>}
      </div>
      {status && <p className="tool-note" role="status">{status}</p>}
      {response && (
        <div className="api-explorer__response">
          <div>
            <span>HTTP 200 · application/json · {number(bytes)} bytes</span>
            <div className="button-row">
              <button className="text-button" onClick={() => copy(url, tx("Endpoint URL copied.", "已複製端點網址。"))}>{tx("Copy URL", "複製網址")}</button>
              <button className="text-button" onClick={() => copy(response, tx("Shown JSON copied.", "已複製顯示的 JSON。"))}>{tx("Copy shown JSON", "複製顯示的 JSON")}</button>
              <a href={url}>{tx("Open complete response", "開啟完整回應")}</a>
            </div>
          </div>
          <pre tabIndex={0}><code>{response}</code></pre>
        </div>
      )}
    </section>
  );
}
