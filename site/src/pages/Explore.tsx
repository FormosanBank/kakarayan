import {useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

export function Explore({data}: {data: AppData}) {
  const {locale, t} = useI18n();
  const [view, setView] = useState<"languages" | "corpora">("languages");
  const [filter, setFilter] = useState("");
  const rights = useMemo(
    () => new Map(data.rights.entries.map((entry) => [entry.id, entry])),
    [data.rights.entries],
  );
  const needle = filter.trim().toLocaleLowerCase();
  return (
    <div className="page-wrap">
      <PageIntro title={t("explore.title")} lede={t("explore.lede")} />
      <div className="explore-toolbar">
        <div className="segmented">
          <button aria-pressed={view === "languages"} onClick={() => setView("languages")}>
            Languages <span>{data.languages.length}</span>
          </button>
          <button aria-pressed={view === "corpora"} onClick={() => setView("corpora")}>
            Corpora <span>{data.corpora.length}</span>
          </button>
        </div>
        <label className="field field--compact">
          <span className="sr-only">Filter {view}</span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={`Filter ${view}…`}
          />
        </label>
      </div>

      {view === "languages" ? (
        <div className="catalog-grid">
          {data.languages
            .filter((language) =>
              `${language.name} ${language.names["zh-Hant"]} ${language.iso639_3}`
                .toLocaleLowerCase()
                .includes(needle),
            )
            .map((language, index) => (
              <article className="catalog-card" key={language.id}>
                <span className="catalog-card__number">{String(index + 1).padStart(2, "0")}</span>
                <p className="catalog-card__local">
                  {locale === "zh-Hant" ? language.names["zh-Hant"] : language.name}
                </p>
                <h2>{language.name}</h2>
                <p>
                  ISO <code>{language.iso639_3}</code>
                </p>
                <div className="capabilities">
                  {language.capabilities.map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
                <dl className="mini-stats">
                  <div>
                    <dt>Sentences</dt>
                    <dd>{(language.counts.sentences ?? 0).toLocaleString()}</dd>
                  </div>
                  <div>
                    <dt>Tokens</dt>
                    <dd>{(language.counts.tokens ?? 0).toLocaleString()}</dd>
                  </div>
                </dl>
                <Link to={`/search?language=${language.id}`}>Search this language →</Link>
              </article>
            ))}
        </div>
      ) : (
        <div className="corpus-list">
          {data.corpora
            .filter((corpus) => corpus.name.toLocaleLowerCase().includes(needle))
            .map((corpus) => {
              const policy = rights.get(corpus.rights_id);
              return (
                <article key={corpus.id}>
                  <div>
                    <p className="eyebrow">{corpus.source_path}</p>
                    <h2>{corpus.name}</h2>
                    <p>
                      {corpus.languages
                        .map((id) => data.languages.find((language) => language.id === id)?.name)
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                  </div>
                  <dl className="mini-stats">
                    <div>
                      <dt>Texts</dt>
                      <dd>{(corpus.counts.texts ?? 0).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Sentences</dt>
                      <dd>{(corpus.counts.sentences ?? 0).toLocaleString()}</dd>
                    </div>
                    <div>
                      <dt>Audio refs</dt>
                      <dd>{(corpus.counts.audio ?? 0).toLocaleString()}</dd>
                    </div>
                  </dl>
                  <div className="corpus-actions">
                    <StatusBadge value={policy?.redistribution ?? "review_required"} />
                    <Link to={`/search?corpus=${corpus.id}`}>Search →</Link>
                    <a
                      href={`https://github.com/FormosanBank/FormosanBank/tree/${data.meta.source.commit}/${corpus.source_path}`}
                    >
                      Source
                    </a>
                  </div>
                </article>
              );
            })}
        </div>
      )}
    </div>
  );
}
