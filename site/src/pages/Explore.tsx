import {useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
import type {AppData} from "../types";

export function Explore({data}: {data: AppData}) {
  const {locale, number, t, tx} = useI18n();
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
            {tx("Languages", "語言")} <span>{number(data.languages.length)}</span>
          </button>
          <button aria-pressed={view === "corpora"} onClick={() => setView("corpora")}>
            {tx("Corpora", "語料庫")} <span>{number(data.corpora.length)}</span>
          </button>
        </div>
        <label className="field field--compact">
          <span className="sr-only">
            {view === "languages" ? tx("Filter languages", "篩選語言") : tx("Filter corpora", "篩選語料庫")}
          </span>
          <input
            type="search"
            value={filter}
            onChange={(event) => setFilter(event.target.value)}
            placeholder={
              view === "languages" ? tx("Filter languages…", "篩選語言…") : tx("Filter corpora…", "篩選語料庫…")
            }
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
                  {tx("ISO", "ISO 代碼")} <code>{language.iso639_3}</code>
                </p>
                <p>
                  {language.dialects.length
                    ? language.dialects.slice(0, 4).join(" · ")
                    : tx("No dialect label supplied", "未提供方言標籤")}
                </p>
                <div className="capabilities">
                  {language.capabilities.map((capability) => (
                    <span key={capability}>{capability}</span>
                  ))}
                </div>
                <dl className="mini-stats">
                  <div>
                    <dt>{tx("Sentences", "句子")}</dt>
                    <dd>{number(language.counts.sentences ?? 0)}</dd>
                  </div>
                  <div>
                    <dt>{tx("Tokens", "詞元")}</dt>
                    <dd>{number(language.counts.tokens ?? 0)}</dd>
                  </div>
                </dl>
                <Link to={`/languages/${language.id}`}>
                  {tx("Language details →", "語言詳細資料 →")}
                </Link>
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
                      <dt>{tx("Texts", "文本")}</dt>
                      <dd>{number(corpus.counts.texts ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>{tx("Sentences", "句子")}</dt>
                      <dd>{number(corpus.counts.sentences ?? 0)}</dd>
                    </div>
                    <div>
                      <dt>{tx("Audio refs", "音訊參照")}</dt>
                      <dd>{number(corpus.counts.audio ?? 0)}</dd>
                    </div>
                  </dl>
                  <div className="corpus-actions">
                    <StatusBadge value={policy?.redistribution ?? "review_required"} />
                    <Link to={`/corpora/${corpus.id}`}>
                      {tx("Corpus details →", "語料庫詳細資料 →")}
                    </Link>
                    <a
                      href={`https://github.com/FormosanBank/FormosanBank/tree/${data.meta.source.commit}/${corpus.source_path}`}
                    >
                      {tx("Source", "來源")}
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
