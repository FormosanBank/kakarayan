import {useCallback, useEffect, useMemo, useState, type ChangeEvent} from "react";

import {useI18n} from "../i18n";
import {
  cardsAsAnkiTsv,
  deleteCard,
  exportBackup,
  listCards,
  restoreBackup,
  saveCard,
  scheduleCard,
  type Grade,
  type StudyCard,
} from "../study";

function download(value: string, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([value], {type}));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = name;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function StudyDeck() {
  const {t} = useI18n();
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [error, setError] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
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
          <ul>
            {cards.map((card) => (
              <li key={card.id}>
                <span>
                  <strong>{card.front}</strong>
                  {card.back}
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
