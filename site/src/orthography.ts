import type {OrthographyTable} from "./types";

export interface OrthographyChange {
  from: string;
  to: string;
  position: number;
  ambiguous: boolean;
}
export function convertOrthography(
  text: string,
  table: OrthographyTable,
  dialect: string,
): {text: string; changes: OrthographyChange[]} {
  const rules = [...table.rules].sort((left, right) => right.input.length - left.input.length);
  const changes: OrthographyChange[] = [];
  let output = "";
  let cursor = 0;
  while (cursor < text.length) {
    const rule = rules.find((candidate) => text.startsWith(candidate.input, cursor));
    if (!rule) {
      output += text[cursor];
      cursor += 1;
      continue;
    }
    const mapped = rule.outputs[dialect] ?? "";
    const ambiguous = mapped === "";
    const replacement = ambiguous ? rule.input : mapped;
    output += replacement;
    if (replacement !== rule.input || ambiguous) {
      changes.push({from: rule.input, to: replacement, position: cursor, ambiguous});
    }
    cursor += rule.input.length;
  }
  return {text: output, changes};
}
