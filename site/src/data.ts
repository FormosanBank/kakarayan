import {useCallback, useEffect, useState} from "react";

import type {
  AppData,
  ApiEnvelope,
  Corpus,
  Language,
  LearningContentCatalog,
  Meta,
  ModelCatalog,
  OrthographyCatalog,
  RightsCatalog,
  SearchManifest,
  SearchIndex,
  SearchIndexDocument,
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

async function apiData<T>(url: string, signal?: AbortSignal): Promise<T> {
  const envelope = await json<ApiEnvelope<T>>(url, signal);
  if (
    envelope.api_version !== "v1" ||
    !envelope.release_id ||
    !envelope.source?.commit ||
    !envelope.kakarayan?.commit ||
    !("data" in envelope)
  ) {
    throw new Error(`Invalid static API envelope: ${url}`);
  }
  return envelope.data;
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
      apiData<Language[]>(`${base}api/v1/languages.json`, signal),
      apiData<Corpus[]>(`${base}api/v1/corpora.json`, signal),
      apiData<RightsCatalog>(`${base}api/v1/rights.json`, signal),
      apiData<ModelCatalog>(`${base}api/v1/models.json`, signal),
      apiData<SearchManifest>(`${base}api/v1/search/manifest.json`, signal),
      apiData<OrthographyCatalog>(`${base}api/v1/orthography.json`, signal),
      apiData<LearningContentCatalog>(`${base}api/v1/content.json`, signal),
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

export function matchingIndexes(
  manifest: SearchManifest,
  languageId: string,
  corpusId: string,
): SearchIndex[] {
  return manifest.indexes.filter(
    (index) =>
      index.language_id === languageId && (!corpusId || index.corpus_id === corpusId),
  );
}

async function loadShard(shard: SearchShard, signal?: AbortSignal): Promise<SearchRecord[]> {
  const existing = shardCache.get(shard.path);
  if (existing) {
    try {
      return await existing;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") || signal?.aborted) {
        throw error;
      }
      if (shardCache.get(shard.path) === existing) shardCache.delete(shard.path);
      return loadShard(shard, signal);
    }
  }
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
    if (shardCache.get(shard.path) === request) shardCache.delete(shard.path);
    throw error;
  }
}

const indexCache = new Map<string, Promise<SearchIndexDocument>>();

async function loadIndex(
  index: SearchIndex,
  signal?: AbortSignal,
): Promise<SearchIndexDocument> {
  const existing = indexCache.get(index.path);
  if (existing) {
    try {
      return await existing;
    } catch (error) {
      if (!(error instanceof DOMException && error.name === "AbortError") || signal?.aborted) {
        throw error;
      }
      if (indexCache.get(index.path) === existing) indexCache.delete(index.path);
      return loadIndex(index, signal);
    }
  }
  const request = compressedJson<SearchIndexDocument>(
    `${dataBase}${index.path}`,
    index.sha256,
    index.uncompressed_sha256,
    signal,
  );
  indexCache.set(index.path, request);
  try {
    return await request;
  } catch (error) {
    if (indexCache.get(index.path) === request) indexCache.delete(index.path);
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

const edgePunctuation = new Set([
  ..." \t\n\r!\"#$%&()*+,-./:;<=>?@[\\]^_`{|}~…—–“”‘’„‚«»「」『』，。！？、；：（）〈〉《》【】",
]);

export function normalizeSearch(value: string): string {
  const characters = [...value.normalize("NFC")];
  let start = 0;
  let end = characters.length;
  while (start < end && edgePunctuation.has(characters[start] ?? "")) start += 1;
  while (end > start && edgePunctuation.has(characters[end - 1] ?? "")) end -= 1;
  return characters.slice(start, end).join("").toLowerCase();
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

type RegexMatcher = {test(value: string): boolean};

export function indexCandidateParts(
  index: SearchIndexDocument,
  query: string,
  mode: SearchMode,
  regex: RegexMatcher | null = null,
): Set<number> {
  const parts = new Set<number>();
  const needle = normalizeSearch(query);
  let vocabulary: Record<string, number[]>;
  let matches: (term: string) => boolean;
  if (mode === "source") {
    vocabulary = index.terms.source_exact;
    const source = query.normalize("NFC").trim();
    matches = (term) => term === source;
  } else if (mode === "regex") {
    if (!regex) throw new Error("A compiled RE2 expression is required");
    vocabulary = index.terms.regex;
    matches = (term) => regex.test(term);
  } else if (mode === "translation" || mode === "phonology" || mode === "gloss") {
    vocabulary = index.terms[mode];
    matches = (term) => term.includes(needle);
  } else {
    vocabulary = index.terms.source;
    if (mode === "exact") matches = (term) => term === needle;
    else if (mode === "prefix") matches = (term) => term.startsWith(needle);
    else if (mode === "contains") matches = (term) => term.includes(needle);
    else {
      const maximum = needle.length <= 4 ? 1 : 2;
      matches = (term) =>
        term.length <= 80 && editDistance(term, needle, maximum) <= maximum;
    }
  }
  for (const [term, postings] of Object.entries(vocabulary)) {
    if (!matches(term)) continue;
    for (const part of postings) parts.add(part);
  }
  return parts;
}

export function recordMatches(
  record: SearchRecord,
  query: string,
  mode: SearchMode,
  targetLanguage = "",
  targetTier: "sentence" | "any" = "sentence",
): boolean {
  const needle = normalizeSearch(query);
  if (!needle) return false;
  const targetTranslations =
    targetTier === "any" ? record.tier_translations : record.translations;
  const translations = targetLanguage
    ? record.translations.filter((item) => item.xml_lang === targetLanguage)
    : record.translations;
  if (
    targetLanguage &&
    !targetTranslations.some((item) => item.xml_lang === targetLanguage)
  ) {
    return false;
  }
  if (mode === "source") {
    const exact = query.normalize("NFC").trim();
    return sourceForms(record).some((form) => form.normalize("NFC") === exact);
  }
  if (mode === "translation") {
    return translations.some((item) => normalizeSearch(item.text).includes(needle));
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
  matches: number;
  truncated: boolean;
}

export async function searchRecords(
  shards: SearchShard[],
  query: string,
  mode: SearchMode,
  signal?: AbortSignal,
  limit = 200,
  indexes: SearchIndex[] = [],
  targetLanguage = "",
  targetTier: "sentence" | "any" = "sentence",
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
  let selectedShards = shards;
  if (indexes.length > 0) {
    const candidateParts = new Map<string, Set<number>>();
    for (const index of indexes) {
      if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
      const document = await loadIndex(index, signal);
      candidateParts.set(
        `${index.language_id}\0${index.corpus_id}`,
        indexCandidateParts(document, query, mode, regex),
      );
    }
    selectedShards = shards.filter((shard) =>
      candidateParts
        .get(`${shard.language_id}\0${shard.corpus_id}`)
        ?.has(shard.part),
    );
  }
  let records: SearchRecord[] = [];
  const fuzzyScores = new Map<string, number>();
  let scanned = 0;
  let matchesCount = 0;
  let truncated = false;
  for (const shard of selectedShards) {
    if (signal?.aborted) throw new DOMException("Search cancelled", "AbortError");
    const shardRecords = await loadShard(shard, signal);
    for (const record of shardRecords) {
      scanned += 1;
      const matches = regex
        ? [
            ...sourceForms(record),
            ...record.translations
              .filter((item) => !targetLanguage || item.xml_lang === targetLanguage)
              .map((item) => item.text),
            ...record.tier_translations.map((item) => item.text),
            ...record.phonology.map((item) => item.text),
          ].some((value) => regex?.test(value.normalize("NFC"))) &&
          (!targetLanguage ||
            (targetTier === "any" ? record.tier_translations : record.translations).some(
              (item) => item.xml_lang === targetLanguage,
            ))
        : recordMatches(record, query, mode, targetLanguage, targetTier);
      if (matches) {
        matchesCount += 1;
        if (mode === "fuzzy") fuzzyScores.set(record.id, fuzzyDistance(record, query));
        if (mode === "fuzzy" || records.length < limit) records.push(record);
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
    truncated = records.length > limit;
    records = records.slice(0, limit);
  }
  return {records, scanned, matches: matchesCount, truncated};
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
