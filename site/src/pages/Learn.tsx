import {useState} from "react";

import {PageIntro} from "../components/Layout";
import {TranslationTool} from "../components/ModelTools";
import {OrthographyTool} from "../components/OrthographyTool";
import {Recorder} from "../components/Recorder";
import {SearchTool} from "../components/SearchTool";
import {StudyDeck} from "../components/StudyDeck";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

type StudioTab = "dictionary" | "sentences" | "deck" | "practice" | "translation" | "orthography" | "lessons";

export function Learn({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const [tab, setTab] = useState<StudioTab>("dictionary");
  const tabs: Array<[StudioTab, string]> = [
    ["dictionary", tx("Dictionary", "單詞")],
    ["sentences", tx("Sentences", "例句")],
    ["deck", t("learn.deck")],
    ["practice", t("learn.practice")],
    ["translation", t("learn.translate")],
    ["orthography", t("learn.orthography")],
    ["lessons", tx("Notes", "筆記")],
  ];
  return (
    <div className="page-wrap page-wrap--wide learner-page">
      <PageIntro title={t("learn.title")} lede={t("learn.lede")} />
      <div className="privacy-banner">
        <span aria-hidden="true">●</span>
        <p>
          <strong>{t("learn.local")}</strong>
          {tx(
            " MT and ASR ask before sending anything to Hugging Face.",
            " 機器翻譯與語音辨識會在傳送資料至 Hugging Face 前取得同意。",
          )}
        </p>
      </div>
      <div className="studio-tabs" role="tablist" aria-label={tx("Learner tools", "學習工具")}>
        {tabs.map(([id, label]) => (
          <button
            key={id}
            role="tab"
            aria-selected={tab === id}
            aria-controls={`studio-${id}`}
            onClick={() => setTab(id)}
          >
            <span>{label}</span>
          </button>
        ))}
      </div>
      <div className="studio-panel" id={`studio-${tab}`} role="tabpanel">
        {tab === "dictionary" && <SearchTool data={data} kind="dictionary" learner />}
        {tab === "sentences" && <SearchTool data={data} kind="sentences" learner />}
        {tab === "deck" && (
          <StudyDeck currentRelease={data.meta.release_id} />
        )}
        {tab === "practice" && <Recorder catalog={data.models} />}
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
              <h2>{tx("No reviewed notes yet", "目前沒有已審查筆記")}</h2>
              <p>
                {tx(
                  "Community-authored notes will appear here after review.",
                  "社群撰寫的筆記會在審查後顯示於此。",
                )}
              </p>
              <a href="https://github.com/FormosanBank/kakarayan/blob/main/content/README.md">
                {tx("Read the contribution requirements", "閱讀投稿要求")}
              </a>
            </div>
          ))}
      </div>
      <p className="learning-note">
        {tx(
          "Corpus examples link to their source. Machine output is always marked as a draft.",
          "語料例句會連結至來源；機器輸出一律標示為草稿。",
        )}
      </p>
    </div>
  );
}
