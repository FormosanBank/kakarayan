import type {MatchMode} from "./types";
import caseFold from "./caseFold.json";

const WORD_CHARACTER = /[\p{L}\p{M}\p{N}]/u;
const SPACELESS_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u;
const EDGE_PUNCTUATION = /^[\s!"#$%&()*+,\-./:;<=>?@[\]\\^_`{|}~…—–“”‘’„‚«»「」『』，。！？、；：（）〈〉《》【】]+|[\s!"#$%&()*+,\-./:;<=>?@[\]\\^_`{|}~…—–“”‘’„‚«»「」『』，。！？、；：（）〈〉《》【】]+$/gu;
// Python's Unicode casefold exceptions to lowercase, generated with Python 3.13.
const CASE_FOLD: Readonly<Record<string, string>> = caseFold;
const SEGMENTS = new Intl.Segmenter("und", {granularity: "grapheme"});

function normalizedWithOffsets(text: string) {
  let value = "";
  const offsets: Array<{start: number; end: number}> = [];
  for (const {segment, index} of SEGMENTS.segment(text)) {
    const folded = Array.from(segment.normalize("NFC"),
      (character) => CASE_FOLD[character] ?? character.toLowerCase()).join("");
    for (const character of folded) {
      const end = index + segment.length;
      if (/\s/u.test(character)) {
        if (value.endsWith(" ")) {
          const last = offsets.at(-1);
          if (last) last.end = end;
          continue;
        }
        value += " ";
        offsets.push({start: index, end});
      } else {
        value += character;
        for (let unit = 0; unit < character.length; unit += 1) offsets.push({start: index, end});
      }
    }
  }
  return {value, offsets};
}

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
  const needle = normalizedWithOffsets(query).value.replace(EDGE_PUNCTUATION, "");
  if (!needle) return [];
  const {value: haystack, offsets} = normalizedWithOffsets(text);
  const useWordBoundaries = !SPACELESS_SCRIPT.test(needle);
  const ranges: Array<{start: number; end: number}> = [];
  let cursor = 0;
  while (cursor <= haystack.length - needle.length) {
    const start = haystack.indexOf(needle, cursor);
    if (start < 0) break;
    const end = start + needle.length;
    const startsAtBoundary = !useWordBoundaries || mode === "contains" ||
      !isWordCharacter(characterBefore(haystack, start));
    const sourceStart = offsets[start]?.start;
    const sourceEnd = offsets[end - 1]?.end;
    if (startsAtBoundary && sourceStart !== undefined && sourceEnd !== undefined) {
      const previous = ranges.at(-1);
      if (previous && sourceStart < previous.end) previous.end = Math.max(previous.end, sourceEnd);
      else ranges.push({start: sourceStart, end: sourceEnd});
    }
    cursor = Math.max(end, start + 1);
  }
  return ranges;
}

export function queryMatchesText(text: string, query: string, mode: MatchMode): boolean {
  return queryMatchRanges(text, query, mode).length > 0;
}
