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
          {tx("The FormosanBank XML in each public corpus ", "每個公開語料庫內的 FormosanBank XML ")}
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
            "Kakarayan keeps the source spelling and the FormosanBank standardized form in separate fields.",
            "Kakarayan 將來源拼寫與 FormosanBank 標準化形式保存在不同欄位。",
          )}
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
        <p>{data.rights.central_terms.use_summary}</p>
        <ul>
          {data.rights.central_terms.evidence.map((url) => (
            <li key={url}>
              <a href={url}>{url.split("/").pop()}</a>
            </li>
          ))}
        </ul>
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
