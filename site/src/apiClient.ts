import type {
  DictionaryEntry,
  MatchMode,
  PageResult,
  SearchDirection,
  SearchRecord,
  SentenceSummary,
  TierRequirement,
} from "./types";

const configured = import.meta.env.VITE_KAKARAYAN_API_URL?.trim();
export const apiBaseUrl = (configured || "http://127.0.0.1:8000").replace(/\/$/u, "");
export const API_READINESS_TIMEOUT_MS = 4_000;

interface ApiErrorBody {
  error?: {code?: string; message?: string};
}

async function request<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: {Accept: "application/json", "X-Kakarayan-Client": "web-v1"},
    ...(signal ? {signal} : {}),
  });
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // HTTP status remains useful when a proxy supplies a non-JSON error page.
    }
    throw new Error(body.error?.message || `${response.status} ${response.statusText}`);
  }
  return (await response.json()) as T;
}

export async function checkApiRelease(
  releaseId: string,
  signal?: AbortSignal,
  timeoutMs = API_READINESS_TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const abort = () => controller.abort(signal?.reason);
  if (signal?.aborted) abort();
  else signal?.addEventListener("abort", abort, {once: true});
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`Query service did not respond within ${timeoutMs / 1_000} seconds`));
      controller.abort();
    }, timeoutMs);
  });
  try {
    const ready = await Promise.race([
      request<{status: string; release_id: string}>("/readyz", controller.signal),
      timeout,
    ]);
    if (ready.release_id !== releaseId) {
      throw new Error(`Release mismatch: site ${releaseId}, query service ${ready.release_id}`);
    }
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    signal?.removeEventListener("abort", abort);
  }
}

function releasePath(releaseId: string, route: string): string {
  return `/v1/releases/${encodeURIComponent(releaseId)}/${route}`;
}

function searchParameters(options: {
  q: string;
  languageId: string;
  corpusId?: string;
  dialect?: string;
  direction: SearchDirection;
  translationLanguage?: string;
  match: MatchMode;
  requirements?: TierRequirement[];
  limit?: number;
  cursor?: string | null;
}): URLSearchParams {
  const parameters = new URLSearchParams({
    q: options.q,
    language_id: options.languageId,
    direction: options.direction,
    match: options.match,
    limit: String(options.limit ?? 25),
  });
  if (options.corpusId) parameters.set("corpus_id", options.corpusId);
  if (options.dialect) parameters.set("dialect", options.dialect);
  if (options.translationLanguage) {
    parameters.set("translation_language", options.translationLanguage);
  }
  for (const requirement of options.requirements ?? []) {
    parameters.append("requirement", requirement);
  }
  if (options.cursor) parameters.set("cursor", options.cursor);
  return parameters;
}

export function dictionary(
  releaseId: string,
  options: Parameters<typeof searchParameters>[0],
  signal?: AbortSignal,
): Promise<PageResult<DictionaryEntry>> {
  return request(`${releasePath(releaseId, "dictionary")}?${searchParameters(options)}`, signal);
}

export function concordance(
  releaseId: string,
  options: Parameters<typeof searchParameters>[0],
  signal?: AbortSignal,
): Promise<PageResult<SentenceSummary>> {
  return request(`${releasePath(releaseId, "concordance")}?${searchParameters(options)}`, signal);
}

export function sentenceDetail(
  releaseId: string,
  sentenceId: string,
  signal?: AbortSignal,
): Promise<SearchRecord> {
  return request(releasePath(releaseId, `sentences/${encodeURIComponent(sentenceId)}`), signal);
}

export function translationLanguages(
  releaseId: string,
  languageId: string,
  corpusId: string,
  signal?: AbortSignal,
): Promise<Array<{xml_lang: string; records: number}>> {
  const parameters = new URLSearchParams({language_id: languageId});
  if (corpusId) parameters.set("corpus_id", corpusId);
  return request(
    `${releasePath(releaseId, "translation-languages")}?${parameters}`,
    signal,
  );
}

export function summaries(
  releaseId: string,
  languageId: string,
  corpusId: string,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({language_id: languageId, limit: "50"});
  if (corpusId) parameters.set("corpus_id", corpusId);
  return request<{
    release_id: string;
    sentences: number;
    tokens: number;
    source_types: number;
    normalized_types: number;
    source_frequencies: Array<{value: string; count: number}>;
    normalized_frequencies: Array<{value: string; count: number}>;
    translation_frequencies: Array<{value: string; count: number}>;
    distributions: Array<{value: string; count: number}>;
  }>(`${releasePath(releaseId, "summaries")}?${parameters}`, signal);
}

export function datasetUrl(
  releaseId: string,
  route: "preview" | "export" | "export-package",
  parameters: URLSearchParams,
): string {
  return `${apiBaseUrl}${releasePath(releaseId, `datasets/${route}`)}?${parameters}`;
}

export function datasetPreview(
  releaseId: string,
  parameters: URLSearchParams,
  signal?: AbortSignal,
) {
  return request<{
    release_id: string;
    record_level: "sentence" | "word" | "morpheme";
    complete_fields: boolean;
    estimated_rows: number;
    returned_rows: number;
    truncated: boolean;
    fields: string[];
    items: Array<Record<string, string | number | null>>;
  }>(`${releasePath(releaseId, "datasets/preview")}?${parameters}`, signal);
}

export type DatasetPreviewResult = Awaited<ReturnType<typeof datasetPreview>>;
