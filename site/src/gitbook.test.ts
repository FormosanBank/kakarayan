import {describe, expect, it} from "vitest";

import {
  GITBOOK_CORPUS_PAGES,
  GITBOOK_TOPICS,
  gitBookPageUrl,
  hasGitBookTranslation,
} from "./gitbook";

describe("GitBook integration", () => {
  it("maps every corpus in the current public release to documentation", () => {
    expect(Object.keys(GITBOOK_CORPUS_PAGES)).toHaveLength(22);
    expect(Object.values(GITBOOK_CORPUS_PAGES).every((page) => page.en.length > 0)).toBe(true);
  });

  it("marks the canonical live English pages as fallbacks in Traditional Chinese", () => {
    const xml = GITBOOK_TOPICS.find((topic) => topic.id === "xml");
    const developers = GITBOOK_TOPICS.find((topic) => topic.id === "developers");
    expect(xml).toBeDefined();
    expect(developers).toBeDefined();
    expect(gitBookPageUrl(xml!, "zh-Hant")).toContain("/the-bank-architecture/formosanbank-xml-format");
    expect(hasGitBookTranslation(xml!, "zh-Hant")).toBe(false);
    expect(gitBookPageUrl(developers!, "zh-Hant")).toContain("/the-bank-architecture/developers");
    expect(hasGitBookTranslation(developers!, "zh-Hant")).toBe(false);
  });
});
