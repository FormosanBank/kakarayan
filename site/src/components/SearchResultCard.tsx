import {useEffect, useState} from "react";

import {sentenceDetail} from "../apiClient";
import {apiErrorMessage} from "../apiErrors";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import {queryMatchesText} from "../queryMatching";
import {translationLanguageName} from "../translationLanguages";
import type {
  AppData,
  MatchMode,
  SearchDirection,
  SearchRecord,
  SentenceSummary,
} from "../types";
import {LoadingState} from "./LoadingState";
import {QueryHighlight} from "./QueryHighlight";

function playableUrl(record: SearchRecord, index: number): string {
  const audio = record.audio[index];
  if (!audio) return "";
  for (const value of [audio.url, audio.source, audio.file]) {
    try {
      const url = new URL(value);
      if (url.protocol === "https:" || url.protocol === "http:") return url.href;
    } catch {
      // Relative and local filesystem references remain visible as provenance only.
    }
  }
  return "";
}

function SentenceText({
  record,
  query,
  mode,
  highlight,
}: {
  record: SearchRecord;
  query: string;
  mode: MatchMode;
  highlight: boolean;
}) {
  const {tx} = useI18n();
  const text = record.standard || record.original || tx("Untranscribed sentence", "未轉錄句子");
  return (
    <h3 className="kwic">
      <QueryHighlight text={text} query={query} mode={mode} active={highlight} />
    </h3>
  );
}

function Interlinear({
  record,
  query,
  mode,
  direction,
}: {
  record: SearchRecord;
  query: string;
  mode: MatchMode;
  direction: SearchDirection;
}) {
  const {tx} = useI18n();
  if (!record.words.length) return null;
  return (
    <div className="table-scroll interlinear-table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>{tx("Position", "位置")}</th>
            <th>{tx("Word forms", "詞形")}</th>
            <th>{tx("Phonology", "音韻")}</th>
            <th>{tx("Morphemes", "語素")}</th>
            <th>{tx("Glosses", "詞彙註釋")}</th>
          </tr>
        </thead>
        <tbody>
          {record.words.map((word) => {
            const forms = record.forms.filter(
              (item) => item.owner_type === "word" && item.owner_id === word.id,
            );
            const phonology = record.phonology.filter(
              (item) => item.owner_type === "word" && item.owner_id === word.id,
            );
            const morphemeForms = word.morphemes.map((morpheme) =>
              record.forms
                .filter(
                  (item) => item.owner_type === "morpheme" && item.owner_id === morpheme.id,
                )
                .map((item) => item.text)
                .join(" / "),
            );
            const glosses = [
              ...record.tier_translations.filter(
                (item) => item.owner_type === "word" && item.owner_id === word.id,
              ),
              ...word.morphemes.flatMap((morpheme) =>
                record.tier_translations.filter(
                  (item) =>
                    item.owner_type === "morpheme" && item.owner_id === morpheme.id,
                ),
              ),
            ];
            const formText = forms.map((item) => item.text).join(" / ");
            const phonologyText = phonology.map((item) => item.text).join(" / ");
            const morphemeText = morphemeForms.filter(Boolean).join(" - ");
            const glossText = glosses.map((item) => item.text).join(" · ");
            return (
              <tr key={word.id}>
                <th scope="row">{word.position + 1}</th>
                <td>{formText
                  ? <QueryHighlight text={formText} query={query} mode={mode} active={direction === "formosan"} />
                  : tx("not supplied", "未提供")}</td>
                <td>{phonologyText
                  ? <QueryHighlight text={phonologyText} query={query} mode={mode} active={direction === "formosan"} />
                  : tx("not supplied", "未提供")}</td>
                <td>{morphemeText
                  ? <QueryHighlight text={morphemeText} query={query} mode={mode} active={direction === "formosan"} />
                  : tx("not segmented", "未切分")}</td>
                <td>{glossText
                  ? <QueryHighlight text={glossText} query={query} mode={mode} active={direction === "translation"} />
                  : tx("not supplied", "未提供")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function SearchResultDetail({
  data,
  record,
  query,
  mode,
  direction,
  targetLanguage,
  learner,
  onSave,
  onNotice,
  onPractice,
}: {
  data: AppData;
  record: SearchRecord;
  query: string;
  mode: MatchMode;
  direction: SearchDirection;
  targetLanguage: string;
  learner: boolean;
  onSave: (record: SearchRecord) => void;
  onNotice: (notice: string) => void;
  onPractice?: (record: SearchRecord) => void;
}) {
  const {dialectName, languageName, locale, number, t, tx} = useI18n();
  const language = data.languages.find((item) => item.id === record.language_id);
  const corpus = data.corpora.find((item) => item.id === record.corpus_id);
  const stablePath = `/lookup?type=sentences&q=${encodeURIComponent(query)}&language=${encodeURIComponent(
    record.language_id,
  )}&corpus=${encodeURIComponent(record.corpus_id)}&target=${encodeURIComponent(targetLanguage)}&direction=${direction}&mode=${mode}&record=${encodeURIComponent(
    record.id,
  )}`;
  const citation = [
    corpus?.name ?? record.corpus_id,
    `${record.source_path}#${record.xml_id}`,
    `FormosanBank ${data.meta.source.commit}`,
    `Kakarayan ${data.meta.release_id}`,
  ].join(". ");
  const hasAnalysis =
    record.words.length > 0 ||
    record.phonology.length > 0 ||
    record.tier_translations.some((item) => item.owner_type !== "sentence");
  return (
    <article className="result-card" id={`record-${record.id}`}>
      <div className="result-card__scope">
        <span>{language ? languageName(language) : record.language_id}</span>
        {record.dialect && <span>{dialectName(record.dialect)}</span>}
        <span>{corpus?.name}</span>
      </div>
      <div lang={language?.iso639_3}>
        <SentenceText record={record} query={query} mode={mode} highlight={direction === "formosan"} />
      </div>
      {record.original && record.original !== record.standard && (
        <dl className="tier-pair">
          <div>
            <dt>{t("search.original")}</dt>
            <dd lang={language?.iso639_3}>
              <QueryHighlight text={record.original} query={query} mode={mode} active={direction === "formosan"} />
            </dd>
          </div>
          <div>
            <dt>{t("search.standard")}</dt>
            <dd lang={language?.iso639_3}>
              <QueryHighlight text={record.standard} query={query} mode={mode} active={direction === "formosan"} />
            </dd>
          </div>
        </dl>
      )}
      <div className="translations">
        {record.translations
          .filter((translation) => !targetLanguage || translation.xml_lang === targetLanguage)
          .map((translation, index) => {
            const isMatch = direction === "translation" &&
              queryMatchesText(translation.text, query, mode);
            return (
              <p
                key={`${translation.xml_lang}-${index}`}
                lang={translation.xml_lang}
                className={isMatch ? "translation-match" : undefined}
              >
                <span className="translation-meta">
                  {translationLanguageName(translation.xml_lang, locale)}
                  {isMatch && <small>{tx("match", "相符")}</small>}
                </span>
                <span className="translation-text">
                  <QueryHighlight text={translation.text} query={query} mode={mode} active={isMatch} />
                </span>
              </p>
            );
          })}
      </div>
      <div className="result-card__details">
      {hasAnalysis && (
        <details className="tier-details">
          <summary>{tx("Interlinear analysis", "逐行對譯分析")}</summary>
          <Interlinear record={record} query={query} mode={mode} direction={direction} />
          {record.phonology
            .filter((item) => item.owner_type === "sentence")
            .map((item) => (
              <p key={`${item.owner_id}-${item.position}`}>
                <strong>{tx("Sentence phonology", "句子音韻")}</strong>{" "}
                <QueryHighlight text={item.text} query={query} mode={mode} active={direction === "formosan"} />
              </p>
            ))}
        </details>
      )}
      {record.audio.length > 0 && (
        <details className="audio-evidence">
          <summary>{tx("Audio evidence", "音訊證據")} ({number(record.audio.length)})</summary>
          {record.audio.slice(0, 5).map((audio, index) => {
            const url = playableUrl(record, index);
            return (
              <div key={`${audio.owner_id}-${audio.position}`}>
                <code>{audio.file || audio.url || audio.source || tx("unnamed reference", "未命名參照")}</code>
                {audio.start !== null && (
                  <span>
                    {audio.start.toFixed(3)}s {tx("to", "至")} {audio.end?.toFixed(3) ?? tx("unknown", "未知")}s
                  </span>
                )}
                {url ? (
                  <audio controls preload="none" src={url} />
                ) : (
                  <small>{tx("Reference is not a public web URL.", "此參照不是公開網路網址。")}</small>
                )}
              </div>
            );
          })}
        </details>
      )}
      </div>
      <footer>
        <div className="result-card__actions">
          <button className="button button--primary" onClick={() => onSave(record)}>
            {t("search.save")}
          </button>
          {learner && onPractice && (
            <button className="button button--quiet" onClick={() => onPractice(record)}>
              {tx("Practice speaking", "練習口說")}
            </button>
          )}
          <button
            className="button button--quiet"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(citation);
                onNotice(tx("Release-pinned citation copied.", "已複製固定版本的引用。"));
              } catch {
                onNotice(tx(`Copy this citation: ${citation}`, `請複製此引用：${citation}`));
              }
            }}
          >
            {tx("Copy citation", "複製引用")}
          </button>
          {learner && (
            <Link
              className="button button--quiet"
              to={`/lookup?type=sentences&q=${encodeURIComponent(query)}&language=${record.language_id}&target=${targetLanguage}&direction=${direction}&mode=${mode}`}
            >
              {t("search.research")}
            </Link>
          )}
        </div>
        <details className="record-provenance">
          <summary>{tx("Source and record details", "來源與記錄詳情")}</summary>
          <div>
            <code>{record.xml_id || record.id}</code>
            <a
              href={`https://github.com/FormosanBank/FormosanBank/blob/${data.meta.source.commit}/${record.source_path}`}
              target="_blank"
              rel="noreferrer"
            >
              {tx("Source XML", "來源 XML")}
            </a>
            <Link to={stablePath}>{tx("Stable record link", "穩定記錄連結")}</Link>
            <Link to={`/corpora/${record.corpus_id}`}>{tx("Citation and rights", "引用與權利")}</Link>
          </div>
        </details>
      </footer>
    </article>
  );
}

export function SearchResultCard({
  data,
  summary,
  query,
  mode,
  direction,
  targetLanguage,
  learner,
  onSave,
  onNotice,
  onPractice,
}: {
  data: AppData;
  summary: SentenceSummary;
  query: string;
  mode: MatchMode;
  direction: SearchDirection;
  targetLanguage: string;
  learner: boolean;
  onSave: (record: SearchRecord) => void;
  onNotice: (notice: string) => void;
  onPractice?: (record: SearchRecord) => void;
}) {
  const {locale, tx} = useI18n();
  const [open, setOpen] = useState(false);
  const [record, setRecord] = useState<SearchRecord | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open || record) return;
    const controller = new AbortController();
    sentenceDetail(data.meta.release_id, summary.id, controller.signal).then(
      setRecord,
      (cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(apiErrorMessage(cause, tx));
          setOpen(false);
        }
      },
    );
    return () => controller.abort();
  }, [data.meta.release_id, open, record, summary.id, tx]);

  if (record) {
    return (
      <SearchResultDetail
        data={data}
        record={record}
        query={query}
        mode={mode}
        direction={direction}
        targetLanguage={targetLanguage}
        learner={learner}
        onSave={onSave}
        onNotice={onNotice}
        {...(onPractice ? {onPractice} : {})}
      />
    );
  }
  if (open) {
    return (
      <LoadingState
        className="result-card result-card--summary"
        compact
        label={tx("Loading full record", "正在載入完整記錄")}
      />
    );
  }
  const language = data.languages.find((item) => item.id === summary.language_id);
  const corpus = data.corpora.find((item) => item.id === summary.corpus_id);
  const visibleTranslations = summary.translations
    .filter((item) => !targetLanguage || item.xml_lang === targetLanguage)
    .slice(0, 3);
  const visibleMatch = direction === "formosan"
    ? queryMatchesText(summary.standard || summary.original, query, mode)
    : visibleTranslations.some((item) => queryMatchesText(item.text, query, mode));
  const hiddenMatchEvidence = visibleMatch ? [] : summary.match_evidence.slice(0, 2);
  return (
    <article className="result-card result-card--summary" id={`record-${summary.id}`}>
      <div className="result-card__scope">
        <span>{language?.name ?? summary.language_id}</span>
        {summary.dialect && <span>{summary.dialect}</span>}
        <span>{corpus?.name ?? summary.corpus_id}</span>
      </div>
      <h3 className="kwic">
        <QueryHighlight
          text={summary.standard || summary.original}
          query={query}
          mode={mode}
          active={direction === "formosan"}
        />
      </h3>
      <div className="translations">
        {hiddenMatchEvidence.map((item, index) => {
          const tier = item.tier === "sentence"
            ? tx("Sentence", "句")
            : item.tier === "word"
              ? tx("Word", "詞")
              : tx("Morpheme", "語素");
          const field = item.field === "translation"
            ? translationLanguageName(item.xml_lang, locale)
            : tx("source form", "來源形式");
          return (
            <p key={`match-${item.tier}-${item.field}-${index}`} className="translation-match">
              <span className="translation-meta">
                {tier} · {field}
                <small>{tx("match", "相符")}</small>
              </span>
              <span className="translation-text">
                <QueryHighlight text={item.text} query={query} mode={mode} active />
              </span>
            </p>
          );
        })}
        {visibleTranslations.map((item, index) => {
          const isMatch = direction === "translation" &&
            queryMatchesText(item.text, query, mode);
          return (
            <p key={`${item.xml_lang}-${index}`} className={isMatch ? "translation-match" : undefined}>
              <span className="translation-meta">
                {translationLanguageName(item.xml_lang, locale)}
              </span>
              <span className="translation-text">
                <QueryHighlight text={item.text} query={query} mode={mode} active={isMatch} />
              </span>
            </p>
          );
        })}
      </div>
      <button className="button button--quiet" onClick={() => { setError(""); setOpen(true); }}>
        {tx("Open full record", "開啟完整記錄")}
      </button>
      {summary.summary_truncated && (
        <small>{tx("Summary shortened. Open the full record for every tier.", "摘要已縮短。開啟完整記錄以查看所有層級。")}</small>
      )}
      {error && <p className="callout callout--error">{error}</p>}
    </article>
  );
}
