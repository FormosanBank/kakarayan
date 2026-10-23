import {useEffect, useState} from "react";

import {PageIntro} from "../components/Layout";
import {LoadingState} from "../components/LoadingState";
import {DOCS_CORPUS_PAGES, DOCS_TOPICS, docsPageUrl} from "../docs";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData} from "../types";

export function Guide({data}: {data: AppData}) {
  const {locale, tx} = useI18n();
  const [params] = useSearchParams();
  const selectedCorpusId = params.get("corpus") ?? "";
  const selectedCorpus = data.corpora.find(
    (corpus) => corpus.id === selectedCorpusId && DOCS_CORPUS_PAGES[corpus.id],
  );
  const requestedTopic = params.get("topic");
  const selectedTopic = DOCS_TOPICS.find((topic) => topic.id === requestedTopic)
    ?? DOCS_TOPICS[0];
  const selectedPage = (selectedCorpus ? DOCS_CORPUS_PAGES[selectedCorpus.id] : undefined)
    ?? selectedTopic;
  const selectedLabel = selectedCorpus?.name
    ?? (locale === "zh-Hant" ? selectedTopic.labelZh : selectedTopic.labelEn);
  const pageUrl = docsPageUrl(selectedPage, locale);
  const canEmbed = window.location.protocol === "https:";
  const [loadedUrl, setLoadedUrl] = useState("");
  const [failedUrl, setFailedUrl] = useState("");
  const frameLoading = canEmbed && loadedUrl !== pageUrl && failedUrl !== pageUrl;
  useEffect(() => {
    if (!frameLoading) return;
    const timer = window.setTimeout(() => setFailedUrl(pageUrl), 10_000);
    return () => window.clearTimeout(timer);
  }, [frameLoading, pageUrl]);

  return (
    <div className="page-wrap page-wrap--wide guide-page">
      <PageIntro title={tx("Docs", "文件")} />
      <section className="guide-browser" aria-labelledby="guide-reader-title">
        <header className="guide-browser__bar">
          <h2 id="guide-reader-title">{selectedLabel}</h2>
          {locale === "zh-Hant" && !("zh" in selectedPage && selectedPage.zh) && <small>英文文件</small>}
          <a href={pageUrl} target="_blank" rel="noreferrer">
            {tx("Open in new tab ↗", "在新分頁開啟 ↗")}
          </a>
        </header>
        {canEmbed && failedUrl !== pageUrl ? (
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
              onError={() => setFailedUrl(pageUrl)}
            />
          </div>
        ) : (
          <div className="guide-frame-fallback">
            <h3>{tx("Open documentation", "開啟文件")}</h3>
            <a className="button button--primary" href={pageUrl} target="_blank" rel="noreferrer">
              {tx("Open docs", "開啟文件")}
            </a>
          </div>
        )}
      </section>
    </div>
  );
}
