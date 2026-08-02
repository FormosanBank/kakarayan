import {useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData, ModelEntry} from "../types";

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

function languageNames(model: ModelEntry, data: AppData): string {
  const repository = model.repository.toLowerCase();
  return model.languages.map((iso) => {
    const matches = data.languages.filter((language) => language.iso639_3 === iso);
    if (matches.length < 2) return matches[0]?.name ?? iso;
    if (repository.includes("taroko")) return "Truku";
    if (repository.includes("seediq")) return "Seediq";
    return matches.map((language) => language.name).join(" / ");
  }).join(" · ");
}

export function Models({data}: {data: AppData}) {
  const {number, t, tx} = useI18n();
  const [task, setTask] = useState<"all" | "translation" | "automatic-speech-recognition">(
    "all",
  );
  const models = useMemo(
    () => data.models.models.filter((model) => task === "all" || model.task === task),
    [data.models.models, task],
  );
  const translationCount = data.models.models.filter((model) => model.task === "translation").length;
  const asrCount = data.models.models.length - translationCount;

  return (
    <div className="page-wrap">
      <PageIntro title={t("models.title")} lede={t("models.lede")} />
      <div className="model-notes">
        <p>
          {tx(
            "Metadata is read from public Hugging Face model cards. Unknown means the card did not provide a structured value.",
            "中繼資料取自公開的 Hugging Face 模型卡。未知表示模型卡未提供結構化值。",
          )}
        </p>
        <p>
          {tx(
            "Machine output is a draft, not expert review or evidence of community endorsement.",
            "機器輸出僅為草稿，不是專家審查，也不代表社群認可。",
          )}
        </p>
      </div>
      <div className="model-toolbar">
        <div className="segmented">
          <button aria-pressed={task === "all"} onClick={() => setTask("all")}>
            {tx("All", "全部")} <span>{number(data.models.models.length)}</span>
          </button>
          <button aria-pressed={task === "translation"} onClick={() => setTask("translation")}>
            MT <span>{number(translationCount)}</span>
          </button>
          <button
            aria-pressed={task === "automatic-speech-recognition"}
            onClick={() => setTask("automatic-speech-recognition")}
          >
            ASR <span>{number(asrCount)}</span>
          </button>
        </div>
        <span>{number(models.length)} {tx("models", "個模型")}</span>
      </div>
      <div className="model-grid">
        {models.map((model) => {
          const service = data.models.services.find((item) => item.id === model.browser_service_id);
          return (
            <article key={model.id}>
              <div className="model-card__top">
                <span className="task-mark">{model.task === "translation" ? "MT" : "ASR"}</span>
                <StatusBadge value={service?.status ?? "unavailable"} />
              </div>
              <h2>{model.repository.split("/")[1]}</h2>
              <p className="model-direction">
                {model.direction ?? languageNames(model, data)}
              </p>
              {model.direction && (
                <p className="model-languages">{languageNames(model, data)}</p>
              )}
              <dl className="model-summary">
                <div>
                  <dt>{tx("License", "授權")}</dt>
                  <dd>{model.license}</dd>
                </div>
                <div>
                  <dt>{tx("Updated", "更新日期")}</dt>
                  <dd>{model.last_modified?.slice(0, 10) ?? tx("unknown", "未知")}</dd>
                </div>
                <div>
                  <dt>{tx("Framework", "框架")}</dt>
                  <dd>{model.framework}</dd>
                </div>
              </dl>
              <div className="model-card__links">
                <a href={model.url} target="_blank" rel="noreferrer">
                  {tx("Open model card", "開啟模型卡")}
                </a>
                <details>
                  <summary>{tx("Metadata and limitations", "中繼資料與限制")}</summary>
                  <dl className="model-details">
                    <div><dt>{tx("Model family", "模型系列")}</dt><dd>{model.model_family}</dd></div>
                    <div><dt>{tx("Repository size", "儲存庫大小")}</dt><dd>{size(model.artifact_bytes)}</dd></div>
                    <div><dt>{tx("Browser service", "瀏覽器服務")}</dt><dd>{service?.status ?? tx("not registered", "未登錄")}</dd></div>
                    <div><dt>{tx("Service checked", "服務檢查時間")}</dt><dd>{service?.checked_at ?? tx("not checked", "未檢查")}</dd></div>
                  </dl>
                  <p><strong>{tx("Intended use:", "預定用途：")}</strong> {model.intended_use}</p>
                  <p><strong>{tx("License evidence:", "授權證據：")}</strong> {model.license_source}</p>
                  {model.training_lineage && <p><strong>{tx("Training lineage:", "訓練來源：")}</strong> {model.training_lineage}</p>}
                  <p><strong>{tx("Limitations:", "限制：")}</strong> {model.limitations}</p>
                  {model.evaluation_metrics.length > 0 && (
                    <ul>
                      {model.evaluation_metrics.map((metric, index) => (
                        <li key={`${metric.name}-${index}`}>{metric.name}: <code>{String(metric.value)}</code></li>
                      ))}
                    </ul>
                  )}
                  <a
                    href={`https://github.com/FormosanBank/kakarayan/issues/new?title=${encodeURIComponent(
                      `Model metadata: ${model.repository}`,
                    )}`}
                  >
                    {tx("Report a metadata problem", "回報中繼資料問題")}
                  </a>
                </details>
              </div>
            </article>
          );
        })}
      </div>
      {!models.length && (
        <div className="empty-state">
          {tx("No public models are registered for this task.", "此任務沒有登錄公開模型。")}
        </div>
      )}
      <section className="service-register">
        <h2>{tx("Optional public services", "選用公開服務")}</h2>
        <p>
          {tx(
            "Opening a Space leaves Kakarayan. Text or audio submitted there is processed by Hugging Face under its terms.",
            "開啟 Space 後會離開 Kakarayan。提交的文字或音訊將由 Hugging Face 依其條款處理。",
          )}
        </p>
        {data.models.services.map((service) => (
          <article key={service.id}>
            <div>
              <strong>{service.space}</strong>
              <p>{service.tasks.map((value) => value === "translation" ? "MT" : "ASR").join(" · ")} · {number(service.supported_languages.length)} {tx("languages", "種語言")}</p>
            </div>
            <StatusBadge value={service.status} />
            <a href={service.url}>{tx("Open Space", "開啟 Space")}</a>
          </article>
        ))}
      </section>
    </div>
  );
}
