import type {SearchRecord} from "./types";

export type ResultTier = "audio" | "phonology" | "interlinear" | "unclear";
export type ResultSort = "source" | "shortest" | "longest" | "corpus";

export const RESULT_TIERS: ResultTier[] = ["audio", "phonology", "interlinear", "unclear"];

export function recordHasTier(record: SearchRecord, tier: ResultTier): boolean {
  if (tier === "audio") return record.audio.length > 0;
  if (tier === "phonology") return record.phonology.length > 0;
  if (tier === "interlinear") {
    return (
      record.words.length > 0 ||
      record.tier_translations.some((item) => item.owner_type !== "sentence")
    );
  }
  return [...record.forms, ...record.phonology, ...record.tier_translations].some(
    (item) => item.unclear > 0,
  );
}

export function sortResultRecords(
  records: SearchRecord[],
  sort: ResultSort,
): SearchRecord[] {
  if (sort === "source") return records;
  const values = [...records];
  values.sort((left, right) => {
    if (sort === "shortest" || sort === "longest") {
      const difference =
        (left.standard || left.original).length - (right.standard || right.original).length;
      return (sort === "shortest" ? difference : -difference) || left.id.localeCompare(right.id);
    }
    return (
      left.corpus_id.localeCompare(right.corpus_id) ||
      left.dialect.localeCompare(right.dialect) ||
      left.source_path.localeCompare(right.source_path) ||
      left.id.localeCompare(right.id)
    );
  });
  return values;
}
