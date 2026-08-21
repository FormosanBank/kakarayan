export type DatasetLevel = "sentence" | "word" | "morpheme";

export const DATASET_LEVEL_INFO = [
  ["sentence", "S", "Sentence", "句子", "One row per <S>", "每個 <S> 一列"],
  ["word", "W", "Word", "詞", "One row per <W>", "每個 <W> 一列"],
  ["morpheme", "M", "Morpheme", "語素", "One row per <M>", "每個 <M> 一列"],
] as const satisfies ReadonlyArray<
  readonly [DatasetLevel, string, string, string, string, string]
>;

export const DATASET_FIELD_INFO = {
  id: ["Stable Kakarayan row identifier", "穩定的 Kakarayan 資料列識別碼"],
  xml_id: ["Canonical S, W, or M @id", "權威 S、W 或 M 的 @id"],
  parent_id: ["Immediate parent identifier", "直接上層識別碼"],
  text_id: ["Containing TEXT identifier", "所屬 TEXT 識別碼"],
  sentence_id: ["Containing sentence identifier", "所屬句子識別碼"],
  word_id: ["Containing word identifier", "所屬詞識別碼"],
  position: ["Order within the parent element", "在上層元素中的順序"],
  form: ["Standard form, then original or alternate fallback", "標準形式，若無則使用原始或替代形式"],
  standard: ["FormosanBank standardized FORM", "FormosanBank 標準化 FORM"],
  original: ["Source-faithful original FORM", "忠於來源的原始 FORM"],
  alternate_forms: ["Alternate FORM values", "替代 FORM 值"],
  translations: ["Owner-level TRANSL values with language tags", "元素所屬的 TRANSL 值與語言標籤"],
  tokens: ["Ordered sentence token sequence", "句子的依序詞元"],
  token_count: ["Sentence token count", "句子詞元數"],
  phonology: ["Owner-level PHON values", "元素所屬的 PHON 值"],
  class: ["Source class attribute", "來源 class 屬性"],
  sclass: ["Source subclass attribute", "來源 sclass 屬性"],
  source: ["Sentence source locator", "句子來源定位"],
  unclear: ["Owner contains an UNCLEAR marker", "元素包含 UNCLEAR 標記"],
  language_id: ["FormosanBank language identifier", "FormosanBank 語言識別碼"],
  corpus_id: ["Source corpus identifier", "來源語料庫識別碼"],
  dialect: ["Source dialect label", "來源方言標籤"],
  source_path: ["Canonical public XML path", "權威公開 XML 路徑"],
  audio: ["Owner-level audio references and offsets", "元素所屬的音訊參照與時間範圍"],
} as const;

export type DatasetField = keyof typeof DATASET_FIELD_INFO;
export type DatasetFieldsByLevel = Record<DatasetLevel, DatasetField[]>;

export const DATASET_FIELDS_BY_LEVEL: Record<DatasetLevel, DatasetField[]> = {
  sentence: [
    "id", "xml_id", "text_id", "position", "form", "standard", "original",
    "alternate_forms", "translations", "tokens", "token_count", "phonology",
    "source", "unclear", "language_id", "corpus_id", "dialect", "source_path", "audio",
  ],
  word: [
    "id", "xml_id", "parent_id", "sentence_id", "text_id", "position", "form",
    "standard", "original", "alternate_forms", "translations", "phonology", "class",
    "sclass", "unclear", "language_id", "corpus_id", "dialect", "source_path", "audio",
  ],
  morpheme: [
    "id", "xml_id", "parent_id", "word_id", "sentence_id", "text_id", "position",
    "form", "standard", "original", "alternate_forms", "translations", "phonology",
    "class", "sclass", "unclear", "language_id", "corpus_id", "dialect", "source_path",
    "audio",
  ],
};

export const DEFAULT_DATASET_FIELDS: DatasetFieldsByLevel = {
  sentence: [
    "id", "xml_id", "text_id", "form", "translations", "language_id", "corpus_id",
    "dialect", "source_path",
  ],
  word: [
    "id", "xml_id", "sentence_id", "text_id", "position", "form", "translations",
    "language_id", "corpus_id", "dialect", "source_path",
  ],
  morpheme: [
    "id", "xml_id", "word_id", "sentence_id", "text_id", "position", "form",
    "translations", "language_id", "corpus_id", "dialect", "source_path",
  ],
};
