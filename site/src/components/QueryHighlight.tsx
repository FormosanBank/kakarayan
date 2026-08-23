import type {ReactNode} from "react";

import {queryMatchRanges} from "../queryMatching";
import type {MatchMode} from "../types";

export function QueryHighlight({
  text,
  query,
  mode,
  active,
}: {
  text: string;
  query: string;
  mode: MatchMode;
  active: boolean;
}) {
  if (!active) return text;
  const ranges = queryMatchRanges(text, query, mode);
  if (!ranges.length) return text;
  const parts: ReactNode[] = [];
  let cursor = 0;
  for (const {start, end} of ranges) {
    if (start > cursor) parts.push(text.slice(cursor, start));
    parts.push(
      <mark className="query-highlight" key={`${start}-${end}`}>
        {text.slice(start, end)}
      </mark>,
    );
    cursor = end;
  }
  if (cursor < text.length) parts.push(text.slice(cursor));
  return <>{parts}</>;
}
