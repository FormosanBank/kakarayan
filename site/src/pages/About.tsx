import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function About({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  return (
    <div className="page-wrap page-wrap--prose">
      <PageIntro title={t("about.title")} lede={t("about.lede")} />
      <section>
        <p className="eyebrow">{tx("Architecture", "架構")}</p>
        <h2>{tx("Canonical source, reproducible projections", "權威來源，可重現的資料投影")}</h2>
        <p>
          {tx("FormosanBank XML under each public corpus ", "每個公開語料庫內的 FormosanBank XML ")}
          <code>XML/</code>
          {tx(
            " directory is the source of truth. Kakarayan pins one public commit, preserves source paths and checksums, and derives search shards, tables, SQLite, manifests, and the static API. It never reconstructs archival XML from those projections.",
            " 目錄是權威來源。Kakarayan 固定使用一個公開提交版本，保留來源路徑與校驗碼，並產生搜尋分片、表格、SQLite、清單及靜態 API。系統絕不從這些投影重建典藏 XML。",
          )}
        </p>
      </section>
      <section>
        <p className="eyebrow">{tx("Language identity", "語言身分")}</p>
        <h2>{tx("Dialect is data, not decoration", "方言是資料，不是裝飾")}</h2>
        <p>
          {tx("Language identity comes from ", "語言身分由 ")}
          <code>xml:lang</code>
          {tx(
            " plus the source dialect. Seediq and Truku intentionally remain distinct even though both use ISO 639-3 ",
            " 與來源方言共同決定。賽德克語與太魯閣語即使共用 ISO 639-3 ",
          )}
          <code>trv</code>
          {tx(
            ". Unknown and unspecified dialect values remain visible.",
            "，仍刻意維持為不同語言身分。未知或未指定的方言值會保留顯示。",
          )}
        </p>
      </section>
      <section>
        <p className="eyebrow">{tx("Orthography", "正寫法")}</p>
        <h2>{tx("Original does not mean standard", "原始形式不等於標準形式")}</h2>
        <p>
          {tx(
            "Source orthography preserves the published transcription. FormosanBank standard orthography is a comparative projection. Neither is silently substituted for the other. Automatic transliteration is not labeled as phonetic transcription.",
            "來源正寫法保留原出版轉寫；FormosanBank 標準正寫法則是供比較使用的投影。兩者不會在未告知的情況下互相替換，自動轉寫也不會被標示為語音轉錄。",
          )}
        </p>
      </section>
      <section>
        <p className="eyebrow">{tx("Rights and responsible use", "權利與負責任使用")}</p>
        <h2>{tx("Public is not a single license", "公開不代表只有一種授權")}</h2>
        <p>{data.rights.central_terms.use_summary}</p>
        <p>
          {tx("Commercial AI use is ", "依中央條款，商業 AI 使用為 ")}
          <strong>{data.rights.central_terms.commercial_ai}</strong>
          {tx(
            ". Corpus, XML-root, audio, media, and source notices may add further requirements. Kakarayan fails closed when redistribution has not been reviewed.",
            "。各語料庫、XML 根節點、音訊、媒體與來源聲明可能另有要求。若再散布尚未完成審查，Kakarayan 預設不提供下載。",
          )}
        </p>
        <ul>
          {data.rights.central_terms.evidence.map((url) => (
            <li key={url}>
              <a href={url}>{url.split("/").pop()}</a>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <p className="eyebrow">{tx("People", "參與者")}</p>
        <h2>{tx("A collaboration, not an automated authority", "這是協作成果，不是自動化權威")}</h2>
        <p>
          {tx(
            "Kakarayan began with Gabriel Gras's public corpus interface and is developed with FormosanBank. Corpus creators, speakers, annotators, educators, and source communities must be credited through the citations attached to each corpus. Machine output is never represented as their review.",
            "Kakarayan 源自 Gabriel Gras 的公開語料介面，並與 FormosanBank 共同開發。引用每個語料庫所附的文獻時，必須肯認語料建立者、族語使用者、標註者、教育工作者與來源社群的貢獻。機器輸出絕不會被表示為經過他們審查。",
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
