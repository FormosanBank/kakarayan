export type Counts = Partial<
  Record<
    | "texts"
    | "sentences"
    | "words"
    | "morphemes"
    | "forms"
    | "phonology"
    | "translations"
    | "audio"
    | "tokens",
    number
  >
>;

export interface Meta {
  schema_version: string;
  release_id: string;
  generated_at: string;
  source: {repository: string; commit: string};
}

export interface Language {
  id: string;
  name: string;
  iso639_3: string;
  names: {"en": string; "zh-Hant": string; autonym: string};
  capabilities: string[];
  counts: Counts;
}

export interface Corpus {
  id: string;
  name: string;
  source_path: string;
  languages: string[];
  rights_id: string;
  counts: Counts;
}

export interface RightsEntry {
  id: string;
  corpus: string;
  redistribution: "allowed" | "restricted" | "metadata_only" | "review_required";
  commercial_use: "allowed" | "prohibited" | "unknown";
  attribution: string;
  license_expression: string | null;
  notes: string;
  evidence: string[];
  review_status: "reviewed" | "review_required";
  reviewed_at: string | null;
}

export interface RightsCatalog {
  schema_version: string;
  central_terms: {
    use_summary: string;
    commercial_ai: "prohibited" | "permission_required" | "unknown";
    attribution_required: boolean;
    evidence: string[];
  };
  entries: RightsEntry[];
}

export interface ModelEntry {
  id: string;
  repository: string;
  task: "translation" | "automatic-speech-recognition";
  url: string;
  license: string;
  languages: string[];
  direction: string | null;
  last_modified: string | null;
  limitations: string;
  training_lineage: string;
  browser_service_id: string | null;
}

export interface ModelService {
  id: string;
  space: string;
  url: string;
  api_url: string | null;
  tasks: Array<"translation" | "automatic-speech-recognition">;
  status: "available" | "sleeping" | "unavailable" | "unchecked";
  checked_at: string | null;
  third_party_notice: string;
}

export interface ModelCatalog {
  schema_version: string;
  generated_at: string;
  provider: "Hugging Face";
  models: ModelEntry[];
  services: ModelService[];
}

export interface SearchShard {
  path: string;
  language_id: string;
  corpus_id: string;
  records: number;
  bytes: number;
  uncompressed_bytes: number;
  sha256: string;
  uncompressed_sha256: string;
}

export interface SearchManifest {
  schema_version: string;
  release_id: string;
  record_unit: "sentence";
  shards: SearchShard[];
}

export interface Translation {
  text: string;
  xml_lang: string;
  kind: string;
  version: string;
}

export interface Token {
  surface: string;
  normalized: string;
  position: number;
  word_id: string;
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
}

export interface SearchPhonology {
  owner_type: "sentence" | "word" | "morpheme";
  owner_id: string;
  position: number;
  text: string;
  unclear: number;
  kind: string;
}

export interface TierTranslation extends Translation {
  owner_type: "sentence" | "word" | "morpheme";
  owner_id: string;
  position: number;
  unclear: number;
  notes: string;
  normalized: string;
}

export interface SearchMorpheme {
  id: string;
  xml_id: string;
  position: number;
  class: string;
  sclass: string;
}

export interface SearchWord {
  id: string;
  xml_id: string;
  position: number;
  class: string;
  sclass: string;
  morphemes: SearchMorpheme[];
}

export interface SearchRecord {
  id: string;
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
  audio: Array<{
    owner_type: "sentence" | "word" | "morpheme";
    owner_id: string;
    position: number;
    file: string;
    url: string;
    start: number | null;
    end: number | null;
    source: string;
    duration: number | null;
    availability_status: string;
  }>;
}

export interface OrthographyRule {
  input: string;
  outputs: Record<string, string>;
}

export interface OrthographyTable {
  id: string;
  language: string;
  name: string;
  source_path: string;
  dialects: string[];
  rules: OrthographyRule[];
}

export interface OrthographyCatalog {
  schema_version: string;
  source_commit: string;
  tables: OrthographyTable[];
}

export interface LearningContentEntry {
  id: string;
  kind: "grammar-note" | "lesson" | "paradigm" | "usage-note";
  target_language_id: string;
  dialects: string[];
  interface_language: "en" | "zh-Hant";
  title: string;
  summary: string;
  body_markdown: string;
  author: string;
  reviewer: string;
  review_status: "reviewed";
  reviewed_at: string;
  citations: string[];
  rights: {
    status: "reviewed";
    license_expression: string | null;
    evidence: string[];
  };
  related_queries?: unknown[];
}

export interface LearningContentCatalog {
  schema_version: string;
  entries: LearningContentEntry[];
}

export interface AppData {
  meta: Meta;
  languages: Language[];
  corpora: Corpus[];
  rights: RightsCatalog;
  models: ModelCatalog;
  search: SearchManifest;
  orthography: OrthographyCatalog;
  content: LearningContentCatalog;
}
