import type {MatchMode} from "./types";

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const SPACELESS_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;

function characterBefore(value: string, index: number): string {
  return Array.from(value.slice(0, index)).at(-1) ?? "";
}

function isWordCharacter(value: string): boolean {
  return Boolean(value && WORD_CHARACTER.test(value));
}

export function queryMatchRanges(
  text: string,
  query: string,
  mode: MatchMode,
): Array<{start: number; end: number}> {
  const needle = query.trim().toLocaleLowerCase();
  if (!needle) return [];
  const haystack = text.toLocaleLowerCase();
  const useWordBoundaries = !SPACELESS_SCRIPT.test(needle);
  const ranges: Array<{start: number; end: number}> = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, cursor);
    if (start < 0) break;
    const end = start + needle.length;
    const startsAtBoundary = !useWordBoundaries || mode === "contains" ||
      !isWordCharacter(characterBefore(haystack, start));
    if (startsAtBoundary) ranges.push({start, end});
    cursor = Math.max(end, start + 1);
  }
  return ranges;
}

export function queryMatchesText(text: string, query: string, mode: MatchMode): boolean {
  return queryMatchRanges(text, query, mode).length > 0;
}
