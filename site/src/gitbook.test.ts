import {describe, expect, it} from "vitest";

import {GITBOOK_CORPUS_PAGES, GITBOOK_TOPICS, gitBookPageUrl} from "./gitbook";

describe("GitBook integration", () => {
  it("opens the canonical welcome page at the GitBook root", () => {
    expect(gitBookPageUrl(GITBOOK_TOPICS[0], "en")).toBe(
      "https://ai4commsci.gitbook.io/formosanbank",
    );
  });

  it("maps every corpus in the current public release to documentation", () => {
    expect(Object.keys(GITBOOK_CORPUS_PAGES)).toHaveLength(22);
    expect(Object.values(GITBOOK_CORPUS_PAGES).every((page) => page.en.length > 0)).toBe(true);
  });

  it("uses canonical live English pages as Traditional Chinese fallbacks", () => {
    const xml = GITBOOK_TOPICS.find((topic) => topic.id === "xml");
    const developers = GITBOOK_TOPICS.find((topic) => topic.id === "developers");
    expect(xml).toBeDefined();
    expect(developers).toBeDefined();
    expect(gitBookPageUrl(xml!, "zh-Hant")).toContain("/the-bank-architecture/formosanbank-xml-format");
    expect(gitBookPageUrl(developers!, "zh-Hant")).toContain("/the-bank-architecture/developers");
  });
});
