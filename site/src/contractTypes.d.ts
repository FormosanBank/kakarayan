/* Generated from api/contracts.py. Run npm run contracts. */

export type ApiResponse =
  | Ready
  | ExportReady
  | ErrorResponse
  | DictionaryPage
  | ConcordancePage
  | SearchRecord
  | SummaryResponse
  | TranslationLanguages
  | DatasetPreviewResult;
export type TranslationLanguages = TranslationLanguage[];

export interface Ready {
  status: "ready";
  release_id: string;
  read_model_version: number;
  [k: string]: unknown;
}
export interface ExportReady {
  status: "ready";
  release_id: string;
  [k: string]: unknown;
}
export interface ErrorResponse {
  error: ErrorDetail;
  [k: string]: unknown;
}
export interface ErrorDetail {
  code: string;
  message: string;
  status: number;
  field?: string | null;
  [k: string]: unknown;
}
export interface DictionaryPage {
  release_id: string;
  items: DictionaryEntry[];
  next_cursor: string | null;
  [k: string]: unknown;
}
export interface DictionaryEntry {
  id: string;
  language_id: string;
  headword: string;
  display_form: string;
  occurrences: number;
  variant_count: number;
  meanings: Meaning[];
  pronunciations: string[];
  variants: string[];
  corpus_ids: string[];
  examples: SentenceSummary[];
  summary_truncated: boolean;
  [k: string]: unknown;
}
export interface Meaning {
  text: string;
  xml_lang: string;
  [k: string]: unknown;
}
export interface SentenceSummary {
  id: string;
  text_id: string;
  corpus_id: string;
  language_id: string;
  language: string;
  dialect: string;
  source_path: string;
  citation: string;
  xml_id: string;
  position: number;
  token_count: number;
  standard: string;
  original: string;
  translations: Translation[];
  translation_count: number;
  match_evidence: MatchEvidence[];
  summary_truncated: boolean;
  audio_count: number;
  [k: string]: unknown;
}
export interface Translation {
  text: string;
  xml_lang: string;
  kind: string;
  version: string;
  [k: string]: unknown;
}
export interface MatchEvidence {
  tier: "sentence" | "word" | "morpheme";
  field: "form" | "translation";
  text: string;
  xml_lang: string;
  kind: string;
  [k: string]: unknown;
}
export interface ConcordancePage {
  release_id: string;
  items: SentenceSummary[];
  next_cursor: string | null;
  [k: string]: unknown;
}
export interface SearchRecord {
  id: string;
  text_id: string;
  corpus_id: string;
  language_id: string;
  dialect: string;
  source_path: string;
  xml_id: string;
  standard: string;
  original: string;
  translations: Translation[];
  tokens: Token[];
  forms: SearchForm[];
  phonology: SearchPhonology[];
  tier_translations: TierTranslation[];
  words: SearchWord[];
  audio: SearchAudio[];
  detail_truncated: boolean;
  [k: string]: unknown;
}
export interface Token {
  surface: string;
  normalized: string;
  position: number;
  word_id: string;
  [k: string]: unknown;
}
export interface SearchForm {
  owner_type: "sentence" | "word" | "morpheme";
  owner_id: string;
  position: number;
  text: string;
  unclear: number;
  kind: string;
  notes: string;
  normalized: string;
  [k: string]: unknown;
}
export interface SearchPhonology {
  owner_type: "sentence" | "word" | "morpheme";
  owner_id: string;
  position: number;
  text: string;
  unclear: number;
  kind: string;
  [k: string]: unknown;
}
export interface TierTranslation {
  text: string;
  xml_lang: string;
  kind: string;
  version: string;
  owner_type: "sentence" | "word" | "morpheme";
  owner_id: string;
  position: number;
  unclear: number;
  notes: string;
  normalized: string;
  [k: string]: unknown;
}
export interface SearchWord {
  id: string;
  xml_id: string;
  position: number;
  class: string;
  sclass: string;
  morphemes: SearchMorpheme[];
  [k: string]: unknown;
}
export interface SearchMorpheme {
  id: string;
  xml_id: string;
  position: number;
  class: string;
  sclass: string;
  [k: string]: unknown;
}
export interface SearchAudio {
  owner_type: "sentence" | "word" | "morpheme";
  owner_id: string;
  position: number;
  file: string;
  url: string;
  playback_urls: string[];
  start: number | null;
  end: number | null;
  source: string;
  duration: number | null;
  availability_status: string;
  [k: string]: unknown;
}
export interface SummaryResponse {
  sentences: number;
  tokens: number;
  source_types: number;
  normalized_types: number;
  source_frequencies: CountValue[];
  normalized_frequencies: CountValue[];
  translation_frequencies: CountValue[];
  distributions: CountValue[];
  release_id: string;
}
export interface CountValue {
  value: string;
  count: number;
}
export interface TranslationLanguage {
  xml_lang: string;
  records: number;
  [k: string]: unknown;
}
export interface DatasetPreviewResult {
  release_id: string;
  record_level: "sentence" | "word" | "morpheme";
  complete_fields: boolean;
  estimated_rows: number;
  selected_rows: number;
  returned_rows: number;
  truncated: boolean;
  fields: string[];
  items: {
    [k: string]: string | number | null;
  }[];
  [k: string]: unknown;
}
