import {useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

function size(bytes: number | null): string {
  if (bytes === null) return "not reported";
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function Models({data}: {data: AppData}) {
  const {t} = useI18n();
  const [task, setTask] = useState<"all" | "translation" | "automatic-speech-recognition">(
    "all",
  );
  const models = useMemo(
    () => data.models.models.filter((model) => task === "all" || model.task === task),
    [data.models.models, task],
  );
  return (
    <div className="page-wrap">
      <PageIntro title={t("models.title")} lede={t("models.lede")} />
      <p className="callout callout--info">
        Model metadata comes from public Hugging Face cards. Public model cards may disclose
        private training lineage; Kakarayan does not access or package that private data.
      </p>
      <div className="segmented">
        <button aria-pressed={task === "all"} onClick={() => setTask("all")}>
          All <span>{data.models.models.length}</span>
        </button>
        <button aria-pressed={task === "translation"} onClick={() => setTask("translation")}>
          MT
        </button>
        <button
          aria-pressed={task === "automatic-speech-recognition"}
          onClick={() => setTask("automatic-speech-recognition")}
        >
          ASR
        </button>
      </div>
      <div className="model-grid">
        {models.map((model) => {
          const service = data.models.services.find(
            (item) => item.id === model.browser_service_id,
          );
          return (
            <article key={model.id}>
              <div className="model-card__top">
                <span className="task-mark">{model.task === "translation" ? "MT" : "ASR"}</span>
                <StatusBadge value={service?.status ?? "unavailable"} />
              </div>
              <h2>{model.repository.split("/")[1]}</h2>
              <p className="model-direction">
                {model.direction ?? model.languages.join(" · ")}
              </p>
              <dl>
                <div>
                  <dt>License</dt>
                  <dd>{model.license}</dd>
                </div>
                <div>
                  <dt>Updated</dt>
                  <dd>{model.last_modified?.slice(0, 10) ?? "unknown"}</dd>
                </div>
                <div>
                  <dt>Languages</dt>
                  <dd>{model.languages.length}</dd>
                </div>
                <div>
                  <dt>Framework</dt>
                  <dd>{model.framework}</dd>
                </div>
                <div>
                  <dt>Model family</dt>
                  <dd>{model.model_family}</dd>
                </div>
                <div>
                  <dt>Repository size</dt>
                  <dd>{size(model.artifact_bytes)}</dd>
                </div>
                <div>
                  <dt>Browser tool</dt>
                  <dd>{service ? service.status : "not registered"}</dd>
                </div>
              </dl>
              <p>
                <strong>Intended use from metadata:</strong> {model.intended_use}
              </p>
              <p>
                <strong>License evidence:</strong> {model.license_source}
              </p>
              {model.training_lineage && <p className="lineage">{model.training_lineage}</p>}
              <p>{model.limitations}</p>
              {model.evaluation_metrics.length > 0 && (
                <details>
                  <summary>Structured evaluation metrics</summary>
                  <ul>
                    {model.evaluation_metrics.map((metric, index) => (
                      <li key={`${metric.name}-${index}`}>
                        {metric.name}: <code>{String(metric.value)}</code>
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              <div className="model-card__links">
                <a href={model.url} target="_blank" rel="noreferrer">
                  Public model card
                </a>
                <a
                  href={`https://github.com/FormosanBank/kakarayan/issues/new?title=${encodeURIComponent(
                    `Model metadata: ${model.repository}`,
                  )}`}
                >
                  Report metadata problem
                </a>
              </div>
              <small>
                Service check: {service?.checked_at ?? "not automatically checked in this release"}
              </small>
            </article>
          );
        })}
      </div>
      {!models.length && (
        <div className="empty-state">
          No public models were registered in this release. Corpus tools still work.
        </div>
      )}
      <section className="service-register">
        <h2>Optional public services</h2>
        {data.models.services.map((service) => (
          <article key={service.id}>
            <div>
              <strong>{service.space}</strong>
              <p>{service.third_party_notice}</p>
            </div>
            <StatusBadge value={service.status} />
            <a href={service.url}>Open Space</a>
          </article>
        ))}
      </section>
    </div>
  );
}
