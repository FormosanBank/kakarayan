import {useEffect, useRef, useState, type FormEvent} from "react";

import {translate, type ServiceStage, type TranslationRequest} from "../modelServices";
import {useI18n} from "../i18n";
import type {ModelCatalog} from "../types";

const directions: TranslationRequest["direction"][] = [
  "Formosan → English",
  "English → Formosan",
  "Formosan → Chinese",
  "Chinese → Formosan",
];

const languages = [
  "Amis",
  "Atayal",
  "Bunun",
  "Kanakanavu",
  "Kavalan",
  "Paiwan",
  "Puyuma",
  "Rukai",
  "Saaroa",
  "Saisiyat",
  "Sakizaya",
  "Seediq",
  "Thao",
  "Tsou",
  "Tao / Yami",
];

export function TranslationTool({catalog}: {catalog: ModelCatalog}) {
  const {number, tx} = useI18n();
  const [text, setText] = useState("");
  const [direction, setDirection] =
    useState<TranslationRequest["direction"]>("English → Formosan");
  const [language, setLanguage] = useState("Amis");
  const [dialect, setDialect] = useState("Default / unknown");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState("");
  const [metadata, setMetadata] = useState("");
  const [stage, setStage] = useState<ServiceStage | "idle">("idle");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const service = catalog.services.find(
    (item) => item.tasks.includes("translation") && item.api_name,
  );
  const serviceReady = Boolean(service?.api_name && service.status !== "unavailable");

  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!consent || !text.trim() || !service?.api_name || !serviceReady) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setResult("");
    setMetadata("");
    try {
      const output = await translate(
        {text: text.trim(), direction, language, dialect},
        {space: service.space, endpoint: service.api_name},
        {
          signal: next.signal,
          onStage: (nextStage, message) => {
            setStage(nextStage);
            setStatus(message ?? "");
          },
        },
      );
      setResult(output.text);
      setMetadata(output.metadata);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setStage("cancelled");
        setStatus(tx("Request cancelled. Your input remains in this browser.", "已取消請求。輸入內容仍保留在此瀏覽器。"));
      } else {
        setStage("error");
        setStatus(
          `${cause instanceof Error ? cause.message : String(cause)} ${tx("Use corpus translation search while the public service is unavailable.", "公開服務無法使用時，請改用語料翻譯搜尋。")}`,
        );
      }
    }
  }

  return (
    <section className="model-tool" aria-labelledby="translation-heading">
      <div className="tool-heading">
        <div>
          <p className="eyebrow">{tx("Optional public service", "選用公開服務")}</p>
          <h3 id="translation-heading">{tx("Machine translation", "機器翻譯")}</h3>
        </div>
        <span className={`status status--${service?.status ?? "unavailable"}`}>
          {service?.status ?? "unavailable"}
        </span>
      </div>
      <p>
        {tx(
          "Results are machine-generated drafts. Use sentence search for translations found in the corpus.",
          "結果是機器產生的草稿。請使用例句搜尋查看語料庫中的翻譯。",
        )}
      </p>
      <form onSubmit={submit}>
        <div className="tool-grid">
          <label className="field">
            {tx("Direction", "方向")}
            <select
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value as TranslationRequest["direction"])
              }
            >
              {directions.map((value) => (
                <option key={value} value={value}>
                  {{
                    "Formosan → English": tx("Formosan → English", "南島語 → 英文"),
                    "English → Formosan": tx("English → Formosan", "英文 → 南島語"),
                    "Formosan → Chinese": tx("Formosan → Chinese", "南島語 → 中文"),
                    "Chinese → Formosan": tx("Chinese → Formosan", "中文 → 南島語"),
                  }[value]}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            {tx("Formosan language", "臺灣南島語")}
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {languages.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {tx("Dialect", "方言")}
            <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
              <option value="Default / unknown">{tx("Default / unknown", "預設／未知")}</option>
              <option value="Coastal">{tx("Coastal", "海岸")}</option>
              <option value="Hengchun">{tx("Hengchun", "恆春")}</option>
              <option value="Malan">{tx("Malan", "馬蘭")}</option>
              <option value="Southern">{tx("Southern", "南勢")}</option>
              <option value="Xiuguluan">{tx("Xiuguluan", "秀姑巒")}</option>
            </select>
          </label>
        </div>
        <label className="field">
          {tx("Text", "文字")}
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1500}
            rows={5}
          />
          <small>{number(text.length)}/1,500 {tx("characters", "字元")}</small>
        </label>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            {tx(
              "Send this text directly to the public FormosanBank Space on Hugging Face. Hugging Face may process infrastructure logs under its terms.",
              "將此文字直接傳送到 Hugging Face 上公開的 FormosanBank Space。Hugging Face 可能依其條款處理基礎設施日誌。",
            )}
          </span>
        </label>
        <div className="button-row">
          <button
            className="button button--primary"
            disabled={
              !serviceReady ||
              !consent ||
              !text.trim() ||
              !["idle", "complete", "cancelled", "error"].includes(stage)
            }
          >
            {tx("Translate", "翻譯")}
          </button>
          {!["idle", "complete", "cancelled", "error"].includes(stage) && (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              {tx("Cancel", "取消")}
            </button>
          )}
        </div>
      </form>
      {status && (
        <p className={`callout callout--${stage === "error" ? "error" : "info"}`} role="status">
          {status}
        </p>
      )}
      {result && (
        <div className="machine-output">
          <span>{tx("Machine output", "機器輸出")}</span>
          <p>{result}</p>
          {metadata && <small>{metadata}</small>}
        </div>
      )}
    </section>
  );
}
