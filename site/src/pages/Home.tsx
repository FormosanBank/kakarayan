import {PageIntro, Stat} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

export function Home({data}: {data: AppData}) {
  const {t} = useI18n();
  const counts = data.corpora.reduce(
    (total, corpus) => {
      total.sentences += corpus.counts.sentences ?? 0;
      total.tokens += corpus.counts.tokens ?? 0;
      total.audio += corpus.counts.audio ?? 0;
      return total;
    },
    {sentences: 0, tokens: 0, audio: 0},
  );
  return (
    <>
      <section className="hero">
        <div className="hero__copy">
          <PageIntro
            eyebrow={t("home.eyebrow")}
            title={t("home.title")}
            lede={t("home.lede")}
          />
          <div className="hero__actions">
            <Link className="button button--primary" to="/search">
              {t("home.search")}
            </Link>
            <Link className="button button--paper" to="/learn">
              {t("home.learn")}
            </Link>
          </div>
          <p className="privacy-line">
            <span aria-hidden="true">◉</span> Corpus search runs locally. Study progress stays
            on this device.
          </p>
        </div>
        <div className="hero__field-card" aria-label="Kakarayan principles">
          <span className="field-card__number">01</span>
          <p className="field-card__script">kakarayan</p>
          <h2>Source before certainty</h2>
          <p>
            Every attestation keeps its corpus, dialect, XML path, orthography label,
            citation, and rights context.
          </p>
          <div className="field-card__rule" />
          <small>FormosanBank public release · {data.meta.release_id}</small>
        </div>
      </section>

      <section className="collection-band">
        <div className="section-heading">
          <p className="eyebrow">{t("home.collection")}</p>
          <h2>One bank, many kinds of evidence</h2>
        </div>
        <div className="stats-grid">
          <Stat value={data.languages.length} label="display languages" tone="ink" />
          <Stat value={data.corpora.length} label="public corpora" tone="coral" />
          <Stat value={counts.sentences} label="sentences" tone="gold" />
          <Stat value={counts.tokens} label="searchable tokens" tone="moss" />
        </div>
      </section>

      <section className="pathways">
        <article className="pathway pathway--learn">
          <span className="pathway__index">A</span>
          <p className="eyebrow">For learners and families</p>
          <h2>Find a word. Hear the source. Make it yours.</h2>
          <p>
            Begin with Amis examples, save local cards, record yourself, and use optional MT
            or ASR with clear third-party disclosure.
          </p>
          <Link to="/learn">Open the learner studio →</Link>
        </article>
        <article className="pathway pathway--research">
          <span className="pathway__index">B</span>
          <p className="eyebrow">For linguists</p>
          <h2>Move from concordance to reproducible dataset.</h2>
          <p>
            Search source and standardized forms, preserve tier order, inspect rights, and
            download normalized or canonical representations.
          </p>
          <Link to="/explore">Explore research data →</Link>
        </article>
        <article className="pathway pathway--build">
          <span className="pathway__index">C</span>
          <p className="eyebrow">For builders</p>
          <h2>Start static. Add the live API only when useful.</h2>
          <p>
            Versioned JSON, checksums, schemas, model metadata, and thin clients keep
            integrations public and reproducible.
          </p>
          <Link to="/developers">Read developer access →</Link>
        </article>
      </section>
    </>
  );
}
