import {useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

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
              </dl>
              {model.training_lineage && <p className="lineage">{model.training_lineage}</p>}
              <p>{model.limitations}</p>
              <a href={model.url} target="_blank" rel="noreferrer">
                Public model card →
              </a>
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
