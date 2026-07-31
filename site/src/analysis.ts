import type {SearchRecord} from "./types";

export interface CountRow {
  value: string;
  count: number;
}

export interface AnalysisResult {
  records: number;
  tokens: number;
  sourceTypes: number;
  normalizedTypes: number;
  sourceFrequencies: CountRow[];
  normalizedFrequencies: CountRow[];
  translationFrequencies: CountRow[];
  distributions: CountRow[];
  ngrams: CountRow[];
  collocates: CountRow[];
  sampleIds: string[];
  seed: string;
  ngramSize: number;
  collocate: string;
}

export interface AnalysisOptions {
  ngramSize: number;
  collocate: string;
  seed: string;
}

function codePointOrder(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function rows(counts: Map<string, number>, limit = 200): CountRow[] {
  return [...counts]
    .map(([value, count]) => ({value, count}))
    .sort((left, right) => right.count - left.count || codePointOrder(left.value, right.value))
    .slice(0, limit);
}

function add(counts: Map<string, number>, value: string) {
  if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
}

function normalize(value: string): string {
  return value.normalize("NFC").trim().toLocaleLowerCase();
}

function seedValue(seed: string): number {
  let value = 2166136261;
  for (const character of seed) {
    value ^= character.codePointAt(0) ?? 0;
    value = Math.imul(value, 16777619);
  }
  return value >>> 0 || 1;
}

function random(seed: string): () => number {
  let state = seedValue(seed);
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 4294967296;
  };
}

export function analyzeRecords(
  records: SearchRecord[],
  options: AnalysisOptions,
): AnalysisResult {
  const ngramSize = Math.min(5, Math.max(1, Math.trunc(options.ngramSize)));
  const source = new Map<string, number>();
  const normalized = new Map<string, number>();
  const translation = new Map<string, number>();
  const distribution = new Map<string, number>();
  const ngrams = new Map<string, number>();
  const collocates = new Map<string, number>();
  const collocate = normalize(options.collocate);
  let tokenCount = 0;

  for (const record of records) {
    add(
      distribution,
      `${record.language_id} · ${record.corpus_id} · ${record.dialect || "unspecified dialect"}`,
    );
    const tokens = record.tokens.map((token) => token.surface.normalize("NFC"));
    const normalizedTokens = record.tokens.map((token) => normalize(token.normalized));
    tokenCount += tokens.length;
    for (const token of tokens) add(source, token);
    for (const token of normalizedTokens) add(normalized, token);
    for (const item of record.translations) {
      for (const match of item.text.normalize("NFC").matchAll(/[\p{L}\p{N}'’-]+/gu)) {
        add(translation, normalize(match[0]));
      }
    }
    for (let index = 0; index + ngramSize <= normalizedTokens.length; index += 1) {
      add(ngrams, normalizedTokens.slice(index, index + ngramSize).join(" "));
    }
    if (collocate) {
      for (let index = 0; index < normalizedTokens.length; index += 1) {
        if (normalizedTokens[index] !== collocate) continue;
        const start = Math.max(0, index - 2);
        const end = Math.min(normalizedTokens.length, index + 3);
        for (let neighbor = start; neighbor < end; neighbor += 1) {
          if (neighbor !== index) add(collocates, normalizedTokens[neighbor] ?? "");
        }
      }
    }
  }

  const next = random(options.seed);
  const sampled = records
    .map((record) => ({id: record.id, value: next()}))
    .sort((left, right) => left.value - right.value || codePointOrder(left.id, right.id))
    .slice(0, Math.min(20, records.length))
    .map((item) => item.id);

  return {
    records: records.length,
    tokens: tokenCount,
    sourceTypes: source.size,
    normalizedTypes: normalized.size,
    sourceFrequencies: rows(source),
    normalizedFrequencies: rows(normalized),
    translationFrequencies: rows(translation),
    distributions: rows(distribution),
    ngrams: rows(ngrams),
    collocates: rows(collocates),
    sampleIds: sampled,
    seed: options.seed,
    ngramSize,
    collocate,
  };
}
