import {ApiExplorer} from "../components/ApiExplorer";
import {PageIntro} from "../components/Layout";
import {
  DATASET_FIELD_INFO,
  DATASET_FIELDS_BY_LEVEL,
  DATASET_LEVEL_INFO,
} from "../datasetSelection";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Developers({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const endpoints = [
    "meta.json",
    "releases.json",
    "languages.json",
    "corpora.json",
    "rights.json",
    "models.json",
    "orthography.json",
    "content.json",
    "downloads.json",
  ];
  const staticBase = `${window.location.origin}${import.meta.env.BASE_URL}api/v1`;
  return (
    <div className="page-wrap page-wrap--wide developer-page">
      <PageIntro title={t("developers.title")} />
      <section className="developer-services" aria-label={tx("API services", "API 服務")}>
        <article>
          <div className="developer-services__name">
            <h2>{tx("Live query API", "即時查詢 API")}</h2>
            <span className={`status status--${data.query.available ? "available" : "unavailable"}`}>
              {data.query.available ? tx("available", "可用") : tx("unavailable", "無法使用")}
            </span>
          </div>
          <div className="developer-services__address">
            <code>{data.query.baseUrl}/v1/releases/{data.meta.release_id}/</code>
          </div>
          <nav aria-label={tx("Live API links", "即時 API 連結")}>
            <a href={`${data.query.baseUrl}/docs`}>{tx("API reference", "API 參考")}</a>
            <a href={`${data.query.baseUrl}/openapi.json`}>OpenAPI</a>
          </nav>
        </article>
        <article>
          <div className="developer-services__name">
            <h2>{tx("Static metadata", "靜態中繼資料")}</h2>
            <span className="status status--available">{tx("release-pinned", "固定版本")}</span>
          </div>
          <div className="developer-services__address">
            <code>{staticBase}/meta.json</code>
          </div>
          <nav aria-label={tx("Static API links", "靜態 API 連結")}>
            <a href={`${import.meta.env.BASE_URL}api/v1/meta.json`}>{tx("Open metadata", "開啟中繼資料")}</a>
          </nav>
        </article>
      </section>
      <ApiExplorer
        available={data.query.available}
        base={data.query.baseUrl}
        languages={data.languages}
        releaseId={data.meta.release_id}
      />
      <section className="endpoint-section">
        <div className="section-heading"><h2>{tx("Static JSON endpoints", "靜態 JSON 端點")}</h2></div>
        <div className="endpoint-list">
          {endpoints.map((endpoint) => (
            <article key={endpoint}>
              <code>GET /api/v1/{endpoint}</code>
              <a href={`${import.meta.env.BASE_URL}api/v1/${endpoint}`}>{tx("Open JSON", "開啟 JSON")}</a>
            </article>
          ))}
        </div>
      </section>
      <section className="data-contract">
        <div className="section-heading"><h2>{tx("XML dataset rows", "XML 資料集列")}</h2></div>
        {DATASET_LEVEL_INFO.map(([level, code, label, labelZh]) => (
          <details className="data-contract__level" key={level} open={level === "sentence"}>
            <summary><code>{code}</code> {tx(label, labelZh)}</summary>
            <dl className="data-contract__list">
              {DATASET_FIELDS_BY_LEVEL[level].map((field) => (
                <div key={field}><dt><code>{field}</code></dt><dd>{tx(DATASET_FIELD_INFO[field][0], DATASET_FIELD_INFO[field][1])}</dd></div>
              ))}
            </dl>
          </details>
        ))}
      </section>
      <section className="contract-notes">
        <h2>{tx("Contract rules", "介面契約規則")}</h2>
        <ul>
          <li>{tx("Pin release ", "固定版本 ")}<code>{data.meta.release_id}</code>{tx(" and the source commit in published work.", " 與來源提交於出版成果中。")}</li>
          <li>{tx("Keep original and FormosanBank standard forms separate.", "將原始形式與 FormosanBank 標準形式分開。")}</li>
          <li>{tx(
            "Selecting translations creates separate fields such as translation_eng_1 and translation_zho_1.",
            "選擇 translations 會建立分開的欄位，例如 translation_eng_1 與 translation_zho_1。",
          )}</li>
          <li>{tx("Follow every rights ID referenced by a downloaded artifact.", "遵守下載成品引用的每一項權利識別碼。")}</li>
        </ul>
      </section>
    </div>
  );
}
