import type {TierRequirement} from "./types";

export const DATASET_FIELD_INFO = [
  ["id", "Stable identifier for each exported row", "每一列的穩定識別碼"],
  ["text_id", "Identifier of the containing text", "所屬文本的識別碼"],
  ["standard", "FormosanBank standardized form", "FormosanBank 標準化形式"],
  ["original", "Source orthography without replacement", "未替換的來源書寫"],
  ["translations", "All translations with XML language tags", "具有 XML 語言標籤的所有翻譯"],
  ["tokens", "Ordered surface token sequence", "依序排列的表層詞元"],
  ["phonology", "Available phonological tiers", "可用的音韻層級"],
  ["glosses", "Word and morpheme translation tiers", "詞與語素翻譯層級"],
  ["language_id", "FormosanBank display-language identifier", "FormosanBank 顯示語言識別碼"],
  ["corpus_id", "Source corpus identifier", "來源語料庫識別碼"],
  ["dialect", "Dialect label supplied by the source", "來源提供的方言標籤"],
  ["source_path", "Path to the canonical public XML", "權威公開 XML 的路徑"],
  ["audio", "Audio references, offsets, and availability", "音訊參照、時間偏移與可用狀態"],
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

export const TIER_REQUIREMENTS: Array<[TierRequirement, string]> = [
  ["translation", "translation"],
  ["audio", "audio evidence"],
  ["phonology", "phonology"],
  ["interlinear", "word or morpheme analysis"],
  ["unclear", "an unclear annotation"],
];
