import type {SearchRecord} from "./types";

export type Grade = "again" | "hard" | "good" | "easy";

export interface StudyCard {
  id: string;
  deck: string;
  front: string;
  back: string;
  languageId: string;
  tags: string[];
  direction: "recognition" | "production";
  audioReferences: string[];
  source: {
    releaseId: string;
    recordId: string;
    sourcePath: string;
  } | null;
  createdAt: string;
  updatedAt: string;
  dueAt: string;
  intervalDays: number;
  ease: number;
  repetitions: number;
  lapses: number;
}

export interface StudyBackup {
  schemaVersion: 1;
  exportedAt: string;
  cards: StudyCard[];
}

const DATABASE = "kakarayan-learning";
const STORE = "cards";
const VERSION = 1;
const DAY = 86_400_000;

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () =>
      reject(transaction.error ?? new Error("IndexedDB transaction was aborted"));
  });
}

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE, VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, {keyPath: "id"});
        store.createIndex("dueAt", "dueAt");
        store.createIndex("deck", "deck");
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Cannot open local study data"));
  });
}

function normalizeCard(card: StudyCard): StudyCard {
  return {
    ...card,
    direction: card.direction ?? "recognition",
    audioReferences: card.audioReferences ?? [],
  };
}

export function scheduleCard(card: StudyCard, grade: Grade, now: Date): StudyCard {
  let intervalDays = card.intervalDays;
  let ease = card.ease;
  let repetitions = card.repetitions;
  let lapses = card.lapses;
  let dueMs: number;

  if (grade === "again") {
    intervalDays = 0;
    ease = Math.max(1.3, ease - 0.2);
    repetitions = 0;
    lapses += 1;
    dueMs = now.getTime() + 10 * 60_000;
  } else if (grade === "hard") {
    intervalDays = Math.max(1, Math.round(Math.max(1, intervalDays) * 1.2));
    ease = Math.max(1.3, ease - 0.15);
    repetitions += 1;
    dueMs = now.getTime() + intervalDays * DAY;
  } else if (grade === "easy") {
    intervalDays =
      repetitions === 0 ? 4 : Math.max(4, Math.round(Math.max(1, intervalDays) * ease * 1.3));
    ease += 0.15;
    repetitions += 1;
    dueMs = now.getTime() + intervalDays * DAY;
  } else {
    intervalDays =
      repetitions === 0
        ? 1
        : repetitions === 1
          ? 3
          : Math.max(1, Math.round(Math.max(1, intervalDays) * ease));
    repetitions += 1;
    dueMs = now.getTime() + intervalDays * DAY;
  }

  return {
    ...card,
    intervalDays,
    ease,
    repetitions,
    lapses,
    dueAt: new Date(dueMs).toISOString(),
    updatedAt: now.toISOString(),
  };
}

export function cardFromRecord(record: SearchRecord, releaseId: string): StudyCard {
  const now = new Date().toISOString();
  const front = record.standard || record.original;
  const back =
    record.translations
      .filter((item) => item.text)
      .map((item) => item.text)
      .join(" · ") || record.original;
  return {
    id: crypto.randomUUID(),
    deck: "Amis",
    front,
    back,
    languageId: record.language_id,
    tags: [record.corpus_id, record.dialect].filter(Boolean),
    direction: "recognition",
    audioReferences: record.audio
      .map((item) => item.url || item.source || item.file)
      .filter(Boolean),
    source: {
      releaseId,
      recordId: record.id,
      sourcePath: record.source_path,
    },
    createdAt: now,
    updatedAt: now,
    dueAt: now,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
  };
}

export function makeManualCard(
  value: {
    front: string;
    back: string;
    languageId: string;
    deck: string;
    tags: string[];
    direction?: "recognition" | "production";
  },
  now = new Date(),
): StudyCard {
  const front = value.front.trim();
  const back = value.back.trim();
  if (!front || !back) throw new Error("A manual card needs both a front and an answer");
  const timestamp = now.toISOString();
  return {
    id: crypto.randomUUID(),
    deck: value.deck.trim() || "Personal",
    front,
    back,
    languageId: value.languageId,
    tags: [...new Set(value.tags.map((tag) => tag.trim()).filter(Boolean))].sort(),
    direction: value.direction ?? "recognition",
    audioReferences: [],
    source: null,
    createdAt: timestamp,
    updatedAt: timestamp,
    dueAt: timestamp,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
  };
}

export async function listCards(): Promise<StudyCard[]> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readonly");
    const cards = await requestResult<StudyCard[]>(transaction.objectStore(STORE).getAll());
    return cards.map(normalizeCard);
  } finally {
    database.close();
  }
}

export async function saveCard(card: StudyCard): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).put(card);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function deleteCard(id: string): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).delete(id);
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function clearCards(): Promise<void> {
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    transaction.objectStore(STORE).clear();
    await transactionDone(transaction);
  } finally {
    database.close();
  }
}

export async function exportBackup(): Promise<StudyBackup> {
  return {schemaVersion: 1, exportedAt: new Date().toISOString(), cards: await listCards()};
}

function isCard(value: unknown): value is StudyCard {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<StudyCard>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.front === "string" &&
    typeof candidate.back === "string" &&
    typeof candidate.dueAt === "string" &&
    typeof candidate.ease === "number" &&
    Array.isArray(candidate.tags) &&
    candidate.tags.every((tag) => typeof tag === "string") &&
    (candidate.direction === undefined ||
      candidate.direction === "recognition" ||
      candidate.direction === "production") &&
    (candidate.audioReferences === undefined ||
      (Array.isArray(candidate.audioReferences) &&
        candidate.audioReferences.every((value) => typeof value === "string")))
  );
}

export async function restoreBackup(value: unknown): Promise<number> {
  if (typeof value !== "object" || value === null) throw new Error("Invalid backup");
  const backup = value as Partial<StudyBackup>;
  if (backup.schemaVersion !== 1 || !Array.isArray(backup.cards) || !backup.cards.every(isCard)) {
    throw new Error("Unsupported or malformed study backup");
  }
  const database = await openDatabase();
  try {
    const transaction = database.transaction(STORE, "readwrite");
    const store = transaction.objectStore(STORE);
    for (const card of backup.cards) {
      store.put(normalizeCard(card));
    }
    await transactionDone(transaction);
  } finally {
    database.close();
  }
  return backup.cards.length;
}

function spreadsheetCell(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function cardsAsAnkiTsv(cards: StudyCard[]): string {
  return [
    "front\tback\ttags\tsource",
    ...cards.map((card) =>
      [
        spreadsheetCell(card.front).replaceAll("\t", " "),
        spreadsheetCell(card.back).replaceAll("\t", " "),
        card.tags.join(" "),
        card.source?.recordId ?? "",
      ].join("\t"),
    ),
  ].join("\n");
}

function csvCell(value: string): string {
  const safe = spreadsheetCell(value);
  return /[",\r\n]/u.test(safe) ? `"${safe.replaceAll('"', '""')}"` : safe;
}

export function cardsAsCsv(cards: StudyCard[]): string {
  return [
    "front,back,direction,deck,tags,source_release,source_record,audio_references",
    ...cards.map((card) =>
      [
        card.front,
        card.back,
        card.direction,
        card.deck,
        card.tags.join(" "),
        card.source?.releaseId ?? "",
        card.source?.recordId ?? "",
        card.audioReferences.join(" "),
      ]
        .map(csvCell)
        .join(","),
    ),
  ].join("\n");
}
