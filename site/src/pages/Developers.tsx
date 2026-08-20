import {ApiExplorer, type ApiEndpoint} from "../components/ApiExplorer";
import {PageIntro} from "../components/Layout";
import {DATASET_FIELD_INFO} from "../datasetSelection";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Developers({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const endpoints: ApiEndpoint[] = [
    {path: "meta.json", description: tx("Release and pinned source commit", "版本與固定來源提交")},
    {path: "languages.json", description: tx("Language identities, capabilities, and counts", "語言身分、功能與數量")},
    {path: "corpora.json", description: tx("Corpus scopes, rights IDs, and counts", "語料庫範圍、權利識別碼與數量")},
    {path: "rights.json", description: tx("Central and per-corpus rights", "中央及各語料庫權利")},
    {path: "models.json", description: tx("Public MT and ASR model registry", "公開機器翻譯與語音辨識模型登錄")},
    {path: "orthography.json", description: tx("Reviewed conversion tables", "已審查的轉換表")},
    {path: "content.json", description: tx("Reviewed learning content", "已審查的學習內容")},
  ];
  const staticBase = `${window.location.origin}${import.meta.env.BASE_URL}api/v1`;
  const query = `${data.query.baseUrl}/v1/releases/${data.meta.release_id}/concordance?${new URLSearchParams({q: "lima", language_id: "lang_amis", match: "exact"})}`;
  return (
    <div className="page-wrap">
      <PageIntro title={t("developers.title")} />
      <section className="api-choice">
        <article className="api-choice__primary">
          <h2>{tx("Query API v1", "查詢 API v1")}</h2>
          <p>{tx("Dictionary, sentence, detail, summary, preview, and finite export routes over one immutable release.", "針對單一不可變版本提供詞典、句子、詳情、摘要、預覽與有限匯出路由。")}</p>
          <code>{data.query.baseUrl}/v1/releases/{data.meta.release_id}/</code>
          <span className={`status status--${data.query.available ? "available" : "unavailable"}`}>
            {data.query.available ? tx("available", "可用") : tx("unavailable", "無法使用")}
          </span>
        </article>
        <article>
          <h2>{tx("Static metadata", "靜態中繼資料")}</h2>
          <p>{tx("Small catalogues, rights, model records, orthography tables, and prepared download links remain on the web site.", "小型目錄、權利、模型記錄、正寫法表與預備下載連結保留在網站上。")}</p>
          <code>{staticBase}/meta.json</code>
          <span className="status status--available">{tx("release-pinned", "固定版本")}</span>
        </article>
      </section>
      <section className="endpoint-section">
        <div className="section-heading"><h2>{tx("Static JSON endpoints", "靜態 JSON 端點")}</h2></div>
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
      <ApiExplorer base={staticBase} endpoints={endpoints} />
      <section className="code-samples">
        <div><p className="eyebrow">curl</p><pre tabIndex={0}><code>{`curl --fail --silent --show-error "${query}"`}</code></pre></div>
        <div><p className="eyebrow">JavaScript</p><pre tabIndex={0}><code>{`const result = await fetch("${query}").then(r => r.json());
console.log(result.items);`}</code></pre></div>
        <div><p className="eyebrow">Python</p><pre tabIndex={0}><code>{`from urllib.request import urlopen
import json

with urlopen("${query}") as response:
    sentences = json.load(response)["items"]`}</code></pre></div>
        <div><p className="eyebrow">R</p><pre tabIndex={0}><code>{`sentences <- jsonlite::fromJSON("${query}")$items`}</code></pre></div>
      </section>
      <section className="data-contract">
        <div className="section-heading"><h2>{tx("Export row fields", "匯出資料列欄位")}</h2></div>
        <div className="data-contract__table table-scroll" tabIndex={0}>
          <table><thead><tr><th>{tx("Field", "欄位")}</th><th>{tx("Meaning", "含義")}</th></tr></thead><tbody>
            {DATASET_FIELD_INFO.map(([field, description, descriptionZh]) => <tr key={field}><th scope="row"><code>{field}</code></th><td>{tx(description, descriptionZh)}</td></tr>)}
          </tbody></table>
        </div>
        <div className="format-semantics">
          <article><h3>CSV / TSV</h3><p>{tx("Flat selected columns, UTF-8, and spreadsheet-formula guarded.", "平面選取欄位、UTF-8，並防護試算表公式。")}</p></article>
          <article><h3>JSONL</h3><p>{tx("One selected sentence row per line.", "每行一筆選定句子資料。")}</p></article>
          <article><h3>{tx("Recipe", "操作配方")}</h3><p>{tx("A release-pinned, finite, validated selection that can be reproduced.", "固定版本、有限且經驗證的選取，可供重現。")}</p></article>
        </div>
      </section>
      <section className="contract-notes">
        <h2>{tx("Contract rules", "介面契約規則")}</h2>
        <ul>
          <li>{tx("Pin release ", "固定版本 ")}<code>{data.meta.release_id}</code>{tx(" and the source commit in published work.", " 與來源提交於出版成果中。")}</li>
          <li>{tx("Keep original and FormosanBank standard forms separate.", "將原始形式與 FormosanBank 標準形式分開。")}</li>
          <li>{tx("Follow every rights ID referenced by a downloaded artifact.", "遵守下載成品引用的每一項權利識別碼。")}</li>
        </ul>
      </section>
    </div>
  );
}
