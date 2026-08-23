import {createElement} from "react";
import {renderToStaticMarkup} from "react-dom/server";
import {describe, expect, it} from "vitest";

import {QueryHighlight} from "./components/QueryHighlight";
import {queryMatchRanges, queryMatchesText} from "./queryMatching";

describe("query highlighting", () => {
  it("finds an exact term inside sentence punctuation and possessives", () => {
    expect(queryMatchRanges('"What are you doing father,"', "father", "exact"))
      .toEqual([{start: 20, end: 26}]);
    expect(queryMatchRanges("Mother's and Father's tombs.", "father", "exact"))
      .toEqual([{start: 13, end: 19}]);
  });

  it("shows inflected exact matches without marking the middle of another word", () => {
    expect(queryMatchRanges("father fathers fatherhood", "father", "exact")).toEqual([
      {start: 0, end: 6},
      {start: 7, end: 13},
      {start: 15, end: 21},
    ]);
    expect(queryMatchRanges("grandfather", "father", "exact")).toEqual([]);
  });

  it("respects prefix and contains modes", () => {
    expect(queryMatchRanges("father grandfather", "fath", "prefix"))
      .toEqual([{start: 0, end: 4}]);
    expect(queryMatchRanges("father grandfather", "fath", "contains"))
      .toEqual([{start: 0, end: 4}, {start: 12, end: 16}]);
  });

  it("matches case-insensitively and supports phrases and Chinese text", () => {
    expect(queryMatchesText("Father said hello", "father", "exact")).toBe(true);
    expect(queryMatchesText("My dear father spoke", "dear father", "exact")).toBe(true);
    expect(queryMatchesText("這是父親的家", "父親", "exact")).toBe(true);
  });

  it("renders the matching range without changing surrounding text", () => {
    const html = renderToStaticMarkup(createElement(QueryHighlight, {
      text: '"What are you doing father,"',
      query: "father",
      mode: "exact",
      active: true,
    }));
    expect(html).toContain('doing <mark class="query-highlight">father</mark>,');
  });
});
