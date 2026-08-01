import {useState} from "react";

import {PageIntro, Stat} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

export function Home({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const amis = data.languages.find((language) => language.name === "Amis");
  const [query, setQuery] = useState("");
  const [languageId, setLanguageId] = useState(amis?.id ?? data.languages[0]?.id ?? "");
  const counts = data.corpora.reduce(
    (total, corpus) => {
      total.sentences += corpus.counts.sentences ?? 0;
      total.tokens += corpus.counts.tokens ?? 0;
      total.audio += corpus.counts.audio ?? 0;
      return total;
    },
    {sentences: 0, tokens: 0, audio: 0},
  );

  function openLookup(path: "/dictionary" | "/sentences") {
    const params = new URLSearchParams({language: languageId});
    if (query.trim()) params.set("q", query.trim());
    window.location.hash = `${path}?${params}`;
  }

  return (
    <>
      <section className="hero">
        <div className="hero__copy">
          <PageIntro eyebrow={t("home.eyebrow")} title={t("home.title")} lede={t("home.lede")} />
          <form
            className="home-lookup"
            onSubmit={(event) => {
              event.preventDefault();
              openLookup("/dictionary");
            }}
          >
            <label className="field field--query">
              {tx("Start a lookup", "開始查詢")}
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={tx("Type a word or phrase", "輸入單詞或片語")}
              />
            </label>
            <label className="field">
              {tx("Language", "語言")}
              <select value={languageId} onChange={(event) => setLanguageId(event.target.value)}>
                {data.languages.map((language) => (
                  <option key={language.id} value={language.id}>{language.name}</option>
                ))}
              </select>
            </label>
            <div className="button-row">
              <button className="button button--primary" type="submit">{t("home.learn")}</button>
              <button className="button button--quiet" type="button" onClick={() => openLookup("/sentences")}>
                {t("home.search")}
              </button>
            </div>
          </form>
          <p className="privacy-line">
            <span aria-hidden="true">●</span>
            {tx("Search runs on this device.", "搜尋在此裝置上執行。")}
          </p>
        </div>
        <nav className="hero-directory" aria-label={tx("Main tools", "主要工具")}>
          <p>{tx("OPEN A TOOL", "開啟工具")}</p>
          <Link to="/dictionary"><span>01</span><strong>{tx("Dictionary", "單詞查詢")}</strong><small>{tx("word to translation", "單詞到翻譯")}</small></Link>
          <Link to="/sentences"><span>02</span><strong>{tx("Sentences", "例句搜尋")}</strong><small>{tx("word in context", "語境中的單詞")}</small></Link>
          <Link to="/research"><span>03</span><strong>{tx("Research", "研究工具")}</strong><small>{tx("datasets and summaries", "資料集與摘要")}</small></Link>
          <Link to="/downloads"><span>04</span><strong>{tx("Downloads", "資料下載")}</strong><small>{tx("XML, tables, CLDF, and more", "XML、表格、CLDF 等格式")}</small></Link>
        </nav>
      </section>

      <section className="collection-band">
        <div className="section-heading">
          <p className="eyebrow">{t("home.collection")}</p>
          <h2>{data.meta.release_id}</h2>
        </div>
        <div className="stats-grid">
          <Stat value={data.languages.length} label={tx("languages", "語言")} tone="ink" />
          <Stat value={data.corpora.length} label={tx("corpora", "語料庫")} tone="coral" />
          <Stat value={counts.sentences} label={tx("sentences", "句子")} tone="gold" />
          <Stat value={counts.tokens} label={tx("tokens", "詞元")} tone="moss" />
        </div>
      </section>

      <section className="home-notes" aria-label={tx("About this release", "關於此版本")}>
        <div>
          <strong>{tx("For learners", "給學習者")}</strong>
          <p>{tx("Save a dictionary entry or sentence, then review it in your private local deck.", "儲存單詞或例句後，在私人本機字卡中複習。")}</p>
          <Link to="/learn">{tx("Open learning tools", "開啟學習工具")}</Link>
        </div>
        <div>
          <strong>{tx("For linguists", "給語言學家")}</strong>
          <p>{tx("Filter corpus records and export reproducible research datasets.", "篩選語料記錄並匯出可重現的研究資料集。")}</p>
          <Link to="/research">{tx("Open research tools", "開啟研究工具")}</Link>
        </div>
        <div>
          <strong>{tx("For developers", "給開發者")}</strong>
          <p>{tx("Use versioned static APIs and JavaScript, Python, or R clients.", "使用具版本的靜態 API 與 JavaScript、Python 或 R 用戶端。")}</p>
          <Link to="/developers">{tx("Read API docs", "查看 API 文件")}</Link>
        </div>
      </section>
    </>
  );
}
