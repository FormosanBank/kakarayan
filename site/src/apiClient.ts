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
export const API_INTERACTIVE_TIMEOUT_MS = 6_000;
export const API_ANALYTICAL_TIMEOUT_MS = 8_000;

interface ApiErrorBody {
  error?: {code?: string; message?: string};
}

export class ApiRequestError extends Error {
  readonly code: string;
  readonly status: number;

  constructor(message: string, code: string, status: number) {
    super(message);
    this.name = "ApiRequestError";
    this.code = code;
    this.status = status;
  }
}

function aborted(reason: unknown): Error {
  return reason instanceof Error ? reason : new DOMException("The request was cancelled", "AbortError");
}

function retryDelay(response: Response): number {
  const header = response.headers.get("Retry-After");
  if (header === null) return 500;
  const seconds = Number(header);
  return Number.isFinite(seconds) && seconds >= 0
    ? Math.min(1_000, Math.max(100, seconds * 1_000))
    : 500;
}

function wait(milliseconds: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(aborted(signal.reason));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener("abort", cancel);
      resolve();
    }, milliseconds);
    const cancel = () => {
      window.clearTimeout(timer);
      reject(aborted(signal.reason));
    };
    signal.addEventListener("abort", cancel, {once: true});
  });
}

async function request<T>(
  path: string,
  signal?: AbortSignal,
  {timeoutMs = API_INTERACTIVE_TIMEOUT_MS, retryBusy = true}: {
    timeoutMs?: number;
    retryBusy?: boolean;
  } = {},
): Promise<T> {
  const controller = new AbortController();
  let timedOut = false;
  const cancel = () => controller.abort(signal?.reason);
  if (signal?.aborted) cancel();
  else signal?.addEventListener("abort", cancel, {once: true});
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  try {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetch(`${apiBaseUrl}${path}`, {
        headers: {Accept: "application/json", "X-Kakarayan-Client": "web-v1"},
        signal: controller.signal,
      });
      if (response.ok) return (await response.json()) as T;
      let body: ApiErrorBody = {};
      try {
        body = (await response.json()) as ApiErrorBody;
      } catch {
        // HTTP status remains useful when a proxy supplies a non-JSON error page.
      }
      const code = body.error?.code || "http_error";
      if (retryBusy && attempt === 0 && response.status === 503 && code === "server_busy") {
        await wait(retryDelay(response), controller.signal);
        continue;
      }
      throw new ApiRequestError(
        body.error?.message || `${response.status} ${response.statusText}`,
        code,
        response.status,
      );
    }
  } catch (cause) {
    if (timedOut) {
      throw new ApiRequestError("The query service took too long to respond", "client_timeout", 0);
    }
    throw cause;
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener("abort", cancel);
  }
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
  }>(`${releasePath(releaseId, "summaries")}?${parameters}`, signal, {
    timeoutMs: API_ANALYTICAL_TIMEOUT_MS,
  });
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
  }>(`${releasePath(releaseId, "datasets/preview")}?${parameters}`, signal, {
    timeoutMs: API_ANALYTICAL_TIMEOUT_MS,
  });
}

export type DatasetPreviewResult = Awaited<ReturnType<typeof datasetPreview>>;
