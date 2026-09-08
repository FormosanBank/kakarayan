import contract from "../../api/contract.json";
import * as validate from "../node_modules/.cache/kakarayan-contracts/validators.cjs";
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
export const API_ANALYTICAL_TIMEOUT_MS = 20_000;

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
  valid: (value: unknown) => value is T,
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
        cache: "no-store",
        headers: {Accept: "application/json", "X-Kakarayan-Client": "web-v1"},
        signal: controller.signal,
      });
      if (response.ok) {
        let value: unknown;
        try { value = await response.json(); }
        catch (cause) {
          if (!(cause instanceof SyntaxError)) throw cause;
          throw new ApiRequestError("The query service returned invalid data", "invalid_response", 502);
        }
        if (!valid(value)) throw new ApiRequestError("The query service returned invalid data", "invalid_response", 502);
        const release = /^\/v1\/releases\/([^/]+)\//u.exec(path)?.[1];
        if (release && value && typeof value === "object" && "release_id" in value && value.release_id !== decodeURIComponent(release)) {
          throw new ApiRequestError("The query service returned a different release", "release_mismatch", 502);
        }
        return value;
      }
      let code = "http_error";
      let message = `${response.status} ${response.statusText}`;
      try {
        const body: unknown = await response.json();
        if (body && typeof body === "object" && "error" in body && body.error && typeof body.error === "object") {
          if ("code" in body.error && typeof body.error.code === "string") code = body.error.code;
          if ("message" in body.error && typeof body.error.message === "string") message = body.error.message;
        }
      } catch {
        // HTTP status remains useful when a proxy supplies a non-JSON error page.
      }
      if (retryBusy && attempt === 0 && response.status === 503 && code === "server_busy") {
        await wait(retryDelay(response), controller.signal);
        continue;
      }
      throw new ApiRequestError(
        message,
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
){
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
      request("/readyz", validate.Ready, controller.signal),
      timeout,
    ]);
    if (ready.release_id !== releaseId) {
      throw new Error(`Release mismatch: site ${releaseId}, query service ${ready.release_id}`);
    }
    if (ready.status !== "ready" || ready.read_model_version !== contract.read_model_version) {
      throw new Error("The query API uses an incompatible read model");
    }
    return ready;
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
  return request(`${releasePath(releaseId, "dictionary")}?${searchParameters(options)}`, validate.DictionaryPage, signal);
}

export function concordance(
  releaseId: string,
  options: Parameters<typeof searchParameters>[0],
  signal?: AbortSignal,
): Promise<PageResult<SentenceSummary>> {
  return request(`${releasePath(releaseId, "concordance")}?${searchParameters(options)}`, validate.ConcordancePage, signal);
}

export function sentenceDetail(
  releaseId: string,
  sentenceId: string,
  signal?: AbortSignal,
): Promise<SearchRecord> {
  return request(releasePath(releaseId, `sentences/${encodeURIComponent(sentenceId)}`), validate.SearchRecord, signal);
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
    validate.TranslationLanguages,
    signal,
  );
}

export function summaries(
  releaseId: string,
  languageId: string,
  corpusId: string,
  dialect: string,
  signal?: AbortSignal,
) {
  const parameters = new URLSearchParams({language_id: languageId, limit: "50"});
  if (corpusId) parameters.set("corpus_id", corpusId);
  if (dialect) parameters.set("dialect", dialect);
  return request(`${releasePath(releaseId, "summaries")}?${parameters}`, validate.SummaryResponse, signal, {
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

export async function preflightExport(
  releaseId: string,
  route: "export" | "export-package",
  parameters: URLSearchParams,
  signal?: AbortSignal,
): Promise<void> {
  const values = new URLSearchParams(parameters);
  values.set("preflight", "true");
  const result = await request(
    `${releasePath(releaseId, `datasets/${route}`)}?${values}`, validate.ExportReady, signal, {retryBusy: false},
  );
  if (result.release_id !== releaseId || result.status !== "ready") {
    throw new ApiRequestError("The export release is not ready", "release_mismatch", 503);
  }
}

export function datasetPreview(
  releaseId: string,
  parameters: URLSearchParams,
  signal?: AbortSignal,
) {
  return request(`${releasePath(releaseId, "datasets/preview")}?${parameters}`, validate.DatasetPreviewResult, signal, {
    timeoutMs: API_ANALYTICAL_TIMEOUT_MS,
  });
}

export type DatasetPreviewResult = Awaited<ReturnType<typeof datasetPreview>>;
