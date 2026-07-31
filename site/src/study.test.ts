import {cardsAsAnkiTsv, makeManualCard, scheduleCard, type StudyCard} from "./study";

const card: StudyCard = {
  id: "card-1",
  deck: "Amis",
  front: "lima",
  back: "five",
  languageId: "lang_amis",
  tags: ["corpus_fixture"],
  source: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  dueAt: "2026-01-01T00:00:00.000Z",
  intervalDays: 0,
  ease: 2.5,
  repetitions: 0,
  lapses: 0,
};

describe("local study scheduling", () => {
  const now = new Date("2026-01-01T00:00:00.000Z");

  it("schedules a first good review for one day", () => {
    const next = scheduleCard(card, "good", now);
    expect(next.intervalDays).toBe(1);
    expect(next.dueAt).toBe("2026-01-02T00:00:00.000Z");
  });

  it("returns an again review to learning without collapsing ease", () => {
    const next = scheduleCard({...card, ease: 1.35}, "again", now);
    expect(next.intervalDays).toBe(0);
    expect(next.ease).toBe(1.3);
    expect(next.lapses).toBe(1);
    expect(next.dueAt).toBe("2026-01-01T00:10:00.000Z");
  });

  it("protects tabular exports from formulas", () => {
    expect(cardsAsAnkiTsv([{...card, front: "=1+1"}])).toContain("'=1+1");
  });

  it("normalizes manual card tags and keeps personal cards source-free", () => {
    const manual = makeManualCard(
      {
        front: "  waco ",
        back: "dog",
        languageId: "lang_amis",
        deck: "Vocabulary",
        tags: ["noun", " noun ", ""],
      },
      now,
    );
    expect(manual.front).toBe("waco");
    expect(manual.tags).toEqual(["noun"]);
    expect(manual.source).toBeNull();
  });
});
