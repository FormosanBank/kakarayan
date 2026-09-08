import type {DictionaryEntry, SearchRecord} from "./types";

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

export interface ManualCardInput {
  front: string;
  back: string;
  languageId: string;
  deck?: string;
  tags?: string[];
  direction?: StudyCard["direction"];
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
    let blocked = false;
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE)) {
        const store = database.createObjectStore(STORE, {keyPath: "id"});
        store.createIndex("dueAt", "dueAt");
        store.createIndex("deck", "deck");
      }
    };
    request.onsuccess = () => {
      if (blocked) request.result.close();
      else {
        request.result.onversionchange = () => request.result.close();
        resolve(request.result);
      }
    };
    request.onerror = () => reject(request.error ?? new Error("Cannot open local study data"));
    request.onblocked = () => {
      blocked = true;
      reject(new Error("Study storage is blocked by another tab. Close it and retry."));
    };
  });
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

export function cardFromRecord(
  record: SearchRecord,
  releaseId: string,
  targetLanguage = "",
): StudyCard {
  const now = new Date().toISOString();
  const front = record.standard || record.original;
  const back =
    record.translations
      .filter((item) => item.text && (!targetLanguage || item.xml_lang === targetLanguage))
      .map((item) => item.text)
      .join(" · ") || record.original || front;
  return {
    id: crypto.randomUUID(),
    deck: "Saved sentences",
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

export function cardFromDictionaryEntry(
  entry: DictionaryEntry,
  releaseId: string,
  targetLanguage: string,
): StudyCard {
  const front = entry.display_form.trim();
  const languages = new Set(entry.meanings.map((meaning) => meaning.xml_lang));
  const back = [...new Set(entry.meanings
    .map((meaning) => ({...meaning, text: meaning.text.trim()}))
    .filter((meaning) => meaning.text)
    .map((meaning) => languages.size > 1
      ? `${meaning.xml_lang}: ${meaning.text}`
      : meaning.text))].join(" · ");
  if (!front || !back) throw new Error("A dictionary card needs a headword and meaning");
  const now = new Date().toISOString();
  const example = entry.examples[0];
  return {
    id: crypto.randomUUID(),
    deck: "Saved words",
    front,
    back,
    languageId: entry.language_id,
    tags: [...new Set([...entry.corpus_ids, "dictionary", targetLanguage].filter(Boolean))].sort(),
    direction: "recognition",
    audioReferences: [],
    source: example
      ? {releaseId, recordId: example.id, sourcePath: example.source_path}
      : null,
    createdAt: now,
    updatedAt: now,
    dueAt: now,
    intervalDays: 0,
    ease: 2.5,
    repetitions: 0,
    lapses: 0,
  };
}

export function manualStudyCard(input: ManualCardInput): StudyCard {
  const front = input.front.trim();
  const back = input.back.trim();
  if (!front || !back) throw new Error("A study card needs a front and an answer");
  const now = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    deck: input.deck?.trim() || "My cards",
    front,
    back,
    languageId: input.languageId,
    tags: [...new Set((input.tags ?? []).map((tag) => tag.trim()).filter(Boolean))].sort(),
    direction: input.direction ?? "recognition",
    audioReferences: [],
    source: null,
    createdAt: now,
    updatedAt: now,
    dueAt: now,
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
    const cards: unknown[] = await requestResult(transaction.objectStore(STORE).getAll());
    if (!cards.every(isCard)) throw new Error("Some local cards are invalid. Keep a backup before changing them.");
    return cards;
  } finally {
    database.close();
  }
}

export async function saveCard(card: StudyCard): Promise<void> {
  if (!isCard(card)) throw new Error("This card has invalid content or scheduling data");
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

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function boundedText(value: unknown, maximum = 20_000): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function isoDate(value: unknown): value is string {
  if (typeof value !== "string" || !Number.isFinite(Date.parse(value))) return false;
  return new Date(value).toISOString() === value;
}

function stringList(value: unknown, maximum: number): value is string[] {
  return Array.isArray(value) && value.length <= maximum &&
    value.every((item) => boundedText(item, 4_096));
}

export function isCard(value: unknown): value is StudyCard {
  if (!isObject(value)) return false;
  return boundedText(value.id, 256) && value.id.length > 0 &&
    boundedText(value.deck, 256) && boundedText(value.front) && boundedText(value.back) &&
    boundedText(value.languageId, 128) && stringList(value.tags, 100) &&
    stringList(value.audioReferences, 100) &&
    (value.direction === "recognition" || value.direction === "production") &&
    isoDate(value.createdAt) && isoDate(value.updatedAt) && isoDate(value.dueAt) &&
    typeof value.ease === "number" && Number.isFinite(value.ease) && value.ease >= 1.3 && value.ease <= 100 &&
    [value.intervalDays, value.repetitions, value.lapses].every(
      (item) => typeof item === "number" && Number.isSafeInteger(item) && item >= 0 && item <= 1_000_000,
    ) &&
    (value.source === null || (isObject(value.source) &&
      boundedText(value.source.releaseId, 128) && boundedText(value.source.recordId, 256) &&
      boundedText(value.source.sourcePath, 4_096)));
}

export function validateBackup(value: unknown): StudyBackup {
  if (!isObject(value) || value.schemaVersion !== 1 || !isoDate(value.exportedAt) ||
    !Array.isArray(value.cards) || value.cards.length > 10_000 || !value.cards.every(isCard)) {
    throw new Error("Unsupported or malformed study backup");
  }
  const ids = new Set(value.cards.map((card) => card.id));
  if (ids.size !== value.cards.length) throw new Error("Backup contains duplicate card IDs");
  return {schemaVersion: 1, exportedAt: value.exportedAt, cards: value.cards};
}

export async function restoreBackup(value: unknown): Promise<number> {
  const backup = validateBackup(value);
  const database = await openDatabase();
  try {
    // Existing IDs are replaced by the backup. New IDs are added atomically.
    const transaction = database.transaction(STORE, "readwrite");
    const done = transactionDone(transaction);
    try {
      for (const card of backup.cards) transaction.objectStore(STORE).put(card);
    } catch (cause) {
      transaction.abort();
      await done.catch(() => undefined);
      throw cause;
    }
    await done;
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
    "#separator:Tab",
    "#html:false",
    "#columns:Front\tBack\tTags\tSource",
    "#tags column:3",
    ...cards.map((card) =>
      [
        card.front,
        card.back,
        card.tags.join(" "),
        card.source?.recordId ?? "",
      ].map((value) => `"${value.replaceAll('"', '""')}"`).join("\t"),
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
