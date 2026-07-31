import {useCallback, useEffect, useState} from "react";

import type {
  AppData,
  Corpus,
  Language,
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
  expectedSha256: string,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, {
    headers: {Accept: "application/gzip, application/octet-stream"},
    ...(signal ? {signal} : {}),
  });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  const compressed = await response.arrayBuffer();
  if ((await sha256(compressed)) !== expectedSha256) {
    throw new Error(`Search shard checksum mismatch: ${url}`);
  }
  let text: string;
  if ("DecompressionStream" in globalThis) {
    const stream = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream("gzip"));
    text = await new Response(stream).text();
  } else {
    const {gunzipSync, strFromU8} = await import("fflate");
    text = strFromU8(gunzipSync(new Uint8Array(compressed)));
  }
  return JSON.parse(text) as T;
}

export async function loadAppData(signal?: AbortSignal): Promise<AppData> {
  const [meta, languages, corpora, rights, models, search, orthography] = await Promise.all([
    json<Meta>(`${base}api/v1/meta.json`, signal),
    json<Language[]>(`${base}api/v1/languages.json`, signal),
    json<Corpus[]>(`${base}api/v1/corpora.json`, signal),
    json<RightsCatalog>(`${base}api/v1/rights.json`, signal),
    json<ModelCatalog>(`${base}api/v1/models.json`, signal),
    json<SearchManifest>(`${base}api/v1/search/manifest.json`, signal),
    json<OrthographyCatalog>(`${base}api/v1/orthography.json`, signal),
  ]);
  if (search.release_id !== meta.release_id) {
    throw new Error("Search and catalogue release IDs do not match");
  }
  return {meta, languages, corpora, rights, models, search, orthography};
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

export type SearchMode = "exact" | "prefix" | "contains" | "translation";

export function normalizeSearch(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase();
}

export function recordMatches(record: SearchRecord, query: string, mode: SearchMode): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return false;
  if (mode === "translation") {
    return record.translations.some((item) => normalizeSearch(item.text).includes(needle));
  }
  const forms = [
    normalizeSearch(record.standard),
    normalizeSearch(record.original),
    ...record.tokens.map((token) => token.normalized),
  ].filter(Boolean);
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
  const records: SearchRecord[] = [];
  let scanned = 0;
  let truncated = false;
  for (const shard of shards) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    const shardRecords = await loadShard(shard, signal);
    for (const record of shardRecords) {
      scanned += 1;
      if (recordMatches(record, query, mode)) {
        if (records.length < limit) records.push(record);
        else truncated = true;
      }
    }
  }
  return {records, scanned, truncated};
}
