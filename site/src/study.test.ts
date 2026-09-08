import {cardsAsAnkiTsv, cardsAsCsv, manualStudyCard, restoreBackup, scheduleCard, validateBackup, type StudyCard} from "./study";

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

  it("protects spreadsheet exports without altering Anki text", () => {
    expect(cardsAsAnkiTsv([{...card, front: "=1+1"}])).toContain('"=1+1"');
    expect(cardsAsCsv([{...card, front: "=1+1"}])).toContain("'=1+1");
  });

  it("quotes multiline Anki fields with explicit header metadata", () => {
    const value = cardsAsAnkiTsv([{...card, front: '第一行\n"line 2"\tend'}]);
    expect(value).toContain("#separator:Tab\n#html:false\n#columns:Front\tBack\tTags\tSource\n#tags column:3\n");
    expect(value).toContain('"第一行\n""line 2""\tend"\t"five"');
  });

  it("validates the entire backup before attempting a write", async () => {
    const backup = {schemaVersion: 1, exportedAt: card.createdAt, cards: [card]};
    expect(validateBackup(backup)).toEqual(backup);
    for (const invalid of [
      {...backup, cards: [card, card]},
      {...backup, exportedAt: "not a date"},
      ...[NaN, Infinity, -1, 1.5].map((repetitions) => ({...backup, cards: [{...card, repetitions}]})),
      {...backup, cards: [{...card, dueAt: "tomorrow"}]},
      {...backup, cards: [{...card, direction: "unknown"}]},
      {...backup, cards: [{...card, audioReferences: [12]}]},
      {...backup, cards: [{...card, source: {recordId: "x"}}]},
      {...backup, cards: [{...card, front: "a".repeat(20_001)}]},
    ]) {
      await expect(restoreBackup(invalid)).rejects.toThrow(/backup/i);
    }
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
