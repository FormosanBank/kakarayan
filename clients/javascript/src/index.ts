export type ApiMode = "static" | "live";

export interface ClientOptions {
  baseUrl: string;
  mode?: ApiMode;
  releaseId?: string;
  timeoutMs?: number;
  fetch?: typeof fetch;
}

export interface Page<T> {
  items: T[];
  next_cursor: string | null;
}

export interface QueryOptions {
  language_id: string;
  corpus_id?: string;
  dialect?: string;
  limit?: number;
  cursor?: string;
}

export interface ConcordanceOptions extends QueryOptions {
  q: string;
  field?: "form" | "translation" | "any";
  match?: "exact" | "prefix" | "contains";
}

export interface DictionaryOptions extends QueryOptions {
  q: string;
  match?: "exact" | "prefix" | "contains";
}

export interface FrequencyOptions extends QueryOptions {
  prefix?: string;
  minimum?: number;
  sort?: "count" | "form";
}

interface StructuredError {
  error?: {
    code?: string;
    message?: string;
    status?: number;
    field?: string;
  };
}

export class KakarayanError extends Error {
  readonly code: string;
  readonly status: number;
  readonly field?: string;

  constructor(code: string, message: string, status: number, field?: string) {
    super(message);
    this.name = "KakarayanError";
    this.code = code;
    this.status = status;
    this.field = field;
  }
}

function parameters(value: object): string {
  const result = new URLSearchParams();
  for (const [key, item] of Object.entries(value)) {
    if (item !== undefined && item !== "") result.set(key, String(item));
  }
  return result.toString();
}

function staticPath(name: string): string {
  return `/api/v1/${name}.json`;
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((item) => item.toString(16).padStart(2, "0")).join("");
}

export class KakarayanClient {
  private readonly baseUrl: string;
  private readonly mode: ApiMode;
  private readonly releaseId?: string;
  private readonly timeoutMs: number;
  private readonly fetcher: typeof fetch;
  private releaseCheck?: Promise<void>;

  constructor(options: ClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/+$/, "");
    this.mode = options.mode ?? "static";
    this.releaseId = options.releaseId;
    this.timeoutMs = options.timeoutMs ?? 15_000;
    this.fetcher = options.fetch ?? globalThis.fetch;
    if (!this.fetcher) throw new Error("A Fetch API implementation is required");
  }

  private async response(path: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await this.fetcher(`${this.baseUrl}${path}`, {
        headers: {"Accept": "application/json", "X-Kakarayan-Client": "javascript/0.1"},
        signal: controller.signal,
      });
    } catch (error) {
      if (controller.signal.aborted) {
        throw new KakarayanError("timeout", "The Kakarayan request timed out", 0);
      }
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  private async json<T>(path: string): Promise<T> {
    const response = await this.response(path);
    if (!response.ok) {
      let detail: StructuredError = {};
      try {
        detail = (await response.json()) as StructuredError;
      } catch {
        // A non-JSON upstream failure still receives a stable client error.
      }
      throw new KakarayanError(
        detail.error?.code ?? "http_error",
        detail.error?.message ?? `Kakarayan returned HTTP ${response.status}`,
        response.status,
        detail.error?.field,
      );
    }
    const value = (await response.json()) as T;
    const responseRelease =
      response.headers.get("X-Kakarayan-Release") ??
      ((value as {release_id?: string})?.release_id || undefined);
    if (this.releaseId && responseRelease && responseRelease !== this.releaseId) {
      throw new KakarayanError(
        "release_mismatch",
        `Expected release ${this.releaseId}, received ${responseRelease}`,
        409,
      );
    }
    return value;
  }

  private livePath(name: string, values: object): string {
    if (this.mode !== "live") {
      throw new KakarayanError(
        "live_api_required",
        `${name} requires a live API base URL`,
        400,
      );
    }
    const query = parameters(values);
    return `/v1/${name}${query ? `?${query}` : ""}`;
  }

  async ensureRelease(): Promise<void> {
    if (!this.releaseId) return;
    this.releaseCheck ??= this.getMeta().then(() => undefined);
    await this.releaseCheck;
  }

  getMeta<T = Record<string, unknown>>(): Promise<T> {
    return this.json<T>(this.mode === "static" ? staticPath("meta") : "/v1/meta");
  }

  async getLanguages<T = Array<Record<string, unknown>>>(): Promise<T> {
    await this.ensureRelease();
    return this.json<T>(this.mode === "static" ? staticPath("languages") : "/v1/languages");
  }

  async getCorpora<T = Array<Record<string, unknown>>>(): Promise<T> {
    await this.ensureRelease();
    return this.json<T>(this.mode === "static" ? staticPath("corpora") : "/v1/corpora");
  }

  async getSearchManifest<T = Record<string, unknown>>(): Promise<T> {
    if (this.mode !== "static") {
      throw new KakarayanError(
        "static_api_required",
        "Search shards are available from the static API",
        400,
      );
    }
    await this.ensureRelease();
    return this.json<T>("/api/v1/search/manifest.json");
  }

  async getSearchShard<T = Array<Record<string, unknown>>>(path: string): Promise<T> {
    if (this.mode !== "static" || !/^search\/shards\/[\w./-]+\.json$/.test(path)) {
      throw new KakarayanError("invalid_shard", "The search shard path is invalid", 400);
    }
    await this.ensureRelease();
    return this.json<T>(`/data/${path}`);
  }

  dictionary<T = Record<string, unknown>>(options: DictionaryOptions): Promise<Page<T>> {
    return this.json<Page<T>>(this.livePath("dictionary", options));
  }

  concordance<T = Record<string, unknown>>(options: ConcordanceOptions): Promise<Page<T>> {
    return this.json<Page<T>>(this.livePath("concordance", options));
  }

  frequencies<T = Record<string, unknown>>(options: FrequencyOptions): Promise<Page<T>> {
    return this.json<Page<T>>(this.livePath("frequencies", options));
  }

  async *pages<T>(
    request: (cursor?: string) => Promise<Page<T>>,
  ): AsyncGenerator<T, void, undefined> {
    let cursor: string | undefined;
    do {
      const page = await request(cursor);
      yield* page.items;
      cursor = page.next_cursor ?? undefined;
    } while (cursor);
  }

  async download(url: string, expectedSha256: string): Promise<Uint8Array> {
    if (!url.startsWith(`${this.baseUrl}/`)) {
      throw new KakarayanError(
        "invalid_download_url",
        "Downloads must use the configured Kakarayan origin",
        400,
      );
    }
    const path = url.slice(this.baseUrl.length);
    const response = await this.response(path);
    if (!response.ok) {
      throw new KakarayanError(
        "download_failed",
        `Download returned HTTP ${response.status}`,
        response.status,
      );
    }
    const data = await response.arrayBuffer();
    const checksum = hex(await crypto.subtle.digest("SHA-256", data));
    if (checksum !== expectedSha256.toLowerCase()) {
      throw new KakarayanError("checksum_mismatch", "Download checksum verification failed", 409);
    }
    return new Uint8Array(data);
  }
}
