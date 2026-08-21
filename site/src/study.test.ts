import {cardsAsAnkiTsv, cardsAsCsv, manualStudyCard, scheduleCard, type StudyCard} from "./study";

const card: StudyCard = {
  id: "card-1",
  deck: "Amis",
  front: "lima",
  back: "five",
  languageId: "lang_amis",
  tags: ["corpus_fixture"],
  direction: "recognition",
  audioReferences: [],
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

  it("keeps hard reviews bounded and lengthens easy reviews", () => {
    const hard = scheduleCard(
      {...card, intervalDays: 10, ease: 1.35, repetitions: 3},
      "hard",
      now,
    );
    expect(hard.intervalDays).toBe(12);
    expect(hard.ease).toBe(1.3);
    expect(hard.dueAt).toBe("2026-01-13T00:00:00.000Z");

    const easy = scheduleCard(
      {...card, intervalDays: 10, ease: 2.5, repetitions: 3},
      "easy",
      now,
    );
    expect(easy.intervalDays).toBe(33);
    expect(easy.ease).toBe(2.65);
    expect(easy.dueAt).toBe("2026-02-03T00:00:00.000Z");
  });

  it("protects tabular exports from formulas", () => {
    expect(cardsAsAnkiTsv([{...card, front: "=1+1"}])).toContain("'=1+1");
    expect(cardsAsCsv([{...card, front: "=1+1"}])).toContain("'=1+1");
  });

  it("builds a labelled manual card without corpus provenance", () => {
    const manual = manualStudyCard({
      front: "  fangcalay ",
      back: "good",
      languageId: "lang_amis",
      deck: "Class notes",
      tags: ["Coastal", "Coastal", "lesson-2"],
      direction: "production",
    });
    expect(manual).toMatchObject({
      front: "fangcalay",
      back: "good",
      deck: "Class notes",
      tags: ["Coastal", "lesson-2"],
      direction: "production",
      source: null,
    });
  });
});
