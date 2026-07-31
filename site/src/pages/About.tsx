import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function About({data}: {data: AppData}) {
  const {t} = useI18n();
  return (
    <div className="page-wrap page-wrap--prose">
      <PageIntro title={t("about.title")} lede={t("about.lede")} />
      <section>
        <p className="eyebrow">Architecture</p>
        <h2>Canonical source, reproducible projections</h2>
        <p>
          FormosanBank XML under each public corpus <code>XML/</code> directory is the source
          of truth. Kakarayan pins one public commit, preserves source paths and checksums,
          and derives search shards, tables, SQLite, manifests, and the static API. It never
          reconstructs archival XML from those projections.
        </p>
      </section>
      <section>
        <p className="eyebrow">Language identity</p>
        <h2>Dialect is data, not decoration</h2>
        <p>
          Language identity comes from <code>xml:lang</code> plus the source dialect. Seediq
          and Truku intentionally remain distinct even though both use ISO 639-3{" "}
          <code>trv</code>. Unknown and unspecified dialect values remain visible.
        </p>
      </section>
      <section>
        <p className="eyebrow">Orthography</p>
        <h2>Original does not mean standard</h2>
        <p>
          Source orthography preserves the published transcription. FormosanBank standard
          orthography is a comparative projection. Neither is silently substituted for the
          other. Automatic transliteration is not labeled as phonetic transcription.
        </p>
      </section>
      <section>
        <p className="eyebrow">Rights and responsible use</p>
        <h2>Public is not a single license</h2>
        <p>{data.rights.central_terms.use_summary}</p>
        <p>
          Commercial AI use is <strong>{data.rights.central_terms.commercial_ai}</strong>{" "}
          under the central terms. Corpus, XML-root, audio, media, and source notices may add
          further requirements. Kakarayan fails closed when redistribution has not been
          reviewed.
        </p>
        <ul>
          {data.rights.central_terms.evidence.map((url) => (
            <li key={url}>
              <a href={url}>{url.split("/").pop()}</a>
            </li>
          ))}
        </ul>
      </section>
      <section>
        <p className="eyebrow">People</p>
        <h2>A collaboration, not an automated authority</h2>
        <p>
          Kakarayan began with Gabriel Gras's public corpus interface and is developed with
          FormosanBank. Corpus creators, speakers, annotators, educators, and source
          communities must be credited through the citations attached to each corpus.
          Machine output is never represented as their review.
        </p>
      </section>
      <aside className="release-note">
        <strong>{data.meta.release_id}</strong>
        <span>FormosanBank {data.meta.source.commit}</span>
        <a href="https://github.com/FormosanBank/kakarayan/issues">Report a problem</a>
      </aside>
    </div>
  );
}
