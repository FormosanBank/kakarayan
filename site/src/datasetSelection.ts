import type {SearchRecord} from "./types";

export const DATASET_FIELD_INFO = [
  ["id", "Stable identifier for each exported row"],
  ["text_id", "Identifier of the containing text"],
  ["standard", "FormosanBank standardized form"],
  ["original", "Source orthography without replacement"],
  ["translations", "All translations with XML language tags"],
  ["tokens", "Ordered surface token sequence"],
  ["phonology", "Available phonological tiers"],
  ["glosses", "Word and morpheme translation tiers"],
  ["language_id", "FormosanBank display-language identifier"],
  ["corpus_id", "Source corpus identifier"],
  ["dialect", "Dialect label supplied by the source"],
  ["source_path", "Path to the canonical public XML"],
  ["audio", "Audio references, offsets, and availability"],
] as const;

export const DATASET_FIELDS = DATASET_FIELD_INFO.map(([field]) => field);
export const ESSENTIAL_DATASET_FIELDS = [
  "id",
  "standard",
  "original",
  "translations",
  "language_id",
  "corpus_id",
  "dialect",
  "source_path",
];

export type TierRequirement =
  | "translation"
  | "audio"
  | "phonology"
  | "interlinear"
  | "unclear";

export const TIER_REQUIREMENTS: Array<[TierRequirement, string]> = [
  ["translation", "translation"],
  ["audio", "audio evidence"],
  ["phonology", "phonology"],
  ["interlinear", "word or morpheme analysis"],
  ["unclear", "an unclear annotation"],
];

export function recordMeetsFilters(
  record: SearchRecord,
  dialects: string[],
  requirements: TierRequirement[],
): boolean {
  if (dialects.length && !dialects.includes(record.dialect || "unknown")) return false;
  return requirements.every((requirement) => {
    if (requirement === "translation") return record.translations.length > 0;
    if (requirement === "audio") return record.audio.length > 0;
    if (requirement === "phonology") return record.phonology.length > 0;
    if (requirement === "interlinear") {
      return (
        record.words.length > 0 ||
        record.tier_translations.some((item) => item.owner_type !== "sentence")
      );
    }
    return [...record.forms, ...record.phonology, ...record.tier_translations].some(
      (item) => item.unclear > 0,
    );
  });
}

export function datasetFieldValue(record: SearchRecord, field: string): string {
  if (field === "translations") {
    return record.translations.map((item) => `${item.xml_lang}: ${item.text}`).join(" | ");
  }
  if (field === "tokens") return record.tokens.map((item) => item.surface).join(" ");
  if (field === "phonology") return record.phonology.map((item) => item.text).join(" | ");
  if (field === "glosses") {
    return record.tier_translations.map((item) => item.text).join(" | ");
  }
  if (field === "audio") {
    return record.audio
      .map((item) => item.file || item.url || item.source)
      .filter(Boolean)
      .join(" | ");
  }
  const value = record[field as keyof SearchRecord];
  return typeof value === "string" ? value : "";
}
