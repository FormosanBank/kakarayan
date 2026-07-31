import {useEffect, useRef, useState, type FormEvent} from "react";

import {translate, type ServiceStage, type TranslationRequest} from "../modelServices";
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
  const service = catalog.services.find((item) => item.space === "FormosanBank/formosan-mt");

  useEffect(() => () => controller.current?.abort(), []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!consent || !text.trim()) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setResult("");
    setMetadata("");
    try {
      const output = await translate(
        {text: text.trim(), direction, language, dialect},
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
        setStatus("Request cancelled. Your input remains in this browser.");
      } else {
        setStage("error");
        setStatus(
          `${cause instanceof Error ? cause.message : String(cause)} Use corpus translation search while the public service is unavailable.`,
        );
      }
    }
  }

  return (
    <section className="model-tool" aria-labelledby="translation-heading">
      <div className="tool-heading">
        <div>
          <p className="eyebrow">Optional public service</p>
          <h3 id="translation-heading">Machine translation</h3>
        </div>
        <span className="status status--unchecked">{service?.status ?? "unavailable"}</span>
      </div>
      <p>
        Results are machine-generated drafts, not reviewed Amis. Corpus translation search
        remains available when this service is asleep.
      </p>
      <form onSubmit={submit}>
        <div className="tool-grid">
          <label className="field">
            Direction
            <select
              value={direction}
              onChange={(event) =>
                setDirection(event.target.value as TranslationRequest["direction"])
              }
            >
              {directions.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Formosan language
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {languages.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Dialect
            <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
              <option>Default / unknown</option>
              <option>Coastal</option>
              <option>Hengchun</option>
              <option>Malan</option>
              <option>Southern</option>
              <option>Xiuguluan</option>
            </select>
          </label>
        </div>
        <label className="field">
          Text
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            maxLength={1500}
            rows={5}
          />
          <small>{text.length}/1500 characters</small>
        </label>
        <label className="consent">
          <input
            type="checkbox"
            checked={consent}
            onChange={(event) => setConsent(event.target.checked)}
          />
          <span>
            Send this text directly to the public FormosanBank Space on Hugging Face. Hugging
            Face may process infrastructure logs under its terms.
          </span>
        </label>
        <div className="button-row">
          <button
            className="button button--primary"
            disabled={!consent || !text.trim() || !["idle", "complete", "cancelled", "error"].includes(stage)}
          >
            Translate
          </button>
          {!["idle", "complete", "cancelled", "error"].includes(stage) && (
            <button
              className="button button--quiet"
              type="button"
              onClick={() => controller.current?.abort()}
            >
              Cancel
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
          <span>Machine output</span>
          <p>{result}</p>
          {metadata && <small>{metadata}</small>}
        </div>
      )}
    </section>
  );
}

