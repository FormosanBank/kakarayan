import {useCallback, useEffect, useMemo, useState, type ChangeEvent} from "react";

import {useI18n} from "../i18n";
import {
  cardsAsAnkiTsv,
  cardsAsCsv,
  clearCards,
  deleteCard,
  exportBackup,
  listCards,
  restoreBackup,
  saveCard,
  scheduleCard,
  manualStudyCard,
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

export function StudyDeck({
  currentRelease,
  languageId,
  dialect,
}: {
  currentRelease: string;
  languageId: string;
  dialect: string;
}) {
  const {number, t, tx} = useI18n();
  const [cards, setCards] = useState<StudyCard[]>([]);
  const [error, setError] = useState("");
  const [showAnswer, setShowAnswer] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState("");
  const [manualFront, setManualFront] = useState("");
  const [manualBack, setManualBack] = useState("");
  const [manualDeck, setManualDeck] = useState("My cards");
  const [manualTags, setManualTags] = useState("");
  const [manualDirection, setManualDirection] = useState<StudyCard["direction"]>("recognition");
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
  const queues = {
    new: cards.filter((card) => card.repetitions === 0 && card.lapses === 0).length,
    learning: cards.filter(
      (card) => card.intervalDays === 0 && (card.repetitions > 0 || card.lapses > 0),
    ).length,
    review: cards.filter((card) => card.intervalDays > 0).length,
  };
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
    if (!window.confirm(tx(`Delete "${card.front}" from this device?`, `要從此裝置刪除「${card.front}」嗎？`))) return;
    await deleteCard(card.id);
    reload();
  }

  async function resetAll() {
    if (!window.confirm(tx("Delete every Kakarayan study card from this browser?", "要從此瀏覽器刪除所有 Kakarayan 學習卡片嗎？"))) return;
    await clearCards();
    reload();
  }

  async function addManualCard() {
    try {
      await saveCard(manualStudyCard({
        front: manualFront,
        back: manualBack,
        languageId,
        deck: manualDeck,
        tags: [dialect, ...manualTags.split(/[,\n]/u)].filter(Boolean),
        direction: manualDirection,
      }));
      setManualFront("");
      setManualBack("");
      setManualTags("");
      setError("");
      reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }

  return (
    <section className="study-deck">
      <div className="deck-toolbar">
        <div>
          <strong>{number(cards.length)}</strong> {tx("cards", "張卡片")} ·{" "}
          <strong>{number(due.length)}</strong> {t("deck.due")}
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
          <button
            className="button button--quiet"
            onClick={() =>
              download(cardsAsCsv(cards), "kakarayan-study.csv", "text/csv;charset=utf-8")
            }
            disabled={!cards.length}
          >
            CSV
          </button>
          <label className="button button--quiet file-button">
            {t("deck.import")}
            <input type="file" accept="application/json,.json" onChange={restore} />
          </label>
        </div>
      </div>
      {error && <p className="callout callout--error">{error}</p>}
      <details className="manual-card">
        <summary>{tx("Create a card", "建立卡片")}</summary>
        <div className="manual-card__form">
          <label className="field">
            {tx("Prompt", "提示")}
            <textarea rows={3} value={manualFront} onChange={(event) => setManualFront(event.target.value)} />
          </label>
          <label className="field">
            {tx("Answer", "答案")}
            <textarea rows={3} value={manualBack} onChange={(event) => setManualBack(event.target.value)} />
          </label>
          <label className="field">
            {tx("Deck", "牌組")}
            <input value={manualDeck} onChange={(event) => setManualDeck(event.target.value)} />
          </label>
          <label className="field">
            {tx("Direction", "方向")}
            <select value={manualDirection} onChange={(event) => setManualDirection(event.target.value as StudyCard["direction"])}>
              <option value="recognition">{tx("Formosan → meaning", "南島語 → 釋義")}</option>
              <option value="production">{tx("Meaning → Formosan", "釋義 → 南島語")}</option>
            </select>
          </label>
          <label className="field">
            {tx("Tags, comma separated", "標籤，以逗號分隔")}
            <input value={manualTags} onChange={(event) => setManualTags(event.target.value)} />
          </label>
          <button className="button button--primary" disabled={!manualFront.trim() || !manualBack.trim()} onClick={addManualCard}>
            {tx("Add to local deck", "加入本機牌組")}
          </button>
        </div>
      </details>
      {cards.length > 0 && (
        <dl className="queue-summary">
          <div>
            <dt>{tx("Due", "到期")}</dt>
            <dd>{number(due.length)}</dd>
          </div>
          <div>
            <dt>{tx("New", "新卡")}</dt>
            <dd>{number(queues.new)}</dd>
          </div>
          <div>
            <dt>{tx("Learning", "學習中")}</dt>
            <dd>{number(queues.learning)}</dd>
          </div>
          <div>
            <dt>{tx("Review", "複習")}</dt>
            <dd>{number(queues.review)}</dd>
          </div>
        </dl>
      )}
      {staleCards.length > 0 && (
        <p className="callout callout--warning">
          {tx(
            `${staleCards.length} cited card${staleCards.length === 1 ? "" : "s"} came from an older data release. The saved text is unchanged; open a fresh corpus result before treating it as current.`,
            `${number(staleCards.length)} 張附引用卡片來自較舊的資料版本。已儲存文字未變；請開啟最新語料結果後再視為現行資料。`,
          )}
        </p>
      )}
      {!cards.length && <div className="empty-state">{t("deck.empty")}</div>}
      {current && (
        <article className="review-card">
          <span>{current.deck} · {tx("local card", "本機卡片")}</span>
          <h3>{current.direction === "production" ? current.back : current.front}</h3>
          {!showAnswer ? (
            <button className="button button--primary" onClick={() => setShowAnswer(true)}>
              {tx("Show answer", "顯示答案")}
            </button>
          ) : (
            <>
              <div className="review-answer">
                {current.direction === "production" ? current.front : current.back}
              </div>
              <div className="grade-row" aria-label={tx("Review grade", "複習評分")}>
                {(["again", "hard", "good", "easy"] as Grade[]).map((gradeValue) => (
                  <button key={gradeValue} onClick={() => grade(gradeValue)}>
                    {{
                      again: tx("again", "重來"),
                      hard: tx("hard", "困難"),
                      good: tx("good", "良好"),
                      easy: tx("easy", "簡單"),
                    }[gradeValue]}
                  </button>
                ))}
              </div>
            </>
          )}
          {current.source && (
            <small>
              {tx("Source", "來源")} {current.source.recordId} · {tx("release", "資料版本")}{" "}
              {current.source.releaseId}
            </small>
          )}
          {current.audioReferences.length > 0 && (
            <small>{number(current.audioReferences.length)} {tx("source audio reference(s) retained", "筆來源音訊參照已保留")}</small>
          )}
        </article>
      )}
      {cards.length > 0 && (
        <details className="card-inventory">
          <summary>{tx("All local cards", "所有本機卡片")} ({number(cards.length)})</summary>
          <label className="field">
            {tx("Filter cards, decks, or tags", "篩選卡片、牌組或標籤")}
            <input value={filter} onChange={(event) => setFilter(event.target.value)} />
          </label>
          <ul>
            {visibleCards.map((card) => (
              <li key={card.id}>
                <span>
                  <strong>{card.front}</strong>
                  {card.back}
                  <small>{card.deck} · {card.tags.join(" · ") || tx("no tags", "無標籤")}</small>
                </span>
                <button className="text-button text-button--danger" onClick={() => remove(card)}>
                  {tx("Delete", "刪除")}
                </button>
              </li>
            ))}
          </ul>
          <button className="button button--danger" onClick={resetAll}>
            {tx("Delete all local cards", "刪除所有本機卡片")}
          </button>
        </details>
      )}
    </section>
  );
}
