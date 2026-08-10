import {useState} from "react";

import {PageIntro} from "../components/Layout";
import {
  GITBOOK_CORPUS_PAGES,
  GITBOOK_SOURCE_URL,
  GITBOOK_TOPICS,
  gitBookPageUrl,
  hasGitBookTranslation,
} from "../gitbook";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData} from "../types";

export function Guide({data}: {data: AppData}) {
  const {locale, tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const selectedCorpusId = params.get("corpus") ?? "";
  const selectedCorpus = data.corpora.find(
    (corpus) => corpus.id === selectedCorpusId && GITBOOK_CORPUS_PAGES[corpus.id],
  );
  const requestedTopic = params.get("topic");
  const selectedTopic = GITBOOK_TOPICS.find((topic) => topic.id === requestedTopic)
    ?? GITBOOK_TOPICS[0];
  const selectedPage = (selectedCorpus ? GITBOOK_CORPUS_PAGES[selectedCorpus.id] : undefined)
    ?? selectedTopic;
  const selectedLabel = selectedCorpus?.name
    ?? (locale === "zh-Hant" ? selectedTopic.labelZh : selectedTopic.labelEn);
  const pageUrl = gitBookPageUrl(selectedPage, locale);
  const translated = hasGitBookTranslation(selectedPage, locale);
  const canEmbed = window.location.protocol === "https:";
  const [loadedUrl, setLoadedUrl] = useState("");
  const frameLoading = canEmbed && loadedUrl !== pageUrl;

  return (
    <div className="page-wrap page-wrap--wide guide-page">
      <PageIntro
        title={tx("FormosanBank guide", "FormosanBank 使用指南")}
        lede={tx(
          "Corpus background, data conventions, rights, and contribution documentation.",
          "語料背景、資料規範、權利與貢獻文件。",
        )}
      />
      <div className="guide-browser">
        <aside className="guide-browser__index">
          <h2>{tx("Browse", "瀏覽")}</h2>
          <nav aria-label={tx("Guide sections", "指南章節")}>
            {GITBOOK_TOPICS.map((topic) => {
              const active = !selectedCorpus && topic.id === selectedTopic.id;
              return (
                <button
                  key={topic.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() => setParams(topic.id === "welcome" ? {} : {topic: topic.id})}
                >
                  <span>{locale === "zh-Hant" ? topic.labelZh : topic.labelEn}</span>
                  {locale === "zh-Hant" && !hasGitBookTranslation(topic, locale) && <small>EN</small>}
                </button>
              );
            })}
          </nav>
          {selectedCorpus && (
            <div className="guide-browser__context">
              <span>{tx("Corpus page", "語料庫頁面")}</span>
              <strong>{selectedCorpus.name}</strong>
            </div>
          )}
          {locale === "zh-Hant" && (
            <p className="guide-browser__note">
              {tx(
                "The published GitBook is currently English. Kakarayan keeps the surrounding guide controls in Traditional Chinese.",
                "目前發布的 GitBook 為英文；Kakarayan 的指南控制介面仍使用繁體中文。",
              )}
            </p>
          )}
          <a href={GITBOOK_SOURCE_URL} target="_blank" rel="noreferrer">
            {tx("Documentation source ↗", "文件原始碼 ↗")}
          </a>
        </aside>

        <section className="guide-browser__reader" aria-labelledby="guide-reader-title">
          <header className="guide-browser__bar">
            <div>
              <span>{tx("Now reading", "目前閱讀")}</span>
              <h2 id="guide-reader-title">{selectedLabel}</h2>
            </div>
            <div className="guide-browser__actions">
              <span className="guide-browser__language">
                {translated ? (locale === "zh-Hant" ? "繁中" : "EN") : "EN"}
              </span>
              <a href={pageUrl} target="_blank" rel="noreferrer">
                {tx("Open separately ↗", "另開頁面 ↗")}
              </a>
            </div>
          </header>
          {canEmbed ? (
            <div className="guide-frame">
              {frameLoading && (
                <span className="guide-frame__status" role="status">
                  {tx("Loading guide…", "正在載入指南…")}
                </span>
              )}
              <iframe
                key={`${locale}-${pageUrl}`}
                src={pageUrl}
                title={tx(`FormosanBank guide: ${selectedLabel}`, `FormosanBank 指南：${selectedLabel}`)}
                loading="lazy"
                referrerPolicy="no-referrer"
                sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
                onLoad={() => setLoadedUrl(pageUrl)}
              />
            </div>
          ) : (
            <div className="guide-frame-fallback">
              <span className="file-mark">HTTPS</span>
              <h3>{tx("Embedded reader available on the public site", "公開網站提供嵌入式閱讀器")}</h3>
              <p>
                {tx(
                  "GitBook accepts embedded readers from HTTPS pages. Open the guide separately while using the local preview.",
                  "GitBook 僅接受 HTTPS 頁面的嵌入式閱讀器；使用本機預覽時請另開指南。",
                )}
              </p>
              <a className="button button--primary" href={pageUrl} target="_blank" rel="noreferrer">
                {tx("Open guide", "開啟指南")}
              </a>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
