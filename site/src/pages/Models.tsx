import {useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData, ModelEntry} from "../types";

function size(bytes: number | null, missing: string): string {
  if (bytes === null) return missing;
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

function languageNames(
  model: ModelEntry,
  data: AppData,
  displayName: (language: AppData["languages"][number]) => string,
): string {
  const repository = model.repository.toLowerCase();
  return model.languages.map((iso) => {
    const matches = data.languages.filter((language) => language.iso639_3 === iso);
    if (matches.length < 2) return matches[0] ? displayName(matches[0]) : iso;
    if (repository.includes("taroko")) return "Truku";
    if (repository.includes("seediq")) return "Seediq";
    return matches.map(displayName).join(" / ");
  }).join(" · ");
}

function targetLanguageForModel(model: ModelEntry, data: AppData) {
  const matches = data.languages.filter((language) => model.languages.includes(language.iso639_3));
  const repository = model.repository.toLowerCase();
  if (repository.includes("taroko")) return matches.find((language) => language.name === "Truku");
  if (repository.includes("seediq")) return matches.find((language) => language.name === "Seediq");
  return matches[0];
}

export function Models({data}: {data: AppData}) {
  const {languageName, number, t, tx} = useI18n();
  const [task, setTask] = useState<"all" | "translation" | "automatic-speech-recognition">(
    "all",
  );
  const [languageId, setLanguageId] = useState("");
  const selectedLanguage = data.languages.find((language) => language.id === languageId);
  const models = useMemo(
    () => data.models.models.filter(
      (model) =>
        (task === "all" || model.task === task) &&
        (!selectedLanguage || model.languages.includes(selectedLanguage.iso639_3)),
    ),
    [data.models.models, selectedLanguage, task],
  );
  const translationCount = data.models.models.filter((model) => model.task === "translation").length;
  const asrCount = data.models.models.length - translationCount;
  const evaluatedCount = data.models.models.filter((model) => model.evaluation_metrics.length > 0).length;
  const licensedCount = data.models.models.filter((model) => model.license !== "unknown").length;
  const availableServices = data.models.services.filter((service) => service.status === "available").length;
  const statusLabels: Record<string, string> = {
    available: tx("available", "可用"),
    unavailable: tx("unavailable", "不可用"),
    unchecked: tx("unchecked", "未檢查"),
    sleeping: tx("sleeping", "休眠中"),
  };

  function directionLabel(direction: string | null): string | null {
    if (!direction) return null;
    return direction.split(" → ").map((part) => {
      if (part === "Mandarin" || part === "Chinese") return tx(part, "中文");
      const language = data.languages.find((item) => item.name === part);
      return language ? languageName(language) : part;
    }).join(" → ");
  }

  return (
    <div className="page-wrap">
      <PageIntro title={t("models.title")} />
      <dl className="model-coverage">
        <div><dt>{tx("Registered models", "登錄模型")}</dt><dd>{number(data.models.models.length)}</dd></div>
        <div><dt>{tx("Evaluation reported", "已提供評估")}</dt><dd>{number(evaluatedCount)}</dd></div>
        <div><dt>{tx("License identified", "已辨識授權")}</dt><dd>{number(licensedCount)}</dd></div>
        <div><dt>{tx("Available services", "可用服務")}</dt><dd>{number(availableServices)}</dd></div>
      </dl>
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
        <label className="field field--compact">
          {tx("Language coverage", "語言涵蓋")}
          <select value={languageId} onChange={(event) => setLanguageId(event.target.value)}>
            <option value="">{tx("All registered languages", "所有登錄語言")}</option>
            {data.languages.map((language) => <option key={language.id} value={language.id}>{languageName(language)}</option>)}
          </select>
        </label>
        <span>{number(models.length)} {tx("models", "個模型")}</span>
      </div>
      <div className="model-grid">
        {models.map((model) => {
          const service = data.models.services.find((item) => item.id === model.browser_service_id);
          const targetLanguage =
            (selectedLanguage && model.languages.includes(selectedLanguage.iso639_3)
              ? selectedLanguage
              : targetLanguageForModel(model, data));
          return (
            <article key={model.id}>
              <div className="model-card__top">
                <span className="task-mark">{model.task === "translation" ? "MT" : "ASR"}</span>
                <StatusBadge value={service?.status ?? "unavailable"} />
              </div>
              <h2>{model.repository.split("/")[1]}</h2>
              <p className="model-direction">
                {directionLabel(model.direction) ?? languageNames(model, data, languageName)}
              </p>
              {model.direction && (
                <p className="model-languages">{languageNames(model, data, languageName)}</p>
              )}
              <dl className="model-summary">
                <div>
                  <dt>{tx("License", "授權")}</dt>
                  <dd>{model.license === "unknown" ? tx("unknown", "未知") : model.license}</dd>
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
                {targetLanguage && (
                    <Link to={`/learn?language=${encodeURIComponent(targetLanguage.id)}&tool=${model.task === "translation" ? "translation" : "practice"}`}>
                      {model.task === "translation" ? tx("Use translation tool", "使用翻譯工具") : tx("Open ASR practice", "開啟語音辨識練習")}
                    </Link>
                )}
                <details>
                  <summary>{tx("Metadata and limitations", "中繼資料與限制")}</summary>
                  <dl className="model-details">
                    <div><dt>{tx("Model family", "模型系列")}</dt><dd>{model.model_family}</dd></div>
                    <div><dt>{tx("Repository size", "儲存庫大小")}</dt><dd>{size(model.artifact_bytes, tx("not reported", "未報告"))}</dd></div>
                    <div><dt>{tx("Browser service", "瀏覽器服務")}</dt><dd>{service ? statusLabels[service.status] ?? service.status : tx("not registered", "未登錄")}</dd></div>
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
          {tx("No models are registered for this task.", "此任務沒有登錄模型。")}
        </div>
      )}
      <section className="service-register">
        <h2>{tx("Services", "服務")}</h2>
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
