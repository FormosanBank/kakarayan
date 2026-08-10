import type {SearchForm, SearchRecord} from "./types";

export type RecordUnit = "text" | "sentence" | "word" | "morpheme" | "token" | "audio";

export function recordHasUnit(record: SearchRecord, unit: RecordUnit): boolean {
  if (unit === "word") return record.words.length > 0;
  if (unit === "morpheme") {
    return record.words.some((word) => word.morphemes.length > 0);
  }
  if (unit === "token") return record.tokens.length > 0;
  if (unit === "audio") return record.audio.length > 0;
  return true;
}

function formText(forms: SearchForm[], kind: string): string {
  return forms.find((form) => form.kind === kind)?.text ?? "";
}

function ownerRecord(
  record: SearchRecord,
  ownerType: "word" | "morpheme",
  ownerId: string,
): SearchRecord {
  const forms = record.forms.filter(
    (form) => form.owner_type === ownerType && form.owner_id === ownerId,
  );
  const phonology = record.phonology.filter(
    (item) => item.owner_type === ownerType && item.owner_id === ownerId,
  );
  const tierTranslations = record.tier_translations.filter(
    (item) => item.owner_type === ownerType && item.owner_id === ownerId,
  );
  const audio = record.audio.filter(
    (item) => item.owner_type === ownerType && item.owner_id === ownerId,
  );
  return {
    ...record,
    id: ownerId,
    xml_id: "",
    standard: formText(forms, "standard"),
    original: formText(forms, "original"),
    forms,
    phonology,
    tier_translations: tierTranslations,
    audio,
  };
}

function projectTexts(records: SearchRecord[]): SearchRecord[] {
  const texts = new Map<string, SearchRecord>();
  for (const record of records) {
    const existing = texts.get(record.text_id);
    if (!existing) {
      texts.set(record.text_id, {
        ...record,
        id: record.text_id,
        xml_id: "",
        standard: record.standard,
        original: record.original,
        translations: [...record.translations],
        tokens: [...record.tokens],
        forms: [...record.forms],
        phonology: [...record.phonology],
        tier_translations: [...record.tier_translations],
        words: [...record.words],
        audio: [...record.audio],
      });
      continue;
    }
    existing.standard = [existing.standard, record.standard].filter(Boolean).join("\n");
    existing.original = [existing.original, record.original].filter(Boolean).join("\n");
    existing.translations.push(...record.translations);
    existing.tokens.push(...record.tokens);
    existing.forms.push(...record.forms);
    existing.phonology.push(...record.phonology);
    existing.tier_translations.push(...record.tier_translations);
    existing.words.push(...record.words);
    existing.audio.push(...record.audio);
  }
  return [...texts.values()];
}

export function projectRecordUnits(
  records: SearchRecord[],
  unit: RecordUnit,
): SearchRecord[] {
  if (unit === "sentence") return records;
  if (unit === "text") return projectTexts(records);
  if (unit === "word") {
    return records.flatMap((record) =>
      record.words.map((word) => {
        const projected = ownerRecord(record, "word", word.id);
        const token = record.tokens.find((item) => item.word_id === word.id);
        return {
          ...projected,
          xml_id: word.xml_id,
          standard: projected.standard || token?.normalized || "",
          original: projected.original || token?.surface || "",
          tokens: record.tokens.filter((item) => item.word_id === word.id),
          words: [word],
        };
      }),
    );
  }
  if (unit === "morpheme") {
    return records.flatMap((record) =>
      record.words.flatMap((word) =>
        word.morphemes.map((morpheme) => {
          const projected = ownerRecord(record, "morpheme", morpheme.id);
          return {
            ...projected,
            xml_id: morpheme.xml_id,
            words: [{...word, morphemes: [morpheme]}],
            tokens: record.tokens.filter((item) => item.word_id === word.id),
          };
        }),
      ),
    );
  }
  if (unit === "token") {
    return records.flatMap((record) =>
      record.tokens.map((token) => ({
        ...record,
        id: `${record.id}--token-${token.position}`,
        xml_id: "",
        standard: token.normalized,
        original: token.surface,
        translations: [],
        tokens: [token],
        forms: record.forms.filter(
          (form) => form.owner_type === "word" && form.owner_id === token.word_id,
        ),
        phonology: record.phonology.filter(
          (item) => item.owner_type === "word" && item.owner_id === token.word_id,
        ),
        tier_translations: record.tier_translations.filter(
          (item) => item.owner_type === "word" && item.owner_id === token.word_id,
        ),
        words: record.words.filter((word) => word.id === token.word_id),
        audio: record.audio.filter(
          (item) => item.owner_type === "word" && item.owner_id === token.word_id,
        ),
      })),
    );
  }
  return records.flatMap((record) =>
    record.audio.map((audio) => ({
      ...record,
      id: `${record.id}--audio-${audio.owner_type}-${audio.owner_id}-${audio.position}`,
      audio: [audio],
    })),
  );
}
