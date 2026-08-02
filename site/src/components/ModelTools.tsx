import {useEffect, useMemo, useRef, useState, type FormEvent} from "react";

import {translate, type ServiceStage, type TranslationRequest} from "../modelServices";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import {manualStudyCard, saveCard} from "../study";
import type {Language, ModelCatalog} from "../types";

const directions: TranslationRequest["direction"][] = [
  "Formosan → English",
  "English → Formosan",
  "Formosan → Chinese",
  "Chinese → Formosan",
];

function serviceLanguageName(language: Language | undefined, supported: string[]): string {
  if (!language) return "";
  const aliases: Record<string, string> = {Truku: "Taroko", Yami: "Yami / Tao"};
  const candidate = aliases[language.name] ?? language.name;
  return supported.includes(candidate) ? candidate : language.name;
}

export function TranslationTool({
  catalog,
  languages,
  selectedLanguageId,
  selectedDialect,
  onLanguageChange,
}: {
  catalog: ModelCatalog;
  languages: Language[];
  selectedLanguageId: string;
  selectedDialect: string;
  onLanguageChange: (languageId: string) => void;
}) {
  const {number, tx} = useI18n();
  const [text, setText] = useState("");
  const [direction, setDirection] =
    useState<TranslationRequest["direction"]>("English → Formosan");
  const [consent, setConsent] = useState(false);
  const [result, setResult] = useState("");
  const [metadata, setMetadata] = useState("");
  const [stage, setStage] = useState<ServiceStage | "idle">("idle");
  const [status, setStatus] = useState("");
  const controller = useRef<AbortController | null>(null);
  const language = languages.find((item) => item.id === selectedLanguageId) ?? languages[0];
  const service = catalog.services.find(
    (item) =>
      item.tasks.includes("translation") &&
      item.api_name &&
      (!language ||
        !item.supported_languages.length ||
        item.supported_languages.includes(serviceLanguageName(language, item.supported_languages)) ||
        item.supported_languages.includes(language.iso639_3)),
  );
  const serviceReady = Boolean(service?.api_name && service.status !== "unavailable");
  const model = useMemo(
    () => catalog.models.find(
      (item) =>
        item.task === "translation" &&
        item.direction === direction.replaceAll("Chinese", "Mandarin") &&
        language &&
        item.languages.includes(language.iso639_3),
    ),
    [catalog.models, direction, language],
  );

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
        {
          text: text.trim(),
          direction,
          language: serviceLanguageName(language, service.supported_languages),
          dialect: selectedDialect || "Default / unknown",
        },
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

  async function copyResult() {
    try {
      await navigator.clipboard.writeText(result);
      setStatus(tx("Machine output copied.", "已複製機器輸出。"));
    } catch {
      setStatus(tx("Clipboard access was unavailable.", "無法存取剪貼簿。"));
    }
  }

  async function saveResult() {
    if (!language || !result) return;
    const sourceIsFormosan = direction.startsWith("Formosan");
    await saveCard(manualStudyCard({
      front: sourceIsFormosan ? text : result,
      back: sourceIsFormosan ? result : text,
      languageId: language.id,
      deck: "Machine translation drafts",
      tags: ["machine-draft", selectedDialect, model?.id ?? ""].filter(Boolean),
    }));
    setStatus(tx("Draft saved to the local deck and labelled as machine output.", "草稿已儲存到本機牌組，並標示為機器輸出。"));
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
            <select value={language?.id ?? ""} onChange={(event) => onLanguageChange(event.target.value)}>
              {languages.map((value) => (
                <option key={value.id} value={value.id}>{value.name}</option>
              ))}
            </select>
          </label>
          <label className="field">
            {tx("Dialect", "方言")}
            <input value={selectedDialect || tx("Default / unknown", "預設／未知")} readOnly />
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
          <div className="button-row">
            <button className="button button--quiet" onClick={copyResult}>{tx("Copy", "複製")}</button>
            <button className="button button--quiet" onClick={saveResult}>{tx("Save as labelled draft", "儲存為已標示草稿")}</button>
            {language && (
              <Link
                className="button button--quiet"
                to={`/lookup?type=sentences&q=${encodeURIComponent(result)}&language=${encodeURIComponent(language.id)}&mode=exact`}
              >
                {tx("Check in corpus", "在語料庫中核對")}
              </Link>
            )}
          </div>
        </div>
      )}
      {language && (
        <div className="model-disclosure model-disclosure--summary">
          <strong>{tx("Selected capability", "所選功能")}</strong>
          <span>{model ? model.repository : tx("No language-specific MT model is registered.", "沒有登錄此語言專用的機器翻譯模型。")}</span>
          {model && <span>{tx("License", "授權")} {model.license} · {model.limitations}</span>}
          <Link to={`/lookup?type=sentences&language=${encodeURIComponent(language.id)}&mode=translation`}>
            {tx("Search human corpus translations", "搜尋人工語料翻譯")}
          </Link>
        </div>
      )}
    </section>
  );
}
