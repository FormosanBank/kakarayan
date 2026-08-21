import {useState} from "react";

import {PageIntro} from "../components/Layout";
import {LoadingState} from "../components/LoadingState";
import {
  GITBOOK_CORPUS_PAGES,
  GITBOOK_TOPICS,
  gitBookPageUrl,
} from "../gitbook";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData} from "../types";

export function Guide({data}: {data: AppData}) {
  const {locale, tx} = useI18n();
  const [params] = useSearchParams();
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
  const canEmbed = window.location.protocol === "https:";
  const [loadedUrl, setLoadedUrl] = useState("");
  const frameLoading = canEmbed && loadedUrl !== pageUrl;

  return (
    <div className="page-wrap page-wrap--wide guide-page">
      <PageIntro title={tx("Docs", "文件")} />
      <section className="guide-browser" aria-labelledby="guide-reader-title">
        <header className="guide-browser__bar">
          <h2 id="guide-reader-title">{selectedLabel}</h2>
          <a href={pageUrl} target="_blank" rel="noreferrer">
            {tx("Open in GitBook ↗", "在 GitBook 開啟 ↗")}
          </a>
        </header>
        {canEmbed ? (
          <div className="guide-frame">
            {frameLoading && (
              <LoadingState
                className="guide-frame__loading"
                kind="document"
                label={tx("Loading documentation", "正在載入文件")}
              />
            )}
            <iframe
              key={`${locale}-${pageUrl}`}
              src={pageUrl}
              title={tx(
                `FormosanBank docs: ${selectedLabel}`,
                `FormosanBank 文件：${selectedLabel}`,
              )}
              loading="lazy"
              referrerPolicy="no-referrer"
              sandbox="allow-downloads allow-forms allow-popups allow-popups-to-escape-sandbox allow-same-origin allow-scripts"
              onLoad={() => setLoadedUrl(pageUrl)}
            />
          </div>
        ) : (
          <div className="guide-frame-fallback">
            <span className="file-mark">HTTPS</span>
            <h3>{tx("Docs open on the public site", "文件可在公開網站開啟")}</h3>
            <p>
              {tx(
                "The embedded GitBook reader is available over HTTPS. Open it directly while using the local preview.",
                "嵌入式 GitBook 閱讀器需使用 HTTPS；在本機預覽時請直接開啟文件。",
              )}
            </p>
            <a className="button button--primary" href={pageUrl} target="_blank" rel="noreferrer">
              {tx("Open docs", "開啟文件")}
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
