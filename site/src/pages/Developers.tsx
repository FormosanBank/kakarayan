import {ApiExplorer, type ApiEndpoint} from "../components/ApiExplorer";
import {PageIntro} from "../components/Layout";
import {DATASET_FIELD_INFO} from "../datasetSelection";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Developers({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const endpoints: ApiEndpoint[] = [
    {path: "meta.json", description: tx("Release, schema, and pinned source commit", "版本、結構描述與固定來源提交")},
    {path: "languages.json", description: tx("Display identities, capabilities, and counts", "顯示身分、功能與數量")},
    {path: "corpora.json", description: tx("Corpus scopes, rights IDs, and counts", "語料庫範圍、權利識別碼與數量")},
    {path: "rights.json", description: tx("Central and per-corpus rights policy", "中央及各語料庫權利政策")},
    {path: "models.json", description: tx("Public MT/ASR models and service registry", "公開機器翻譯／語音辨識模型與服務登錄")},
    {path: "orthography.json", description: tx("Reviewed conversion-table projections", "已審查的轉換表投影")},
    {path: "content.json", description: tx("Reviewed learning-content registry", "已審查的學習內容登錄")},
    {path: "search/manifest.json", description: tx("Immutable browser search shards", "不可變的瀏覽器搜尋分片")},
  ];
  const base = `${window.location.origin}${import.meta.env.BASE_URL}api/v1`;
  const liveApi = import.meta.env.VITE_LIVE_API_URL as string | undefined;
  return (
    <div className="page-wrap">
      <PageIntro title={t("developers.title")} />
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
          {endpoints.map((endpoint) => (
            <article key={endpoint.path}>
              <code>GET /api/v1/{endpoint.path}</code>
              <p>{endpoint.description}</p>
              <a href={`${import.meta.env.BASE_URL}api/v1/${endpoint.path}`}>{tx("Open JSON", "開啟 JSON")}</a>
            </article>
          ))}
        </div>
      </section>
      <ApiExplorer base={base} endpoints={endpoints} />
      <section className="code-samples">
        <div>
          <p className="eyebrow">curl</p>
          <pre tabIndex={0}>
            <code>{`curl --fail --silent --show-error \\
  "${base}/meta.json" \\
  -o kakarayan-meta.json`}</code>
          </pre>
        </div>
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
      <section className="data-contract">
        <div className="section-heading">
          <p className="eyebrow">{tx("Data contract", "資料契約")}</p>
          <h2>{tx("Export row fields", "匯出資料列欄位")}</h2>
          <p>{tx("The browser dataset builder projects XML into these explicit columns. Structured JSON and JSON Lines retain the complete nested record.", "瀏覽器資料集產生器會將 XML 投影為這些明確欄位。結構化 JSON 與 JSON Lines 會保留完整巢狀記錄。")}</p>
        </div>
        <div className="data-contract__table table-scroll" tabIndex={0}>
          <table>
            <thead><tr><th>{tx("Field", "欄位")}</th><th>{tx("Meaning", "含義")}</th></tr></thead>
            <tbody>
              {DATASET_FIELD_INFO.map(([field, description]) => <tr key={field}><th scope="row"><code>{field}</code></th><td>{description}</td></tr>)}
            </tbody>
          </table>
        </div>
        <div className="format-semantics">
          <article><h3>CSV / TSV</h3><p>{tx("Flat selected columns, UTF-8, spreadsheet-formula guarded.", "平面選取欄位、UTF-8，並防護試算表公式。")}</p></article>
          <article><h3>JSON / JSONL</h3><p>{tx("Complete nested records for scripts, databases, and streaming tools.", "供指令碼、資料庫與串流工具使用的完整巢狀記錄。")}</p></article>
          <article><h3>Parquet</h3><p>{tx("Typed columnar output generated locally with DuckDB-Wasm.", "以 DuckDB-Wasm 在本機產生的型別化欄式輸出。")}</p></article>
          <article><h3>{tx("Recipe", "操作配方")}</h3><p>{tx("A non-executable release, scope, filter, field, unit, and format manifest.", "不可執行的版本、範圍、篩選、欄位、單位與格式清單。")}</p></article>
        </div>
      </section>
      <section className="client-section">
        <div className="section-heading">
          <p className="eyebrow">{tx("Repository clients", "儲存庫用戶端")}</p>
          <h2>{tx("JavaScript, Python, and R", "JavaScript、Python 與 R")}</h2>
          <p>
            {tx(
              "Each client supports release pinning, verified static search shards, timeouts, and the optional live API.",
              "每個用戶端都支援固定版本、經驗證的靜態搜尋分片、逾時設定與選用的即時 API。",
            )}
          </p>
        </div>
        <div className="client-grid">
          {[
            ["JavaScript", "@formosanbank/kakarayan-client", "javascript"],
            ["Python", "kakarayan_client", "python"],
            ["R", "kakarayan", "R"],
          ].map(([name, packageName, path]) => (
            <article key={name}>
              <h3>{name}</h3>
              <code>{packageName}</code>
              <a href={`https://github.com/FormosanBank/kakarayan/tree/main/clients/${path}`}>
                {tx("Setup and source →", "設定與原始碼 →")}
              </a>
            </article>
          ))}
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
