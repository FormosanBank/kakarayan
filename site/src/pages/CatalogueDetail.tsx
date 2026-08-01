import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData, Corpus, Counts, Language} from "../types";

function downloadText(value: string, name: string, mediaType: string) {
  const url = URL.createObjectURL(new Blob([`${value.trim()}\n`], {type: mediaType}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

function CountsGrid({counts}: {counts: Counts}) {
  const {number, tx} = useI18n();
  const labels: Record<string, string> = {
    texts: tx("Texts", "文本"),
    sentences: tx("Sentences", "句子"),
    words: tx("Words", "詞"),
    morphemes: tx("Morphemes", "語素"),
    tokens: tx("Tokens", "詞元"),
    audio: tx("Audio references", "音訊參照"),
  };
  const entries = Object.entries(counts).filter(([, value]) => value !== undefined);
  return (
    <dl className="detail-counts">
      {entries.map(([name, value]) => (
        <div key={name}>
          <dt>{labels[name] ?? name}</dt>
          <dd>{value === undefined ? "" : number(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function LanguageDetail({
  data,
  language,
}: {
  data: AppData;
  language: Language;
}) {
  const {tx} = useI18n();
  const corpora = data.corpora.filter((corpus) => corpus.languages.includes(language.id));
  return (
    <div className="page-wrap">
      <PageIntro
        title={language.name}
        lede={`${language.names["zh-Hant"] || tx("No reviewed Traditional Chinese name", "尚無經審查的繁體中文名稱")} · ${
          language.names.autonym || tx("No reviewed autonym", "尚無經審查的自稱")
        } · ISO 639-3 ${language.iso639_3}`}
      />
      <div className="detail-actions">
        <Link className="button button--primary" to={`/lookup?type=dictionary&language=${language.id}`}>
          {tx("Dictionary", "單詞查詢")}
        </Link>
        <Link className="button button--quiet" to={`/lookup?type=sentences&language=${language.id}`}>
          {tx("Sentence search", "例句搜尋")}
        </Link>
        <Link className="button button--quiet" to={`/downloads?language=${language.id}`}>
          {tx("Filter prepared data", "篩選預備資料")}
        </Link>
      </div>
      <section className="detail-section">
        <h2>{tx("Published coverage", "已發布資料涵蓋範圍")}</h2>
        <CountsGrid counts={language.counts} />
        <div className="capabilities">
          {language.capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
        <p>
          <strong>{tx("Published dialect labels:", "已發布的方言標籤：")}</strong>{" "}
          {language.dialects.join(", ") || tx("none supplied in this release", "此版本未提供")}。
        </p>
        <p>
          {tx(
            "Counts describe this release, not the number of speakers, dialect vitality, or completeness of the language.",
            "這些數量只描述此資料版本，不代表使用者人數、方言活力或語言的完整程度。",
          )}
        </p>
      </section>
      <section className="detail-section">
        <h2>{tx("Participating corpora", "參與的語料庫")}</h2>
        <div className="detail-list">
          {corpora.map((corpus) => (
            <article key={corpus.id}>
              <div>
                <h3>{corpus.name}</h3>
                <p>{corpus.source_path}</p>
              </div>
              <CountsGrid counts={corpus.counts} />
              <Link to={`/corpora/${corpus.id}`}>{tx("Corpus details →", "語料庫詳細資料 →")}</Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CorpusDetail({data, corpus}: {data: AppData; corpus: Corpus}) {
  const {number, tx} = useI18n();
  const rights = data.rights.entries.find((entry) => entry.id === corpus.rights_id);
  const languages = corpus.languages
    .map((id) => data.languages.find((language) => language.id === id))
    .filter((language): language is Language => Boolean(language));
  return (
    <div className="page-wrap">
      <PageIntro
        title={corpus.name}
        lede={tx(
          `Public source scope ${corpus.source_path}. Every link and count is pinned to ${data.meta.release_id}.`,
          `公開來源範圍為 ${corpus.source_path}。所有連結與數量皆固定於 ${data.meta.release_id}。`,
        )}
      />
      <div className="detail-actions">
        {languages.map((language) => (
          <Link
            className="button button--primary"
            key={language.id}
            to={`/lookup?type=sentences&language=${language.id}&corpus=${corpus.id}`}
          >
            {tx("Search", "搜尋")} {language.name}
          </Link>
        ))}
        <Link className="button button--quiet" to={`/downloads?corpus=${corpus.id}`}>
          {tx("Filter prepared data", "篩選預備資料")}
        </Link>
        <a
          className="button button--quiet"
          href={`https://github.com/FormosanBank/FormosanBank/tree/${data.meta.source.commit}/${corpus.source_path}`}
        >
          {tx("Pinned public source", "固定版本的公開來源")}
        </a>
      </div>
      <section className="detail-section">
        <h2>{tx("Corpus coverage", "語料庫涵蓋範圍")}</h2>
        <CountsGrid counts={corpus.counts} />
        <p>
          {tx("Display languages:", "顯示語言：")}{" "}
          {languages.map((language) => language.name).join(", ") || tx("not resolved", "無法判定")}。
        </p>
        <p>
          <strong>{tx("Source statement:", "來源聲明：")}</strong>{" "}
          {corpus.source || tx("No separate source statement was supplied.", "未提供個別來源聲明。")}
        </p>
        <p>
          <strong>{tx("Copyright statement:", "著作權聲明：")}</strong>{" "}
          {corpus.copyright || tx("Consult corpus and central rights evidence.", "請查閱語料庫與中央權利證據。")}
        </p>
      </section>
      <section className="detail-section">
        <h2>{tx("Citation and machine-readable records", "引用與機器可讀記錄")}</h2>
        <p>{corpus.citation || tx("No corpus citation string was supplied in source metadata.", "來源中繼資料未提供語料庫引用字串。")}</p>
        <p>
          {tx("This catalogue found", "此目錄在來源文本中找到")} {number(corpus.citation_count)}{" "}
          {tx(
            `distinct non-empty citation string${corpus.citation_count === 1 ? "" : "s"} across source texts. Prepared text tables retain every text-level value.`,
            "個相異的非空白引用字串。預備文本表會保留每一個文本層級的值。",
          )}
        </p>
        <div className="button-row">
          {corpus.bibtex_citation && (
            <button
              className="button button--quiet"
              onClick={() =>
                downloadText(corpus.bibtex_citation, `${corpus.id}.bib`, "application/x-bibtex")
              }
            >
              {tx("Download source BibTeX", "下載來源 BibTeX")}
            </button>
          )}
          {corpus.citation && (
            <button
              className="button button--quiet"
              onClick={() =>
                downloadText(
                  [
                    "TY  - GEN",
                    `T1  - ${corpus.name}`,
                    `N1  - ${corpus.citation}`,
                    `UR  - https://github.com/FormosanBank/FormosanBank/tree/${data.meta.source.commit}/${corpus.source_path}`,
                    `Y2  - ${data.meta.generated_at.slice(0, 10)}`,
                    "ER  -",
                  ].join("\n"),
                  `${corpus.id}.ris`,
                  "application/x-research-info-systems",
                )
              }
            >
              {tx("Download RIS", "下載 RIS")}
            </button>
          )}
        </div>
      </section>
      <section className="detail-section" id="rights">
        <h2>{tx("Rights and attribution", "權利與署名")}</h2>
        <StatusBadge value={rights?.redistribution ?? "review_required"} />
        <p>{rights?.attribution || tx("No reviewed attribution statement is published.", "尚未發布經審查的署名聲明。")}</p>
        <p>{rights?.notes}</p>
        <dl className="detail-metadata">
          <div>
            <dt>{tx("Review", "審查")}</dt>
            <dd>{rights?.review_status ?? "review_required"}</dd>
          </div>
          <div>
            <dt>{tx("License expression", "授權表示式")}</dt>
            <dd>{rights?.license_expression ?? tx("not established", "尚未確立")}</dd>
          </div>
          <div>
            <dt>{tx("Commercial use", "商業使用")}</dt>
            <dd>{rights?.commercial_use ?? tx("unknown", "未知")}</dd>
          </div>
        </dl>
        {rights?.evidence.length ? (
          <ul>
            {rights.evidence.map((url) => (
              <li key={url}>
                <a href={url}>{url}</a>
              </li>
            ))}
          </ul>
        ) : null}
        <p>
          {tx(
            "This public corpus is approved for Kakarayan's noncommercial distribution. Retain its source notices and citations.",
            "此公開語料庫已核准供 Kakarayan 非商業散布使用。請保留來源聲明與引用。",
          )}
        </p>
      </section>
      <section className="detail-section">
        <h2>{tx("Known limitations", "已知限制")}</h2>
        <p>
          {tx(
            "Counts describe this release, not language completeness or speaker populations. Some tiers and audio links may be absent.",
            "數量只描述此資料版本，不代表語言完整性或使用者人口。部分層級與音訊連結可能缺漏。",
          )}
        </p>
      </section>
    </div>
  );
}
