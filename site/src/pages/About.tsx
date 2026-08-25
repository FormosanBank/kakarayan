import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function About({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  return (
    <div className="page-wrap page-wrap--prose">
      <PageIntro title={t("about.title")} />
      <section>
        <h2>{tx("Source and releases", "來源與版本")}</h2>
        <p>
          {tx("The FormosanBank XML in each public corpus ", "每個公開語料庫內的 FormosanBank ")}
          <code>XML/</code>
          {tx(
            " directory is the source. Each Kakarayan release pins one commit and records source paths and checksums for its search data, tables, downloads, and APIs.",
            " 目錄是來源。每個 Kakarayan 版本固定一個提交，並記錄搜尋資料、表格、下載與 API 的來源路徑及校驗碼。",
          )}
        </p>
      </section>
      <section>
        <h2>{tx("Language and dialect labels", "語言與方言標籤")}</h2>
        <p>
          {tx("Language identity comes from ", "語言身分由 ")}
          <code>xml:lang</code>
          {tx(
            " and the source dialect. Seediq and Truku remain separate display languages even though both use ISO 639-3 ",
            " 與來源方言共同決定。賽德克語與太魯閣語即使共用 ISO 639-3 ",
          )}
          <code>trv</code>
          {tx(".", "，仍分開顯示。")}
        </p>
      </section>
      <section>
        <h2>{tx("Source and standardized spelling", "來源與標準化拼寫")}</h2>
        <p>
          {tx(
            "Kakarayan displays original and standardized FORM values exactly as published in the XML. Search and frequency keys are separate normalized indexes, so surrounding punctuation does not split a frequency count.",
            "Kakarayan 會如 XML 所發布，完整顯示原始及標準化 FORM 值。搜尋與頻率鍵使用分開的正規化索引，因此周圍標點不會拆分頻率計數。",
          )}
        </p>
      </section>
      <section>
        <h2>{tx("How updates are published", "更新發布方式")}</h2>
        <p>
          {tx(
            "Each update builds an immutable data release from one reviewed FormosanBank commit, activates that release on the query API, then deploys the site against the same release ID.",
            "每次更新都從一個經審查的 FormosanBank 提交建立不可變資料版本，將該版本啟用於查詢 API，再以相同版本識別碼部署網站。",
          )}
        </p>
        <p>
          <a href="https://github.com/FormosanBank/kakarayan/blob/main/docs/publication.md#routine-update">
            {tx("Publication steps", "發布步驟")}
          </a>{" · "}
          <a href="https://github.com/FormosanBank/kakarayan/blob/main/docs/lightsail.md#routine-release-update">
            {tx("Server update steps", "伺服器更新步驟")}
          </a>
        </p>
      </section>
      <section>
        <h2>{tx("License and corpus terms", "授權與語料庫條款")}</h2>
        <p>
          {tx("Kakarayan software and original documentation use ", "Kakarayan 軟體與原創文件採用 ")}
          <a href="https://github.com/FormosanBank/kakarayan/blob/main/LICENSE.md">
            CC BY-NC 4.0
          </a>
          {tx(". Corpus materials keep their FormosanBank, source, and community terms.", "。語料保留其 FormosanBank、來源與社群條款。")}
        </p>
        <p>
          {tx(
            "Public FormosanBank resources may be reused for noncommercial research, education, documentation, cultural work, and revitalization. Preserve each corpus citation and source terms.",
            "公開 FormosanBank 資源可用於非商業研究、教育、語言記錄、文化工作與復振。請保留各語料庫的引用與來源條款。",
          )}
        </p>
        <details className="source-policy">
          <summary>{tx("Source policy and evidence", "來源政策與證據")}</summary>
          <p lang="en">{data.rights.central_terms.use_summary}</p>
          <ul>
            {data.rights.central_terms.evidence.map((url) => (
              <li key={url}>
                <a href={url}>{url.split("/").pop()}</a>
              </li>
            ))}
          </ul>
        </details>
      </section>
      <section>
        <h2>{tx("Contributors and attribution", "貢獻者與署名")}</h2>
        <p>
          {tx(
            "Kakarayan builds on Gabriel Gras's original corpus interface and FormosanBank's data and models. Cite the creators, speakers, annotators, and source communities listed with each corpus.",
            "Kakarayan 建立於 Gabriel Gras 的原始語料介面，以及 FormosanBank 的資料與模型之上。請引用各語料庫列出的建立者、族語使用者、標註者與來源社群。",
          )}
        </p>
      </section>
      <aside className="release-note">
        <strong>{data.meta.release_id}</strong>
        <span>FormosanBank {data.meta.source.commit}</span>
        <a href="https://github.com/FormosanBank/kakarayan/issues">
          {tx("Report a problem", "回報問題")}
        </a>
      </aside>
    </div>
  );
}
