import {useCallback, useEffect, useMemo, useState, type ChangeEvent} from "react";

import {useI18n} from "../i18n";
import {
  cardsAsAnkiTsv,
  deleteCard,
  exportBackup,
  listCards,
  makeManualCard,
  restoreBackup,
  saveCard,
  scheduleCard,
  type Grade,
  type StudyCard,
} from "../study";
import type {Language} from "../types";

function download(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], {type}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StudyDeck({
  languages,
  currentRelease,
}: {
  languages: Language[];
  currentRelease: string;
}) {
  const {t} = useI18n();
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [error, setError] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [deck, setDeck] = useState("Personal");
  const [languageId, setLanguageId] = useState(languages[0]?.id ?? "");
  const [tags, setTags] = useState("");
  const [filter, setFilter] = useState("");
  const reload = useCallback(() => {
    listCards().then(
      (nextCards) => {
        setCards(nextCards);
        setNow(Date.now());
      },
      (cause: unknown) => setError(cause instanceof Error ? cause.message : String(cause)),
    );
  }, []);

  useEffect(reload, [reload]);
  const due = useMemo(
    () =>
      [...cards]
        .filter((card) => Date.parse(card.dueAt) <= now)
        .sort((left, right) => left.dueAt.localeCompare(right.dueAt)),
    [cards, now],
  );
  const current = due[0];
  const staleCards = cards.filter(
    (card) => card.source && card.source.releaseId !== currentRelease,
  );
  const visibleCards = cards.filter((card) => {
    const needle = filter.trim().toLocaleLowerCase();
    return (
      !needle ||
      `${card.front} ${card.back} ${card.deck} ${card.tags.join(" ")}`
        .toLocaleLowerCase()
        .includes(needle)
    );
  });

  async function grade(value: Grade) {
    if (!current) return;
    await saveCard(scheduleCard(current, value, new Date()));
    setShowAnswer(false);
    reload();
  }

  async function backup() {
    const value = await exportBackup();
    download(
      `${JSON.stringify(value, null, 2)}\n`,
      `kakarayan-study-${new Date().toISOString().slice(0, 10)}.json`,
      "application/json",
    );
  }

  async function restore(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      await restoreBackup(JSON.parse(await file.text()) as unknown);
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  async function remove(card: StudyCard) {
    if (!window.confirm(`Delete "${card.front}" from this device?`)) return;
    await deleteCard(card.id);
    reload();
  }

  async function addManualCard() {
    try {
      await saveCard(
        makeManualCard({
          front,
          back,
          deck,
          languageId,
          tags: tags.split(/[\s,]+/u),
        }),
      );
      setFront("");
      setBack("");
      setTags("");
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="study-deck">
      <div className="deck-toolbar">
        <div>
          <strong>{cards.length}</strong> cards · <strong>{due.length}</strong> {t("deck.due")}
        </div>
        <div className="button-row">
          <button className="button button--quiet" onClick={backup} disabled={!cards.length}>
            {t("deck.export")}
          </button>
          <button
            className="button button--quiet"
            onClick={() =>
              download(cardsAsAnkiTsv(cards), "kakarayan-anki.tsv", "text/tab-separated-values")
            }
            disabled={!cards.length}
          >
            Anki TSV
          </button>
          <label className="button button--quiet file-button">
            {t("deck.import")}
            <input type="file" accept="application/json,.json" onChange={restore} />
          </label>
        </div>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      {staleCards.length > 0 && (
        <p className="callout callout--warning">
          {staleCards.length} cited card{staleCards.length === 1 ? "" : "s"} came from an
          older data release. The saved text is unchanged; open a fresh corpus result before
          treating it as current.
        </p>
      )}
      <details className="manual-card">
        <summary>Create a personal card</summary>
        <div className="form-grid">
          <label className="field">
            Front
            <input value={front} maxLength={500} onChange={(event) => setFront(event.target.value)} />
          </label>
          <label className="field">
            Answer
            <input value={back} maxLength={1_500} onChange={(event) => setBack(event.target.value)} />
          </label>
          <label className="field">
            Deck
            <input value={deck} maxLength={80} onChange={(event) => setDeck(event.target.value)} />
          </label>
          <label className="field">
            Language
            <select value={languageId} onChange={(event) => setLanguageId(event.target.value)}>
              {languages.map((language) => (
                <option key={language.id} value={language.id}>
                  {language.name}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            Tags
            <input
              value={tags}
              maxLength={300}
              onChange={(event) => setTags(event.target.value)}
              placeholder="comma or space separated"
            />
          </label>
        </div>
        <button
          className="button button--primary"
          disabled={!front.trim() || !back.trim()}
          onClick={addManualCard}
        >
          Save local card
        </button>
      </details>
      {!cards.length && <div className="empty-state">{t("deck.empty")}</div>}
      {current && (
        <article className="review-card">
          <span>{current.deck} · local card</span>
          <h3>{current.front}</h3>
          {!showAnswer ? (
            <button className="button button--primary" onClick={() => setShowAnswer(true)}>
              Show answer
            </button>
          ) : (
            <>
              <div className="review-answer">{current.back}</div>
              <div className="grade-row" aria-label="Review grade">
                {(["again", "hard", "good", "easy"] as Grade[]).map((gradeValue) => (
                  <button key={gradeValue} onClick={() => grade(gradeValue)}>
                    {gradeValue}
                  </button>
                ))}
              </div>
            </>
          )}
          {current.source && (
            <small>
              Source {current.source.recordId} · release {current.source.releaseId}
            </small>
          )}
        </article>
      )}
      {cards.length > 0 && (
        <details className="card-inventory">
          <summary>All local cards ({cards.length})</summary>
          <label className="field">
            Filter cards, decks, or tags
            <input value={filter} onChange={(event) => setFilter(event.target.value)} />
          </label>
          <ul>
            {visibleCards.map((card) => (
              <li key={card.id}>
                <span>
                  <strong>{card.front}</strong>
                  {card.back}
                  <small>{card.deck} · {card.tags.join(" · ") || "no tags"}</small>
                </span>
                <button className="text-button text-button--danger" onClick={() => remove(card)}>
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
