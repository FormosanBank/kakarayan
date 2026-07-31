import {normalizeSearch, type SearchMode} from "../data";
import {useI18n} from "../i18n";
import {Link} from "../routing";
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

function tokenMatches(surface: string, normalized: string, query: string, mode: SearchMode) {
  const needle = normalizeSearch(query);
  if (mode === "source") return surface.normalize("NFC") === query.normalize("NFC").trim();
  if (mode === "exact") return normalized === needle;
  if (mode === "prefix") return normalized.startsWith(needle);
  if (mode === "contains") return normalized.includes(needle);
  return false;
}

function Kwic({record, query, mode}: {record: SearchRecord; query: string; mode: SearchMode}) {
  if (!record.tokens.length) return null;
  const matched = record.tokens.findIndex((token) =>
    tokenMatches(token.surface, token.normalized, query, mode),
  );
  const center = matched < 0 ? 0 : matched;
  const start = Math.max(0, center - 5);
  const end = Math.min(record.tokens.length, center + (matched < 0 ? 12 : 6));
  return (
    <div className="kwic" aria-label="Keyword in sentence context">
      {start > 0 && <span aria-hidden="true">…</span>}
      {record.tokens.slice(start, end).map((token, offset) => {
        const position = start + offset;
        return position === matched ? (
          <mark key={`${token.position}-${token.word_id}`}>{token.surface}</mark>
        ) : (
          <span key={`${token.position}-${token.word_id}`}>{token.surface}</span>
        );
      })}
      {end < record.tokens.length && <span aria-hidden="true">…</span>}
    </div>
  );
}

function Interlinear({record}: {record: SearchRecord}) {
  if (!record.words.length) return null;
  return (
    <div className="table-scroll interlinear-table" tabIndex={0}>
      <table>
        <thead>
          <tr>
            <th>Position</th>
            <th>Word forms</th>
            <th>Phonology</th>
            <th>Morphemes</th>
            <th>Glosses</th>
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
                <td>{forms.map((item) => item.text).join(" / ") || "not supplied"}</td>
                <td>{phonology.map((item) => item.text).join(" / ") || "not supplied"}</td>
                <td>{morphemeForms.filter(Boolean).join(" - ") || "not segmented"}</td>
                <td>{glosses.map((item) => item.text).join(" · ") || "not supplied"}</td>
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
  learner,
  onSave,
  onNotice,
}: {
  data: AppData;
  record: SearchRecord;
  query: string;
  mode: SearchMode;
  learner: boolean;
  onSave: (record: SearchRecord) => void;
  onNotice: (notice: string) => void;
}) {
  const {t} = useI18n();
  const language = data.languages.find((item) => item.id === record.language_id);
  const corpus = data.corpora.find((item) => item.id === record.corpus_id);
  const stablePath = `/search?q=${encodeURIComponent(query)}&language=${encodeURIComponent(
    record.language_id,
  )}&corpus=${encodeURIComponent(record.corpus_id)}&mode=${mode}&record=${encodeURIComponent(
    record.id,
  )}`;
  const citation = [
    corpus?.name ?? record.corpus_id,
    `${record.source_path}#${record.xml_id}`,
    `FormosanBank ${data.meta.source.commit}`,
    `Kakarayan ${data.meta.release_id}`,
  ].join(". ");
  return (
    <article className="result-card" id={`record-${record.id}`}>
      <div className="result-card__scope">
        <span>{language?.name}</span>
        {record.dialect && <span>{record.dialect}</span>}
        <span>{corpus?.name}</span>
      </div>
      <h3 lang={language?.iso639_3}>{record.standard || record.original || "Untranscribed sentence"}</h3>
      <Kwic record={record} query={query} mode={mode} />
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
        {record.translations.map((translation, index) => (
          <p key={`${translation.xml_lang}-${index}`} lang={translation.xml_lang}>
            <span>{translation.xml_lang || "translation"}</span>
            {translation.text}
          </p>
        ))}
      </div>
      {(record.words.length > 0 ||
        record.phonology.length > 0 ||
        record.tier_translations.some((item) => item.owner_type !== "sentence")) && (
        <details className="tier-details">
          <summary>Expand sentence and interlinear tiers</summary>
          <Interlinear record={record} />
          {record.phonology
            .filter((item) => item.owner_type === "sentence")
            .map((item) => (
              <p key={`${item.owner_id}-${item.position}`}>
                <strong>Sentence phonology</strong> {item.text}
              </p>
            ))}
        </details>
      )}
      {record.audio.length > 0 && (
        <details className="audio-evidence">
          <summary>Audio evidence ({record.audio.length})</summary>
          {record.audio.slice(0, 5).map((audio, index) => {
            const url = playableUrl(record, index);
            return (
              <div key={`${audio.owner_id}-${audio.position}`}>
                <code>{audio.file || audio.url || audio.source || "unnamed reference"}</code>
                {audio.start !== null && (
                  <span>
                    {audio.start.toFixed(3)}s to {audio.end?.toFixed(3) ?? "unknown"}s
                  </span>
                )}
                {url ? <audio controls preload="none" src={url} /> : <small>Reference is not a public web URL.</small>}
              </div>
            );
          })}
        </details>
      )}
      <footer>
        <code>{record.xml_id || record.id}</code>
        <a
          href={`https://github.com/FormosanBank/FormosanBank/blob/${data.meta.source.commit}/${record.source_path}`}
          target="_blank"
          rel="noreferrer"
        >
          Source XML
        </a>
        <Link to={stablePath}>Stable record link</Link>
        <Link to={`/corpora/${record.corpus_id}`}>Citation and rights</Link>
        <button
          className="text-button"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(citation);
              onNotice("Release-pinned citation copied.");
            } catch {
              onNotice(`Copy this citation: ${citation}`);
            }
          }}
        >
          Copy citation
        </button>
        <button className="text-button" onClick={() => onSave(record)}>
          {t("search.save")}
        </button>
        {learner && (
          <Link
            className="text-button"
            to={`/search?q=${encodeURIComponent(query)}&language=${record.language_id}`}
          >
            {t("search.research")}
          </Link>
        )}
      </footer>
    </article>
  );
}
