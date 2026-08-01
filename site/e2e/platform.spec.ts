import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";

interface StaticEnvelope<T> {
  data: T;
}

interface CorpusSummary {
  id: string;
  name: string;
}

const routes = [
  ["", /Find words, sentences, and research data/],
  ["#/dictionary", /Dictionary/],
  ["#/sentences", /Sentence search/],
  ["#/learn", /Learn from corpus examples/],
  ["#/research", /Research tools/],
  ["#/explore", /Explore the bank/],
  ["#/downloads", /Download public data/],
  ["#/developers", /Build with FormosanBank/],
  ["#/models", /Public language models/],
  ["#/about", /About Kakarayan/],
] as const;

async function selectSmallAmisScope(page: Page, fullCorpus = "Glosbe") {
  const formosanLanguage = page.getByRole("combobox", {
    name: "Formosan language",
    exact: true,
  });
  const language = formosanLanguage
    .or(page.getByRole("combobox", {name: "Language", exact: true}))
    .first();
  await expect(language).toBeVisible();
  await language.selectOption({label: "Amis"});
  const searchOptions = page.getByText("Search options", {exact: true});
  if ((await searchOptions.count()) > 0) await searchOptions.first().click();
  const corpus = page.getByRole("combobox", {name: "Corpus", exact: true}).first();
  const labels = await corpus.locator("option").allTextContents();
  const label = labels.includes("TestCorpus") ? "TestCorpus" : fullCorpus;
  expect(labels).toContain(label);
  await corpus.selectOption({label});
  return label;
}

test("all primary routes load a consistent release", async ({page}) => {
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", {level: 1, name: heading})).toBeVisible();
    await expect(page.locator(".release-pill")).toHaveText(/^fb-\d{8}-[0-9a-f]{8}$/);
  }
});

test("language and corpus catalogue entries have stable detail routes", async ({page}) => {
  await page.goto("#/languages/lang_amis");
  await expect(page.getByRole("heading", {level: 1, name: "Amis"})).toBeVisible();
  await expect(page.getByText("ISO 639-3 ami")).toBeVisible();
  await expect(page.locator("#main").getByRole("link", {name: "Dictionary"})).toHaveAttribute(
    "href",
    /#\/dictionary\?language=lang_amis/,
  );
  await expect(page.locator("#main").getByRole("link", {name: "Sentence search"})).toHaveAttribute(
    "href",
    /#\/sentences\?language=lang_amis/,
  );

  const response = await page.request.get("api/v1/corpora.json");
  expect(response.ok()).toBe(true);
  const corpora = (await response.json()) as StaticEnvelope<CorpusSummary[]>;
  const corpus = corpora.data[0];
  if (!corpus) throw new Error("The static API returned no corpora");
  await page.goto(`#/corpora/${corpus.id}`);
  await expect(page.getByRole("heading", {level: 1, name: corpus.name})).toBeVisible();
  await expect(page.getByRole("link", {name: "Pinned public source"})).toHaveAttribute(
    "href",
    /FormosanBank\/tree\/[0-9a-f]{40}\/Corpora\//,
  );
  await expect(page.getByText(/approved for Kakarayan's noncommercial distribution/)).toBeVisible();
});

test("local corpus search reads a compressed shard", async ({page}) => {
  const searchAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/data/search/")) searchAssets.push(response.url());
  });
  await page.goto("#/sentences");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word, phrase, or translation").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await expect(page.locator(".result-card").first()).toContainText(/lima/i);
  await expect(page.getByRole("link", {name: "Source XML"}).first()).toHaveAttribute(
    "href",
    /FormosanBank\/blob\/[0-9a-f]{40}\//,
  );
  expect(searchAssets.some((url) => url.includes("/indexes/"))).toBe(true);
  expect(searchAssets.some((url) => url.includes("/shards/"))).toBe(true);
  await expect(page.locator(".results-heading")).toContainText(/\d[\d,]* sentences/);
  await expect(page.locator(".kwic mark").first()).toContainText(/lima/i);
  await page.getByRole("link", {name: "Stable record link"}).first().click();
  await page.reload();
  await expect(page.locator(".result-card").first()).toContainText(/lima/i);
});

test("dictionary lookup returns cited word meanings separately from sentence search", async ({
  page,
}) => {
  await page.goto("#/dictionary");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word", {exact: true}).fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  const entry = page.locator(".dictionary-entry").first();
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("heading", {name: /lima/i})).toBeVisible();
  await expect(entry).toContainText("FIVE");
  await expect(entry.getByRole("link", {name: "View sentences"})).toHaveAttribute(
    "href",
    /#\/sentences\?q=lima/,
  );
  await expect(entry.getByRole("button", {name: "Save word"})).toBeEnabled();
});

test("scoped RE2 search runs without weakening the content security policy", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("#/sentences");
  await selectSmallAmisScope(page);
  await page.getByRole("radio", {name: "Scoped RE2"}).check();
  await page.getByLabel("Word, phrase, or translation").fill("li.a");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await expect(page.locator(".callout--error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("dataset recipes and worker summaries are available without a backend", async ({
  page,
}) => {
  await page.goto("#/research");
  await page.getByRole("tab", {name: "Dataset builder"}).click();
  await selectSmallAmisScope(page, "MontgomeryTexts");
  await page.getByLabel("Record unit").selectOption("word");
  await page.getByRole("button", {name: "Preview"}).click();
  await expect(
    page.getByRole("heading", {name: "Preview in deterministic source order"}),
  ).toBeVisible({timeout: 30_000});
  await expect(page.getByText(/projected word rows/)).toBeVisible();
  await page.getByLabel("Format").selectOption("recipe");
  const recipeDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download", exact: true}).click();
  const recipe = await recipeDownload;
  expect(recipe.suggestedFilename()).toMatch(/-recipe\.json$/);
  const recipePath = await recipe.path();
  expect(recipePath).not.toBeNull();
  const document = JSON.parse(await readFile(recipePath as string, "utf8")) as {
    release_id: string;
    selection: {language_ids: string[]; record_unit: string};
  };
  expect(document.release_id).toMatch(/^fb-\d{8}-[0-9a-f]{8}$/);
  expect(document.selection.language_ids).toEqual(["lang_amis"]);
  expect(document.selection.record_unit).toBe("word");

  await page.getByRole("tab", {name: "Linguistic summaries"}).click();
  await selectSmallAmisScope(page);
  await page.getByRole("button", {name: "Compute summaries"}).click();
  await expect(page.getByText("source-exact types")).toBeVisible();
  const summaryRows = page.getByRole("table").getByRole("row");
  await expect(summaryRows).not.toHaveCount(1);
  await expect(summaryRows.nth(1).getByRole("cell").first()).not.toHaveText("");
});

test("lazy DuckDB-Wasm export creates a real Parquet file", async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Large export smoke test runs on desktop");
  test.setTimeout(120_000);
  await page.goto("#/sentences");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word, phrase, or translation").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible({timeout: 10_000});
  await page.getByLabel("Export").selectOption("parquet");
  const blocked = page.getByText(/Search-result data export is disabled/);
  if (await blocked.isVisible()) {
    await expect(page.getByRole("button", {name: "Download", exact: true})).toBeDisabled();
    return;
  }
  const parquetDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download", exact: true}).click();
  const parquet = await parquetDownload;
  expect(parquet.suggestedFilename()).toMatch(/\.parquet$/);
  const parquetPath = await parquet.path();
  expect(parquetPath).not.toBeNull();
  const contents = await readFile(parquetPath as string);
  expect(contents.subarray(0, 4).toString("ascii")).toBe("PAR1");
  expect(contents.subarray(-4).toString("ascii")).toBe("PAR1");
});

test("learning content fails closed when no reviewed lesson is published", async ({
  page,
}) => {
  await page.goto("#/learn");
  await page.getByRole("tab", {name: "Notes"}).click();
  await expect(
    page.getByRole("heading", {name: "No reviewed notes yet"}),
  ).toBeVisible();
  await expect(page.getByText(/Community-authored notes will appear here after review/)).toBeVisible();
});

test("Traditional Chinese navigation updates content and document language", async ({page}) => {
  await page.goto("");
  await page.getByLabel("Interface language").selectOption("zh-Hant");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.getByRole("heading", {level: 1})).toContainText(
    "查單詞、找例句、下載研究資料",
  );
  await page.goto("#/explore");
  await expect(page.getByRole("heading", {level: 1})).toContainText("探索語料庫");
  await expect(page.getByPlaceholder("篩選語言…")).toBeVisible();

  await page.goto("#/sentences");
  await expect(page.getByLabel("單詞、片語或翻譯")).toBeVisible();
  await page.goto("#/research");
  await page.getByRole("tab", {name: "資料集產生器"}).click();
  await expect(page.getByRole("heading", {name: "建立有界限的語言學資料集"})).toBeVisible();

  await page.goto("#/learn");
  await expect(page.getByRole("tab", {name: /學習字卡/})).toBeVisible();
  await page.getByRole("tab", {name: /發音練習/}).click();
  await expect(page.getByRole("heading", {name: "發音錄音工具"})).toBeVisible();

  await page.goto("#/downloads");
  const pendingRights = page.getByText("權利審查仍在進行中。");
  if ((await pendingRights.count()) > 0) await expect(pendingRights).toBeVisible();
  await expect(page.getByRole("heading", {name: "格式指南"})).toBeVisible();
});

test("primary navigation and research tabs are keyboard operable", async ({
  page,
}, testInfo) => {
  await page.goto("");
  await expect(page.getByRole("heading", {level: 1, name: /Find words/})).toBeVisible();
  const skipLink = page.getByRole("link", {name: "Skip to content"});
  if (testInfo.project.name === "desktop-webkit") {
    // Desktop Safari follows the system "Press Tab to highlight" preference.
    await skipLink.focus();
  } else {
    await page.keyboard.press("Tab");
  }
  await expect(skipLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  await page.goto("");
  await expect(page.getByRole("heading", {level: 1, name: /Find words/})).toBeVisible();
  const researchLink = page.getByRole("link", {name: "Research", exact: true}).first();
  if (testInfo.project.name === "desktop-webkit") {
    await researchLink.focus();
  } else {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Kakarayan home"})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Dictionary", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Sentences", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Learn", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
  }
  await expect(researchLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", {level: 1, name: "Research tools"})).toBeVisible();

  await page.goto("#/research");
  const builderTab = page.getByRole("tab", {name: "Dataset builder"});
  await builderTab.focus();
  await page.keyboard.press("Enter");
  await expect(builderTab).toHaveAttribute("aria-selected", "true");
  await expect(
    page.getByRole("heading", {name: "Build a bounded linguistic dataset"}),
  ).toBeVisible();
});

test("primary pages have no serious accessibility violations", async ({page}, testInfo) => {
  for (const [route] of routes) {
    await page.goto(route);
    await expect(page.locator("#main h1")).toBeVisible();
    const result = await new AxeBuilder({page})
      .withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa"])
      .analyze();
    const violations = result.violations.filter(
      (violation) => violation.impact === "critical" || violation.impact === "serious",
    );
    expect(violations, `${testInfo.project.name} ${route || "home"}`).toEqual([]);
  }
});

test("browser transfer, search latency, and memory stay within release budgets", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Release budgets are measured once in desktop Chromium",
  );
  await page.goto("#/sentences");
  const resources = await page.evaluate(() => {
    const entries = [
      ...performance.getEntriesByType("navigation"),
      ...performance.getEntriesByType("resource"),
    ] as PerformanceResourceTiming[];
    return entries.map((entry) => ({
      name: entry.name,
      bytes: Math.max(entry.transferSize, entry.encodedBodySize),
    }));
  });
  const initialBytes = resources.reduce((total, entry) => total + entry.bytes, 0);
  const javascriptBytes = resources
    .filter((entry) => new URL(entry.name).pathname.endsWith(".js"))
    .reduce((total, entry) => total + entry.bytes, 0);
  const catalogueBytes = resources
    .filter((entry) => new URL(entry.name).pathname.includes("/api/v1/"))
    .reduce((total, entry) => total + entry.bytes, 0);

  expect(initialBytes).toBeLessThan(2 * 1024 * 1024);
  expect(javascriptBytes).toBeLessThan(500 * 1024);
  expect(catalogueBytes).toBeLessThan(1024 * 1024);

  const corpus = await selectSmallAmisScope(page);
  await page.getByLabel("Word, phrase, or translation").fill("lima");
  const coldStart = Date.now();
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".kwic mark").first()).toContainText(/lima/i);
  const coldSearchMs = Date.now() - coldStart;

  const warmQuery = corpus === "TestCorpus" ? "waco" : "fangcalay";
  await page.getByLabel("Word, phrase, or translation").fill(warmQuery);
  const warmStart = Date.now();
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".kwic mark").first()).toContainText(
    new RegExp(warmQuery, "i"),
  );
  const warmSearchMs = Date.now() - warmStart;
  const memoryBytes = await page.evaluate(() => {
    const measured = performance as Performance & {
      memory?: {usedJSHeapSize: number};
    };
    return measured.memory?.usedJSHeapSize ?? 0;
  });

  expect(coldSearchMs).toBeLessThan(5_000);
  expect(warmSearchMs).toBeLessThan(2_000);
  if (memoryBytes > 0) expect(memoryBytes).toBeLessThan(500 * 1024 * 1024);

  await testInfo.attach("browser-budget-report.json", {
    body: Buffer.from(
      JSON.stringify(
        {
          release: await page.locator(".release-pill").textContent(),
          corpus,
          initial_bytes: initialBytes,
          javascript_bytes: javascriptBytes,
          catalogue_bytes: catalogueBytes,
          cold_search_ms: coldSearchMs,
          warm_search_ms: warmSearchMs,
          used_js_heap_bytes: memoryBytes || null,
        },
        null,
        2,
      ),
    ),
    contentType: "application/json",
  });
});
