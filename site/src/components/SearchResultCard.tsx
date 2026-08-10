import {
  translationTextMatches,
  type SearchDirection,
  type SearchMode,
} from "../data";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import {translationLanguageName} from "../translationLanguages";
import type {AppData, SearchRecord} from "../types";

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

function HighlightedText({
  text,
  query,
  active,
}: {
  text: string;
  query: string;
  active: boolean;
}) {
  if (!active) return text;
  const needle = query.trim();
  const match = needle ? text.toLocaleLowerCase().indexOf(needle.toLocaleLowerCase()) : -1;
  if (match < 0) return text;
  return (
    <>
      {text.slice(0, match)}
      <mark>{text.slice(match, match + needle.length)}</mark>
      {text.slice(match + needle.length)}
    </>
  );
}

function SentenceText({
  record,
  query,
  highlight,
}: {
  record: SearchRecord;
  query: string;
  highlight: boolean;
}) {
  const {tx} = useI18n();
  const text = record.standard || record.original || tx("Untranscribed sentence", "未轉錄句子");
  return (
    <h3 className="kwic">
      <HighlightedText text={text} query={query} active={highlight} />
    </h3>
  );
}

function Interlinear({record}: {record: SearchRecord}) {
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
            return (
              <tr key={word.id}>
                <th scope="row">{word.position + 1}</th>
                <td>{forms.map((item) => item.text).join(" / ") || tx("not supplied", "未提供")}</td>
                <td>{phonology.map((item) => item.text).join(" / ") || tx("not supplied", "未提供")}</td>
                <td>{morphemeForms.filter(Boolean).join(" - ") || tx("not segmented", "未切分")}</td>
                <td>{glosses.map((item) => item.text).join(" · ") || tx("not supplied", "未提供")}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function SearchResultCard({
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
  mode: SearchMode;
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
        <SentenceText record={record} query={query} highlight={direction === "formosan"} />
      </div>
      {record.original && record.original !== record.standard && (
        <dl className="tier-pair">
          <div>
            <dt>{t("search.original")}</dt>
            <dd lang={language?.iso639_3}>{record.original}</dd>
          </div>
          <div>
            <dt>{t("search.standard")}</dt>
            <dd lang={language?.iso639_3}>{record.standard}</dd>
          </div>
        </dl>
      )}
      <div className="translations">
        {record.translations
          .filter((translation) => !targetLanguage || translation.xml_lang === targetLanguage)
          .map((translation, index) => {
            const isMatch = direction === "translation" &&
              translationTextMatches(translation.text, query, mode);
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
                  <HighlightedText text={translation.text} query={query} active={isMatch} />
                </span>
              </p>
            );
          })}
      </div>
      <div className="result-card__details">
      {hasAnalysis && (
        <details className="tier-details">
          <summary>{tx("Interlinear analysis", "逐行對譯分析")}</summary>
          <Interlinear record={record} />
          {record.phonology
            .filter((item) => item.owner_type === "sentence")
            .map((item) => (
              <p key={`${item.owner_id}-${item.position}`}>
                <strong>{tx("Sentence phonology", "句子音韻")}</strong> {item.text}
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
