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
  api_version: "v1";
  read_model_version: number;
  endpoint: "meta";
  release_id: string;
  generated_at: string;
  kakarayan: {repository: "FormosanBank/kakarayan"; version: string; commit: string};
  source: {repository: string; commit: string};
  canonical_url: string;
  data: {current_release: string};
}

export interface ApiEnvelope<T> {
  schema_version: string;
  api_version: "v1";
  read_model_version: number;
  endpoint: string;
  release_id: string;
  generated_at: string;
  kakarayan: {repository: "FormosanBank/kakarayan"; version: string; commit: string};
  source: {repository: string; commit: string};
  canonical_url: string;
  data: T;
}

export interface Language {
  id: string;
  name: string;
  iso639_3: string;
  names: {"en": string; "zh-Hant": string; autonym: string};
  capabilities: string[];
  dialects: string[];
  counts: Counts;
}

export interface Corpus {
  id: string;
  name: string;
  source_path: string;
  languages: string[];
  rights_id: string;
  citation: string;
  bibtex_citation: string;
  source: string;
  copyright: string;
  language_counts: Record<string, Counts>;
  metadata_variants: Record<"citation" | "bibtex_citation" | "source" | "copyright", number>;
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
  framework: string;
  model_family: string;
  artifact_bytes: number | null;
  evaluation_metrics: Array<{name: string; value: string | number | boolean | null}>;
  license_source: string;
  intended_use: string;
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
  api_name: string | null;
  tasks: Array<"translation" | "automatic-speech-recognition">;
  supported_languages: string[];
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

export type {Translation, Token, SearchForm, SearchPhonology, TierTranslation, SearchMorpheme, SearchWord, SearchRecord, SentenceSummary, DictionaryEntry} from "./contractTypes";

export type SearchDirection = "formosan" | "translation";
export type MatchMode = "exact" | "prefix" | "contains";
export type TierRequirement =
  | "translation"
  | "audio"
  | "phonology"
  | "interlinear"
  | "unclear";

export interface PageResult<T> {
  release_id: string;
  items: T[];
  next_cursor: string | null;
}

export interface QueryAvailability {
  baseUrl: string;
  available: boolean;
  error: string;
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
  orthography: OrthographyCatalog;
  content: LearningContentCatalog;
  query: QueryAvailability;
  resources: Record<OptionalResource, ResourceState>;
}

export type OptionalResource = "models" | "orthography" | "content";
export type ResourceState = {status: "loading" | "ready" | "error"; error: string};
