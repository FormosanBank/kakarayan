import {PageIntro, StatusBadge} from "../components/Layout";
import {Link} from "../routing";
import type {AppData, Corpus, Counts, Language} from "../types";

function CountsGrid({counts}: {counts: Counts}) {
  const entries = Object.entries(counts).filter(([, value]) => value !== undefined);
  return (
    <dl className="detail-counts">
      {entries.map(([name, value]) => (
        <div key={name}>
          <dt>{name}</dt>
          <dd>{value?.toLocaleString()}</dd>
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
  const corpora = data.corpora.filter((corpus) => corpus.languages.includes(language.id));
  return (
    <div className="page-wrap">
      <PageIntro
        title={language.name}
        lede={`${language.names["zh-Hant"] || "No reviewed Traditional Chinese name"} · ${
          language.names.autonym || "No reviewed autonym"
        } · ISO 639-3 ${language.iso639_3}`}
      />
      <div className="detail-actions">
        <Link className="button button--primary" to={`/search?language=${language.id}`}>
          Search this language
        </Link>
        <Link className="button button--quiet" to={`/downloads?language=${language.id}`}>
          Filter prepared data
        </Link>
      </div>
      <section className="detail-section">
        <h2>Published coverage</h2>
        <CountsGrid counts={language.counts} />
        <div className="capabilities">
          {language.capabilities.map((capability) => (
            <span key={capability}>{capability}</span>
          ))}
        </div>
        <p>
          Counts describe this release, not the number of speakers, dialect vitality, or
          completeness of the language.
        </p>
      </section>
      <section className="detail-section">
        <h2>Participating corpora</h2>
        <div className="detail-list">
          {corpora.map((corpus) => (
            <article key={corpus.id}>
              <div>
                <h3>{corpus.name}</h3>
                <p>{corpus.source_path}</p>
              </div>
              <CountsGrid counts={corpus.counts} />
              <Link to={`/corpora/${corpus.id}`}>Corpus details →</Link>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}

export function CorpusDetail({data, corpus}: {data: AppData; corpus: Corpus}) {
  const rights = data.rights.entries.find((entry) => entry.id === corpus.rights_id);
  const languages = corpus.languages
    .map((id) => data.languages.find((language) => language.id === id))
    .filter((language): language is Language => Boolean(language));
  return (
    <div className="page-wrap">
      <PageIntro
        title={corpus.name}
        lede={`Public source scope ${corpus.source_path}. Every link and count is pinned to ${data.meta.release_id}.`}
      />
      <div className="detail-actions">
        {languages.map((language) => (
          <Link
            className="button button--primary"
            key={language.id}
            to={`/search?language=${language.id}&corpus=${corpus.id}`}
          >
            Search {language.name}
          </Link>
        ))}
        <Link className="button button--quiet" to={`/downloads?corpus=${corpus.id}`}>
          Filter prepared data
        </Link>
        <a
          className="button button--quiet"
          href={`https://github.com/FormosanBank/FormosanBank/tree/${data.meta.source.commit}/${corpus.source_path}`}
        >
          Pinned public source
        </a>
      </div>
      <section className="detail-section">
        <h2>Corpus coverage</h2>
        <CountsGrid counts={corpus.counts} />
        <p>
          Display languages:{" "}
          {languages.map((language) => language.name).join(", ") || "not resolved"}.
        </p>
      </section>
      <section className="detail-section">
        <h2>Rights and attribution</h2>
        <StatusBadge value={rights?.redistribution ?? "review_required"} />
        <p>{rights?.attribution || "No reviewed attribution statement is published."}</p>
        <p>{rights?.notes}</p>
        <dl className="detail-metadata">
          <div>
            <dt>Review</dt>
            <dd>{rights?.review_status ?? "review_required"}</dd>
          </div>
          <div>
            <dt>License expression</dt>
            <dd>{rights?.license_expression ?? "not established"}</dd>
          </div>
          <div>
            <dt>Commercial use</dt>
            <dd>{rights?.commercial_use ?? "unknown"}</dd>
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
          Public repository visibility is not a blanket license. Retain corpus-specific
          notices and source citations with every derived record.
        </p>
      </section>
    </div>
  );
}
