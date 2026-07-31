import {useCallback, useEffect, useState} from "react";

import type {
  AppData,
  Corpus,
  Language,
  LearningContentCatalog,
  Meta,
  ModelCatalog,
  OrthographyCatalog,
  RightsCatalog,
  SearchManifest,
  SearchRecord,
  SearchShard,
} from "./types";

const base = import.meta.env.BASE_URL;
const dataBase = `${base}data/`;

async function json<T>(url: string, signal?: AbortSignal): Promise<T> {
  const response = await fetch(url, {
    headers: {Accept: "application/json"},
    ...(signal ? {signal} : {}),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return (await response.json()) as T;
}

async function sha256(data: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

async function compressedJson<T>(
  url: string,
  expectedCompressedSha256: string,
  expectedUncompressedSha256: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    headers: {Accept: "application/gzip, application/octet-stream"},
    ...(signal ? {signal} : {}),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const received = await response.arrayBuffer();
  const bytes = new Uint8Array(received);
  const isGzip = bytes[0] === 0x1f && bytes[1] === 0x8b;
  let uncompressed: ArrayBuffer;
  if (isGzip) {
    if ((await sha256(received)) !== expectedCompressedSha256) {
      throw new Error(`Search shard checksum mismatch: ${url}`);
    }
    if ("DecompressionStream" in globalThis) {
      const stream = new Blob([received])
        .stream()
        .pipeThrough(new DecompressionStream("gzip"));
      uncompressed = await new Response(stream).arrayBuffer();
    } else {
      const {gunzipSync} = await import("fflate");
      uncompressed = gunzipSync(bytes).buffer as ArrayBuffer;
    }
  } else {
    uncompressed = received;
  }
  if ((await sha256(uncompressed)) !== expectedUncompressedSha256) {
    throw new Error(`Search shard content checksum mismatch: ${url}`);
  }
  return JSON.parse(new TextDecoder().decode(uncompressed)) as T;
}

export async function loadAppData(signal?: AbortSignal): Promise<AppData> {
  const [meta, languages, corpora, rights, models, search, orthography, content] =
    await Promise.all([
    json<Meta>(`${base}api/v1/meta.json`, signal),
    json<Language[]>(`${base}api/v1/languages.json`, signal),
    json<Corpus[]>(`${base}api/v1/corpora.json`, signal),
    json<RightsCatalog>(`${base}api/v1/rights.json`, signal),
    json<ModelCatalog>(`${base}api/v1/models.json`, signal),
    json<SearchManifest>(`${base}api/v1/search/manifest.json`, signal),
      json<OrthographyCatalog>(`${base}api/v1/orthography.json`, signal),
      json<LearningContentCatalog>(`${base}api/v1/content.json`, signal),
    ]);
  if (search.release_id !== meta.release_id) {
    throw new Error("Search and catalogue release IDs do not match");
  }
  return {meta, languages, corpora, rights, models, search, orthography, content};
}

interface DataState {
  data: AppData | null;
  error: Error | null;
  loading: boolean;
  reload: () => void;
}

export function useAppData(): DataState {
  const [attempt, setAttempt] = useState(0);
  const [state, setState] = useState<Omit<DataState, "reload">>({
    data: null,
    error: null,
    loading: true,
  });
  useEffect(() => {
    const controller = new AbortController();
    loadAppData(controller.signal).then(
      (data) => setState({data, error: null, loading: false}),
      (cause: unknown) => {
        if (controller.signal.aborted) return;
        setState({
          data: null,
          error: cause instanceof Error ? cause : new Error(String(cause)),
          loading: false,
        });
      },
    );
    return () => controller.abort();
  }, [attempt]);
  const reload = useCallback(() => {
    setState({data: null, error: null, loading: true});
    setAttempt((value) => value + 1);
  }, []);
  return {...state, reload};
}

const shardCache = new Map<string, Promise<SearchRecord[]>>();

export function matchingShards(
  manifest: SearchManifest,
  languageId: string,
  corpusId: string,
): SearchShard[] {
  return manifest.shards.filter(
    (shard) =>
      shard.language_id === languageId && (!corpusId || shard.corpus_id === corpusId),
  );
}

async function loadShard(shard: SearchShard, signal?: AbortSignal): Promise<SearchRecord[]> {
  const existing = shardCache.get(shard.path);
  if (existing) return existing;
  const request = compressedJson<SearchRecord[]>(
    `${dataBase}${shard.path}`,
    shard.sha256,
    shard.uncompressed_sha256,
    signal,
  );
  shardCache.set(shard.path, request);
  try {
    return await request;
  } catch (error) {
    shardCache.delete(shard.path);
    throw error;
  }
}

export type SearchMode =
  | "source"
  | "exact"
  | "prefix"
  | "contains"
  | "translation"
  | "phonology"
  | "gloss"
  | "fuzzy"
  | "regex";

export function normalizeSearch(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase();
}

function sourceForms(record: SearchRecord): string[] {
  return [
    record.standard,
    record.original,
    ...record.tokens.map((token) => token.surface),
    ...record.forms.map((form) => form.text),
  ].filter(Boolean);
}

function normalizedForms(record: SearchRecord): string[] {
  return [
    normalizeSearch(record.standard),
    normalizeSearch(record.original),
    ...record.tokens.map((token) => token.normalized),
    ...record.forms.map((form) => form.normalized),
  ].filter(Boolean);
}

function editDistance(left: string, right: string, maximum: number): number {
  const a = [...left];
  const b = [...right];
  if (Math.abs(a.length - b.length) > maximum) return maximum + 1;
  let previous = b.map((_, index) => index + 1);
  previous.unshift(0);
  for (let row = 1; row <= a.length; row += 1) {
    const current = [row];
    let rowMinimum = row;
    for (let column = 1; column <= b.length; column += 1) {
      const value = Math.min(
        (current[column - 1] ?? maximum + 1) + 1,
        (previous[column] ?? maximum + 1) + 1,
        (previous[column - 1] ?? maximum + 1) +
          (a[row - 1] === b[column - 1] ? 0 : 1),
      );
      current.push(value);
      rowMinimum = Math.min(rowMinimum, value);
    }
    if (rowMinimum > maximum) return maximum + 1;
    previous = current;
  }
  return previous[b.length] ?? maximum + 1;
}

function fuzzyDistance(record: SearchRecord, query: string): number {
  const needle = normalizeSearch(query);
  const maximum = needle.length <= 4 ? 1 : 2;
  let best = maximum + 1;
  for (const form of normalizedForms(record)) {
    if (form.length > 80) continue;
    best = Math.min(best, editDistance(form, needle, maximum));
    if (best === 0) break;
  }
  return best;
}

export function recordMatches(record: SearchRecord, query: string, mode: SearchMode): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return false;
  if (mode === "source") {
    const exact = query.normalize("NFC").trim();
    return sourceForms(record).some((form) => form.normalize("NFC") === exact);
  }
  if (mode === "translation") {
    return record.translations.some((item) => normalizeSearch(item.text).includes(needle));
  }
  if (mode === "phonology") {
    return record.phonology.some((item) => normalizeSearch(item.text).includes(needle));
  }
  if (mode === "gloss") {
    return record.tier_translations.some(
      (item) =>
        item.owner_type !== "sentence" &&
        (normalizeSearch(item.text).includes(needle) ||
          normalizeSearch(item.normalized).includes(needle)),
    );
  }
  if (mode === "fuzzy") return fuzzyDistance(record, query) <= (needle.length <= 4 ? 1 : 2);
  if (mode === "regex") {
    throw new Error("Regular expressions are compiled through RE2 during scoped search");
  }
  const forms = normalizedForms(record);
  if (mode === "exact") return forms.some((form) => form === needle);
  if (mode === "prefix") return forms.some((form) => form.startsWith(needle));
  return forms.some((form) => form.includes(needle));
}

export interface SearchResult {
  records: SearchRecord[];
  scanned: number;
  truncated: boolean;
}

export async function searchRecords(
  shards: SearchShard[],
  query: string,
  mode: SearchMode,
  signal?: AbortSignal,
  limit = 200,
): Promise<SearchResult> {
  if (query.length > (mode === "regex" ? 128 : 256)) {
    throw new Error(`${mode === "regex" ? "Regular expression" : "Query"} is too long`);
  }
  const scopedRecords = shards.reduce((total, shard) => total + shard.records, 0);
  if ((mode === "regex" || mode === "fuzzy") && scopedRecords > 200_000) {
    throw new Error(
      "Regex and fuzzy search are limited to 200,000 records. Choose a corpus to narrow the scope.",
    );
  }
  let regex: {test(value: string): boolean} | null = null;
  if (mode === "regex") {
    try {
      const {RE2JS} = await import("re2js");
      regex = RE2JS.compile(query.normalize("NFC"));
    } catch (cause) {
      throw new Error(
        `Invalid RE2 pattern: ${cause instanceof Error ? cause.message : String(cause)}`,
        {cause},
      );
    }
  }
  const records: SearchRecord[] = [];
  const fuzzyScores = new Map<string, number>();
  let scanned = 0;
  let truncated = false;
  for (const shard of shards) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    const shardRecords = await loadShard(shard, signal);
    for (const record of shardRecords) {
      scanned += 1;
      const matches = regex
        ? [
            ...sourceForms(record),
            ...record.translations.map((item) => item.text),
            ...record.tier_translations.map((item) => item.text),
            ...record.phonology.map((item) => item.text),
          ].some((value) => regex?.test(value.normalize("NFC")))
        : recordMatches(record, query, mode);
      if (matches) {
        if (mode === "fuzzy") fuzzyScores.set(record.id, fuzzyDistance(record, query));
        if (records.length < limit) records.push(record);
        else truncated = true;
      }
    }
  }
  if (mode === "fuzzy") {
    records.sort(
      (left, right) =>
        (fuzzyScores.get(left.id) ?? 3) - (fuzzyScores.get(right.id) ?? 3) ||
        left.source_path.localeCompare(right.source_path) ||
        left.id.localeCompare(right.id),
    );
  }
  return {records, scanned, truncated};
}

export interface ScopeEstimate {
  records: number;
  compressedBytes: number;
  uncompressedBytes: number;
}

export function estimateScope(shards: SearchShard[]): ScopeEstimate {
  return shards.reduce(
    (total, shard) => ({
      records: total.records + shard.records,
      compressedBytes: total.compressedBytes + shard.bytes,
      uncompressedBytes: total.uncompressedBytes + shard.uncompressed_bytes,
    }),
    {records: 0, compressedBytes: 0, uncompressedBytes: 0},
  );
}

export async function loadScopeRecords(
  shards: SearchShard[],
  signal?: AbortSignal,
  maxRecords = 50_000,
): Promise<SearchRecord[]> {
  const estimate = estimateScope(shards);
  if (estimate.records > maxRecords) {
    throw new Error(
      `This scope contains ${estimate.records.toLocaleString()} records. Narrow it below ${maxRecords.toLocaleString()} or use a prepared download.`,
    );
  }
  const records: SearchRecord[] = [];
  for (const shard of shards) {
    if (signal?.aborted) throw new DOMException("Load cancelled", "AbortError");
    records.push(...(await loadShard(shard, signal)));
  }
  return records;
}

export async function loadPreviewRecords(
  shards: SearchShard[],
  signal?: AbortSignal,
  limit = 25,
): Promise<SearchRecord[]> {
  const records: SearchRecord[] = [];
  for (const shard of shards) {
    if (signal?.aborted) throw new DOMException("Load cancelled", "AbortError");
    const values = await loadShard(shard, signal);
    records.push(...values.slice(0, Math.max(0, limit - records.length)));
    if (records.length >= limit) break;
  }
  return records;
}
