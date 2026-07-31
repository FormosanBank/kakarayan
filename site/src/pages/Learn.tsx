import {useState} from "react";

import {PageIntro} from "../components/Layout";
import {TranslationTool} from "../components/ModelTools";
import {OrthographyTool} from "../components/OrthographyTool";
import {Recorder} from "../components/Recorder";
import {SearchTool} from "../components/SearchTool";
import {StudyDeck} from "../components/StudyDeck";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

type StudioTab = "lookup" | "deck" | "practice" | "translation" | "orthography" | "lessons";

export function Learn({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const [tab, setTab] = useState<StudioTab>("lookup");
  const tabs: Array<[StudioTab, string, string]> = [
    ["lookup", t("learn.lookup"), tx("Find cited words and examples", "尋找有引用的詞語與例句")],
    ["deck", t("learn.deck"), tx("Review private local cards", "複習私人本機卡片")],
    ["practice", t("learn.practice"), tx("Record locally, transcribe optionally", "在本機錄音，可選擇轉錄")],
    ["translation", t("learn.translate"), tx("Send text only with consent", "僅在同意後傳送文字")],
    ["orthography", t("learn.orthography"), tx("Apply reviewed conversion tables", "套用已審查的轉換表")],
    ["lessons", tx("Reviewed notes", "已審查筆記"), tx("Only authored and reviewed material", "只提供有作者且經審查的內容")],
  ];
  return (
    <div className="page-wrap page-wrap--wide learner-page">
      <PageIntro title={t("learn.title")} lede={t("learn.lede")} />
      <div className="privacy-banner">
        <span aria-hidden="true">◎</span>
        <p>
          <strong>{t("learn.local")}</strong>
          {tx(
            "Optional model actions name the public third party before anything leaves the browser.",
            "選用模型功能會在任何資料離開瀏覽器之前，先清楚標示公開的第三方服務。",
          )}
        </p>
      </div>
      <div className="studio-tabs" role="tablist" aria-label={tx("Learner tools", "學習工具")}>
        {tabs.map(([id, label, detail]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`studio-${id}`}
            onClick={() => setTab(id)}
          >
            <span>{label}</span>
            <small>{detail}</small>
          </button>
        ))}
      </div>
      <div className="studio-panel" id={`studio-${tab}`} role="tabpanel">
        {tab === "lookup" && <SearchTool data={data} learner />}
        {tab === "deck" && (
          <StudyDeck languages={data.languages} currentRelease={data.meta.release_id} />
        )}
        {tab === "practice" && <Recorder catalog={data.models} languages={data.languages} />}
        {tab === "translation" && <TranslationTool catalog={data.models} />}
        {tab === "orthography" && (
          <OrthographyTool
            catalog={data.orthography}
            sourceCommit={data.meta.source.commit}
          />
        )}
        {tab === "lessons" &&
          (data.content.entries.length ? (
            <div className="reviewed-content">
              {data.content.entries.map((entry) => (
                <article key={entry.id}>
                  <p className="eyebrow">
                    {entry.kind} · reviewed {entry.reviewed_at}
                  </p>
                  <h2>{entry.title}</h2>
                  <p>{entry.summary}</p>
                  <div className="reviewed-content__body">{entry.body_markdown}</div>
                  <h3>{tx("Sources and review", "來源與審查")}</h3>
                  <ul>
                    {entry.citations.map((citation) => (
                      <li key={citation}>{citation}</li>
                    ))}
                  </ul>
                  <small>
                    {tx("By", "作者")} {entry.author}；{tx("reviewed by", "審查者")} {entry.reviewer}；
                    {tx("rights", "權利")}{" "}
                    {entry.rights.license_expression ?? tx("documented in cited evidence", "記載於引用證據")}
                  </small>
                </article>
              ))}
            </div>
          ) : (
            <div className="empty-state">
              <h2>{tx("No reviewed lessons are published yet.", "目前尚未發布經審查的課程。")}</h2>
              <p>
                {tx(
                  "Use the cited corpus evidence explorer while community-authored material is reviewed. Kakarayan does not generate grammar lessons from corpus patterns.",
                  "在社群撰寫的內容接受審查期間，請使用附引用的語料證據探索工具。Kakarayan 不會從語料模式自動產生文法課程。",
                )}
              </p>
              <a href="https://github.com/FormosanBank/kakarayan/blob/main/content/README.md">
                {tx("Read the contribution requirements", "閱讀投稿要求")}
              </a>
            </div>
          ))}
      </div>
      <aside className="learning-boundary">
        <p className="eyebrow">{tx("What Kakarayan is claiming", "Kakarayan 所主張的範圍")}</p>
        <ul>
          <li>{tx("Corpus examples are attestations from the named source, not universal rules.", "語料例句是指定來源中的實證，不是普遍規則。")}</li>
          <li>{tx("FormosanBank standard orthography is distinct from source orthography.", "FormosanBank 標準正寫法與來源正寫法不同。")}</li>
          <li>{tx("Machine translation and ASR can be useful drafts and can also be wrong.", "機器翻譯與語音辨識可作為實用草稿，也可能出錯。")}</li>
          <li>{tx("Reviewed lessons will name their author, reviewer, source, date, and rights.", "經審查的課程會標明作者、審查者、來源、日期與權利。")}</li>
        </ul>
      </aside>
    </div>
  );
}
