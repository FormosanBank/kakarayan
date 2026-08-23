import {useI18n} from "../i18n";
import {Link} from "../routing";
import {translationLanguageName} from "../translationLanguages";
import type {AppData, DictionaryEntry, MatchMode, SearchDirection} from "../types";
import {QueryHighlight} from "./QueryHighlight";

export function CandidateGroups({
  data,
  entries,
  targetLanguage,
  corpusId,
  query,
  mode,
  direction,
  onSave,
  onViewSentences,
}: {
  data: AppData;
  entries: DictionaryEntry[];
  targetLanguage: string;
  corpusId: string;
  query: string;
  mode: MatchMode;
  direction: SearchDirection;
  onSave: (entry: DictionaryEntry) => void;
  onViewSentences?: (entry: DictionaryEntry) => void;
}) {
  const {locale, number, tx} = useI18n();
  return (
    <div className="candidate-groups">
      {entries.map((entry) => {
        const sentenceLink = `/lookup?type=sentences&q=${encodeURIComponent(entry.headword)}&language=${encodeURIComponent(entry.language_id)}&target=${encodeURIComponent(targetLanguage)}&direction=formosan&mode=exact${corpusId ? `&corpus=${encodeURIComponent(corpusId)}` : ""}`;
        return (
          <article key={entry.id} className="dictionary-entry">
            <header>
              <h3>
                <QueryHighlight
                  text={entry.display_form}
                  query={query}
                  mode={mode}
                  active={direction === "formosan"}
                />
              </h3>
              <span>
                {number(entry.occurrences)} {tx("occurrences", "筆出現")}
              </span>
            </header>
            <div className="dictionary-entry__meaning">
              <span>{translationLanguageName(targetLanguage, locale)}</span>
              {entry.meanings.length ? (
                <ol>
                  {entry.meanings.map((meaning) => (
                    <li key={meaning}>
                      <QueryHighlight
                        text={meaning}
                        query={query}
                        mode={mode}
                        active={direction === "translation"}
                      />
                    </li>
                  ))}
                </ol>
              ) : (
                <p>{tx("No tagged word-level meaning.", "沒有已標記的詞級釋義。")}</p>
              )}
            </div>
            {(entry.pronunciations.length > 0 || entry.variants.length > 1) && (
              <dl className="dictionary-entry__details">
                {entry.pronunciations.length > 0 && (
                  <div>
                    <dt>{tx("Pronunciation", "發音")}</dt>
                    <dd>
                      <QueryHighlight
                        text={entry.pronunciations.join(" · ")}
                        query={query}
                        mode={mode}
                        active={direction === "formosan"}
                      />
                    </dd>
                  </div>
                )}
                {entry.variants.length > 1 && (
                  <div>
                    <dt>{tx("Variants", "變體")}</dt>
                    <dd>
                      <QueryHighlight
                        text={entry.variants.join(" · ")}
                        query={query}
                        mode={mode}
                        active={direction === "formosan"}
                      />
                    </dd>
                  </div>
                )}
                <div>
                  <dt>{tx("Corpora", "語料庫")}</dt>
                  <dd>{number(entry.corpus_ids.length)}</dd>
                </div>
              </dl>
            )}
            <footer>
              {onViewSentences ? (
                <button
                  className="button button--quiet"
                  type="button"
                  onClick={() => onViewSentences(entry)}
                >
                  {tx("View sentences", "查看例句")}
                </button>
              ) : (
                <Link className="button button--quiet" to={sentenceLink}>
                  {tx("View sentences", "查看例句")}
                </Link>
              )}
              <button
                className="button button--primary"
                disabled={!entry.meanings.length}
                onClick={() => onSave(entry)}
              >
                {tx("Save word", "儲存單詞")}
              </button>
              <small>
                {entry.corpus_ids.map((id, index) => (
                  <span key={id}>
                    {index > 0 && " · "}
                    <Link to={`/corpora/${id}`}>
                      {data.corpora.find((corpus) => corpus.id === id)?.name ?? id}
                    </Link>
                  </span>
                ))}
              </small>
            </footer>
          </article>
        );
      })}
    </div>
  );
}
