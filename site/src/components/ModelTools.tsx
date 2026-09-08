import {useEffect, useMemo, useRef, useState, type FormEvent} from "react";

import {translate, type ServiceStage, type TranslationRequest} from "../modelServices";
import {useI18n} from "../i18n";
import {Link, NavigationBlocker} from "../routing";
import {manualStudyCard, saveCard} from "../study";
import type {Language, ModelCatalog} from "../types";
import {StatusBadge} from "./Layout";

const directions: TranslationRequest["direction"][] = [
  "Formosan → English",
  "English → Formosan",
  "Formosan → Chinese",
  "Chinese → Formosan",
];

interface TranslationResult {
  text: string;
  metadata: string;
  request: Readonly<TranslationRequest>;
  languageId: string;
  modelId: string;
  contextKey: string;
}

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
  active = true,
}: {
  catalog: ModelCatalog;
  languages: Language[];
  selectedLanguageId: string;
  selectedDialect: string;
  active?: boolean;
}) {
  const {number, tx} = useI18n();
  const [text, setText] = useState("");
  const [direction, setDirection] =
    useState<TranslationRequest["direction"]>("English → Formosan");
  const contextKey = JSON.stringify([selectedLanguageId, selectedDialect, text, direction]);
  const [consentKey, setConsentKey] = useState<string | null>(null);
  const consent = consentKey === contextKey;
  const [savedResult, setResult] = useState<TranslationResult | null>(null);
  const result = savedResult?.contextKey === contextKey ? savedResult : null;
  const [stage, setStage] = useState<ServiceStage | "idle">("idle");
  const [status, setStatus] = useState("");
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const startedAt = useRef(0);
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

  useEffect(() => () => {
    controller.current?.abort();
    setConsentKey(null);
  }, [selectedLanguageId, selectedDialect, active]);
  const running = active && !["idle", "complete", "cancelled", "error"].includes(stage);
  useEffect(() => {
    if (!running) return;
    const update = () => setElapsedSeconds(Math.floor((performance.now() - startedAt.current) / 1000));
    const timer = window.setInterval(update, 1_000);
    return () => window.clearInterval(timer);
  }, [running]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!active || !consent || !text.trim() || !language || !service?.api_name || !serviceReady) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    const request: Readonly<TranslationRequest> = Object.freeze({
      text: text.trim(), direction,
      language: serviceLanguageName(language, service.supported_languages),
      dialect: selectedDialect || "Default / unknown",
    });
    const languageId = language.id;
    const modelId = model?.id ?? "";
    next.signal.addEventListener("abort", () => {
      if (controller.current !== next) return;
      setStage("cancelled");
      setStatus(tx("Request cancelled.", "已取消請求。"));
      setConsentKey(null);
    }, {once: true});
    startedAt.current = performance.now();
    setElapsedSeconds(0);
    setResult(null);
    setConsentKey(null);
    setStage("connecting");
    try {
      const output = await translate(
        request,
        {space: service.space, endpoint: service.api_name},
        {
          signal: next.signal,
          onStage: (nextStage, message) => {
            if (next.signal.aborted || controller.current !== next) return;
            setStage(nextStage);
            if (nextStage === "connecting") {
              setStatus(
                message?.includes("waking")
                  ? tx("Waking the translation service…", "正在喚醒翻譯服務…")
                  : tx("Connecting to the translation service…", "正在連線至翻譯服務…"),
              );
            } else if (nextStage === "pending") {
              const position = message?.match(/\d+/u)?.[0];
              setStatus(
                position
                  ? tx(`Waiting in queue · position ${position}`, `正在排隊 · 第 ${position} 位`)
                  : tx("Waiting in the model queue…", "正在模型佇列中等待…"),
              );
            } else if (nextStage === "generating") {
              setStatus(tx("Translating…", "正在翻譯…"));
            } else {
              setStatus("");
            }
          },
        },
      );
      if (next.signal.aborted || controller.current !== next) return;
      setResult({...output, request, languageId, modelId, contextKey});
      setStage("complete");
    } catch (cause) {
      if (next.signal.aborted || controller.current !== next) return;
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setStage("cancelled");
        setStatus(tx("Request cancelled. Your input remains in this browser.", "已取消請求。輸入內容仍保留在此瀏覽器。"));
      } else {
        setStage("error");
        setStatus(
          `${cause instanceof Error ? cause.message : String(cause)} ${tx("Use corpus translation search while the public service is unavailable.", "公開服務無法使用時，請改用語料翻譯搜尋。")}`,
        );
      }
    } finally {
      if (controller.current === next) controller.current = null;
    }
  }

  async function copyResult() {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result.text);
      setStatus(tx("Machine output copied.", "已複製機器輸出。"));
    } catch {
      setStatus(tx("Clipboard access was unavailable.", "無法存取剪貼簿。"));
    }
  }

  async function saveResult() {
    if (!result) return;
    const sourceIsFormosan = result.request.direction.startsWith("Formosan");
    try {
      await saveCard(manualStudyCard({
        front: sourceIsFormosan ? result.request.text : result.text,
        back: sourceIsFormosan ? result.text : result.request.text,
        languageId: result.languageId,
        deck: tx("Machine translation drafts", "機器翻譯草稿"),
        tags: ["machine-draft", result.request.dialect, result.modelId].filter(Boolean),
      }));
      setStatus(tx("Draft saved to the local deck.", "草稿已儲存到本機牌組。"));
    } catch {
      setStatus(tx("Could not save. Your draft is still here.", "無法儲存。草稿仍保留在此。"));
    }
  }

  return (
    <section className="model-tool" aria-labelledby="translation-heading">
      <NavigationBlocker
        active={running}
        message={tx(
          "Translation is still running. Wait for it to finish before leaving. Leave and cancel it anyway?",
          "翻譯仍在進行中。請等待完成後再離開。仍要離開並取消翻譯嗎？",
        )}
      />
      <div className="tool-heading">
        <h3 id="translation-heading">{tx("Machine translation", "機器翻譯")}</h3>
        <StatusBadge value={service?.status ?? "unavailable"} />
      </div>
      <form onSubmit={submit}>
        <div className="tool-grid">
          <label className="field">
            {tx("Direction", "方向")}
            <select
              value={direction}
              onChange={(event) => {
                controller.current?.abort();
                setResult(null);
                setConsentKey(null);
                const value = directions.find((item) => item === event.target.value);
                if (value) setDirection(value);
              }}
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
            {tx("Dialect", "方言")}
            <input value={selectedDialect || tx("Default / unknown", "預設／未知")} readOnly />
          </label>
        </div>
        <label className="field">
          {tx("Text", "文字")}
          <textarea
            value={text}
            onChange={(event) => {
              controller.current?.abort();
              setResult(null);
              setConsentKey(null);
              setText(event.target.value);
            }}
            maxLength={1500}
            rows={5}
          />
          <small>{number(text.length)}/1,500 {tx("characters", "字元")}</small>
        </label>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsentKey(event.target.checked ? contextKey : null)}
          />
          <span>
            {tx(
              "I agree to send this text to FormosanBank MT on Hugging Face.",
              "我同意將此文字傳送到 Hugging Face 上的 FormosanBank 機器翻譯服務。",
            )}
          </span>
        </label>
        <p className="model-privacy-note">
          {tx(
            "Nothing is sent unless you check the box and press Translate. Kakarayan does not retain the request; Hugging Face processing and logging policies apply.",
            "除非勾選並按下「翻譯」，否則不會傳送任何內容。Kakarayan 不保留請求；資料處理與記錄依 Hugging Face 政策辦理。",
          )}{" "}
          <a href="https://huggingface.co/privacy">{tx("Privacy policy", "隱私權政策")}</a>
        </p>
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
      {running && (
        <div className="model-progress" role="status" aria-live="polite">
          <span className="model-progress__spinner" aria-hidden="true" />
          <div>
            <strong>{status}</strong>
            <small>{number(elapsedSeconds)} {tx("seconds elapsed", "秒")}</small>
          </div>
          <ol aria-label={tx("Translation progress", "翻譯進度") }>
            <li data-state={stage === "connecting" ? "current" : "complete"}>{tx("Connect", "連線")}</li>
            <li data-state={stage === "pending" ? "current" : stage === "connecting" ? "upcoming" : "complete"}>{tx("Queue", "排隊")}</li>
            <li data-state={stage === "generating" ? "current" : "upcoming"}>{tx("Translate", "翻譯")}</li>
          </ol>
        </div>
      )}
      {status && !running && (
        <p className={`callout callout--${stage === "error" ? "error" : "info"}`} role="status">
          {status}
        </p>
      )}
      {result && (
        <div className="machine-output">
          <span>{tx("Machine output", "機器輸出")}</span>
          <p>{result.text}</p>
          {result.metadata && <small>{result.metadata}</small>}
          <div className="button-row">
            <button className="button button--quiet" onClick={copyResult}>{tx("Copy", "複製")}</button>
            <button className="button button--quiet" onClick={saveResult}>{tx("Save as labelled draft", "儲存為已標示草稿")}</button>
            {language && (
              <Link
                className="button button--quiet"
                to={`/lookup?type=sentences&q=${encodeURIComponent(result.text)}&language=${encodeURIComponent(result.languageId)}&direction=${result.request.direction.startsWith("Formosan") ? "translation" : "formosan"}&target=${result.request.direction.endsWith("Chinese") ? "zho" : "eng"}&mode=contains`}
              >
                {tx("Check in corpus", "在語料庫中核對")}
              </Link>
            )}
          </div>
        </div>
      )}
      {language && (
        <div className="model-disclosure model-disclosure--summary">
          <strong>{tx("Model", "模型")}</strong>
          <span>{model ? model.repository : tx("No language-specific MT model is registered.", "沒有登錄此語言專用的機器翻譯模型。")}</span>
          {model && <span>{tx("License", "授權")} {model.license}</span>}
          <Link to={`/lookup?type=sentences&language=${encodeURIComponent(language.id)}&direction=translation&target=eng&mode=exact`}>
            {tx("Search human corpus translations", "搜尋人工語料翻譯")}
          </Link>
        </div>
      )}
    </section>
  );
}
