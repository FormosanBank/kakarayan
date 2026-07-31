import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Developers({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const endpoints = [
    ["meta.json", tx("Release, schema, and pinned source commit", "版本、結構描述與固定來源提交")],
    ["languages.json", tx("Display identities, capabilities, and counts", "顯示身分、功能與數量")],
    ["corpora.json", tx("Corpus scopes, rights IDs, and counts", "語料庫範圍、權利識別碼與數量")],
    ["rights.json", tx("Central and per-corpus rights policy", "中央及各語料庫權利政策")],
    ["models.json", tx("Public MT/ASR models and service registry", "公開機器翻譯／語音辨識模型與服務登錄")],
    ["orthography.json", tx("Reviewed conversion-table projections", "已審查的轉換表投影")],
    ["content.json", tx("Reviewed learning-content registry", "已審查的學習內容登錄")],
    ["search/manifest.json", tx("Immutable browser search shards", "不可變的瀏覽器搜尋分片")],
  ];
  const base = `${window.location.origin}${import.meta.env.BASE_URL}api/v1`;
  const liveApi = import.meta.env.VITE_LIVE_API_URL as string | undefined;
  return (
    <div className="page-wrap">
      <PageIntro title={t("developers.title")} lede={t("developers.lede")} />
      <section className="api-choice">
        <article className="api-choice__primary">
          <p className="eyebrow">{tx("Always available with the site", "隨網站一併提供")}</p>
          <h2>{tx("Static API v1", "靜態 API v1")}</h2>
          <p>
            {tx(
              "Best for catalogues, reproducible release metadata, manifests, and applications that can query local SQLite or shards.",
              "適合目錄、可重現版本中繼資料、清單，以及能查詢本機 SQLite 或分片的應用程式。",
            )}
          </p>
          <code>{base}/meta.json</code>
          <span className="status status--available">{tx("release-pinned", "固定版本")}</span>
        </article>
        <article>
          <p className="eyebrow">{tx("Optional no-cost service", "選用的免費服務")}</p>
          <h2>{tx("Live REST API", "即時 REST API")}</h2>
          <p>
            {tx(
              "Convenient bounded dictionary and concordance routes over the same release snapshot. The service may sleep. Static access remains canonical.",
              "以相同版本快照提供有界限的詞典與索引行路由。服務可能休眠，靜態存取仍是權威方式。",
            )}
          </p>
          <code>{liveApi ?? tx("Not configured for this release", "此版本尚未設定")}</code>
          <span className={`status status--${liveApi ? "unchecked" : "unavailable"}`}>
            {liveApi ? tx("best effort", "盡力提供") : tx("not deployed", "尚未部署")}
          </span>
        </article>
      </section>
      <section className="endpoint-section">
        <div className="section-heading">
          <p className="eyebrow">{tx("Static contract", "靜態介面契約")}</p>
          <h2>{tx("Public JSON endpoints", "公開 JSON 端點")}</h2>
        </div>
        <div className="endpoint-list">
          {endpoints.map(([path, description]) => (
            <article key={path}>
              <code>GET /api/v1/{path}</code>
              <p>{description}</p>
              <a href={`${import.meta.env.BASE_URL}api/v1/${path}`}>{tx("Open JSON", "開啟 JSON")}</a>
            </article>
          ))}
        </div>
      </section>
      <section className="code-samples">
        <div>
          <p className="eyebrow">{tx("Browser", "瀏覽器")}</p>
          <pre tabIndex={0}>
            <code>{`const release = await fetch(
  "${base}/meta.json"
).then(r => r.json());

console.log(release.release_id);`}</code>
          </pre>
        </div>
        <div>
          <p className="eyebrow">Python</p>
          <pre tabIndex={0}>
            <code>{`from urllib.request import urlopen
import json

with urlopen("${base}/languages.json") as r:
    languages = json.load(r)["data"]`}</code>
          </pre>
        </div>
        <div>
          <p className="eyebrow">R</p>
          <pre tabIndex={0}>
            <code>{`languages <- jsonlite::fromJSON(
  "${base}/languages.json"
)$data
languages[, c("id", "name", "iso639_3")]`}</code>
          </pre>
        </div>
      </section>
      <section className="contract-notes">
        <h2>{tx("Contract rules", "介面契約規則")}</h2>
        <ul>
          <li>{tx("In published work, pin ", "在出版成果中固定 ")}<code>{data.meta.release_id}</code>{tx(" and the source commit.", " 與來源提交版本。")}</li>
          <li>{tx("Do not key display languages by ISO alone. Seediq and Truku share ", "不要只用 ISO 作為顯示語言的鍵值。賽德克語與太魯閣語共用 ")}<code>trv</code>{tx(".", "。")}</li>
          <li>{tx("Keep original and FormosanBank standard forms in separate fields.", "將原始形式與 FormosanBank 標準形式保存在不同欄位。")}</li>
          <li>{tx("Follow every rights ID referenced by a downloaded artifact.", "遵守下載成品引用的每一項權利識別碼。")}</li>
          <li>{tx("Verify SHA-256 before loading a release SQLite snapshot.", "載入版本 SQLite 快照前，先驗證 SHA-256。")}</li>
        </ul>
      </section>
    </div>
  );
}
