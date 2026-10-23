import {describe, expect, it} from "vitest";

import {DOCS_CORPUS_PAGES, DOCS_TOPICS, docsPageUrl} from "./docs";

describe("FormosanBank documentation links", () => {
  it("opens the welcome page at the documentation root in each locale", () => {
    expect(docsPageUrl(DOCS_TOPICS[0], "en")).toBe("https://formosanbank.github.io/FormosanBank/");
    expect(docsPageUrl(DOCS_TOPICS[0], "zh-Hant")).toBe(
      "https://formosanbank.github.io/FormosanBank/zh/",
    );
  });

  it("maps every public corpus to its documentation page", () => {
    expect(Object.keys(DOCS_CORPUS_PAGES)).toHaveLength(34);
    expect(Object.values(DOCS_CORPUS_PAGES).every((page) => page.en.endsWith("/"))).toBe(true);
  });

  it("uses the English page when no Traditional Chinese page exists", () => {
    const developers = DOCS_TOPICS.find((topic) => topic.id === "developers");
    expect(docsPageUrl(developers!, "zh-Hant")).toBe(
      "https://formosanbank.github.io/FormosanBank/the-bank-architecture/developers/",
    );
  });
});
