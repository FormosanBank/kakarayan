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
  const {number, t, tx} = useI18n();
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
        {tx(
          "Model metadata comes from public Hugging Face cards. Public model cards may disclose private training lineage; Kakarayan does not access or package that private data.",
          "模型中繼資料來自公開的 Hugging Face 模型卡。公開模型卡可能揭露私有訓練資料的來源脈絡；Kakarayan 不會存取或打包該私有資料。",
        )}
      </p>
      <div className="segmented">
        <button aria-pressed={task === "all"} onClick={() => setTask("all")}>
          {tx("All", "全部")} <span>{number(data.models.models.length)}</span>
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
                  <dt>{tx("License", "授權")}</dt>
                  <dd>{model.license}</dd>
                </div>
                <div>
                  <dt>{tx("Updated", "更新日期")}</dt>
                  <dd>{model.last_modified?.slice(0, 10) ?? tx("unknown", "未知")}</dd>
                </div>
                <div>
                  <dt>{tx("Languages", "語言")}</dt>
                  <dd>{number(model.languages.length)}</dd>
                </div>
                <div>
                  <dt>{tx("Framework", "框架")}</dt>
                  <dd>{model.framework}</dd>
                </div>
                <div>
                  <dt>{tx("Model family", "模型系列")}</dt>
                  <dd>{model.model_family}</dd>
                </div>
                <div>
                  <dt>{tx("Repository size", "儲存庫大小")}</dt>
                  <dd>{size(model.artifact_bytes)}</dd>
                </div>
                <div>
                  <dt>{tx("Browser tool", "瀏覽器工具")}</dt>
                  <dd>{service ? service.status : tx("not registered", "未登錄")}</dd>
                </div>
              </dl>
              <p>
                <strong>{tx("Intended use from metadata:", "中繼資料所載預定用途：")}</strong>{" "}
                {model.intended_use}
              </p>
              <p>
                <strong>{tx("License evidence:", "授權證據：")}</strong> {model.license_source}
              </p>
              {model.training_lineage && <p className="lineage">{model.training_lineage}</p>}
              <p>{model.limitations}</p>
              {model.evaluation_metrics.length > 0 && (
                <details>
                  <summary>{tx("Structured evaluation metrics", "結構化評估指標")}</summary>
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
                  {tx("Public model card", "公開模型卡")}
                </a>
                <a
                  href={`https://github.com/FormosanBank/kakarayan/issues/new?title=${encodeURIComponent(
                    `Model metadata: ${model.repository}`,
                  )}`}
                >
                  {tx("Report metadata problem", "回報中繼資料問題")}
                </a>
              </div>
              <small>
                {tx("Service check:", "服務檢查：")}{" "}
                {service?.checked_at ?? tx("not automatically checked in this release", "此版本未自動檢查")}
              </small>
            </article>
          );
        })}
      </div>
      {!models.length && (
        <div className="empty-state">
          {tx(
            "No public models were registered in this release. Corpus tools still work.",
            "此版本沒有登錄公開模型，語料工具仍可正常使用。",
          )}
        </div>
      )}
      <section className="service-register">
        <h2>{tx("Optional public services", "選用公開服務")}</h2>
        {data.models.services.map((service) => (
          <article key={service.id}>
            <div>
              <strong>{service.space}</strong>
              <p>{service.third_party_notice}</p>
            </div>
            <StatusBadge value={service.status} />
            <a href={service.url}>{tx("Open Space", "開啟 Space")}</a>
          </article>
        ))}
      </section>
    </div>
  );
}
