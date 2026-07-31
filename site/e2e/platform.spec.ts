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
  ["", /Listen closely/],
  ["#/learn", /Amis learning studio/],
  ["#/explore", /Explore the bank/],
  ["#/search", /Corpus search/],
  ["#/downloads", /Download public data/],
  ["#/developers", /Build with FormosanBank/],
  ["#/models", /Public language models/],
  ["#/about", /About Kakarayan/],
] as const;

async function selectSmallAmisScope(page: Page, fullCorpus = "Glosbe") {
  const panel = page.getByRole("tabpanel");
  const language = panel.getByRole("combobox", {name: "Language", exact: true});
  const corpus = panel.getByRole("combobox", {name: "Corpus", exact: true});
  await expect(language).toBeVisible();
  await language.selectOption({label: "Amis"});
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
  await expect(page.getByRole("link", {name: "Search this language"})).toHaveAttribute(
    "href",
    /#\/search\?language=lang_amis/,
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
  await expect(page.getByText(/Public repository visibility is not a blanket license/)).toBeVisible();
});

test("local corpus search reads a compressed shard", async ({page}) => {
  const searchAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/data/search/")) searchAssets.push(response.url());
  });
  await page.goto("#/search");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word or meaning").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await expect(page.locator(".result-card").first()).toContainText(/lima/i);
  await expect(page.getByRole("link", {name: "Source XML"}).first()).toHaveAttribute(
    "href",
    /FormosanBank\/blob\/[0-9a-f]{40}\//,
  );
  expect(searchAssets.some((url) => url.includes("/indexes/"))).toBe(true);
  expect(searchAssets.some((url) => url.includes("/shards/"))).toBe(true);
  await expect(page.locator(".results-heading")).toContainText(/\d[\d,]* attestations/);
  await expect(page.locator(".results-heading")).toContainText("candidate records");
  await expect(page.locator(".kwic mark").first()).toContainText(/lima/i);
  await page.getByRole("button", {name: "Headword candidates"}).click();
  await expect(page.getByText(/not reviewed dictionary entries/)).toBeVisible();
  await page.getByRole("button", {name: "Concordance occurrences"}).click();
  await page.getByRole("link", {name: "Stable record link"}).first().click();
  await page.reload();
  await expect(page.locator(".result-card").first()).toContainText(/lima/i);
});

test("scoped RE2 search runs without weakening the content security policy", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("#/search");
  await selectSmallAmisScope(page);
  await page.getByRole("radio", {name: "Scoped RE2"}).check();
  await page.getByLabel("Word or meaning").fill("li.a");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await expect(page.locator(".callout--error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("dataset recipes and worker summaries are available without a backend", async ({
  page,
}) => {
  await page.goto("#/search");
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
  await page.goto("#/search");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word or meaning").fill("lima");
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
  await page.getByRole("tab", {name: /Reviewed notes/}).click();
  await expect(
    page.getByRole("heading", {name: "No reviewed lessons are published yet."}),
  ).toBeVisible();
  await expect(page.getByText(/does not generate grammar lessons/)).toBeVisible();
});

test("Traditional Chinese navigation updates content and document language", async ({page}) => {
  await page.goto("");
  await page.getByLabel("Interface language").selectOption("zh-Hant");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.getByRole("heading", {level: 1})).toContainText(
    "仔細聆聽，深入搜尋，讓語言繼續流傳",
  );
  await page.getByRole("link", {name: "探索", exact: true}).click();
  await expect(page.getByRole("heading", {level: 1})).toContainText("探索語料庫");
  await expect(page.getByPlaceholder("篩選語言…")).toBeVisible();

  await page.goto("#/search");
  await expect(page.getByRole("tab", {name: "索引行與詞典"})).toBeVisible();
  await expect(page.getByLabel("詞語或翻譯")).toBeVisible();
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
  await expect(page.getByRole("heading", {level: 1, name: /Listen closely/})).toBeVisible();
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
  await expect(page.getByRole("heading", {level: 1, name: /Listen closely/})).toBeVisible();
  const exploreLink = page.getByRole("link", {name: "Explore", exact: true});
  if (testInfo.project.name === "desktop-webkit") {
    await exploreLink.focus();
  } else {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Kakarayan home"})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Learn", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
  }
  await expect(exploreLink).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("heading", {level: 1, name: "Explore the bank"})).toBeVisible();

  await page.goto("#/search");
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
  await page.goto("#/search");
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
  await page.getByLabel("Word or meaning").fill("lima");
  const coldStart = Date.now();
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".kwic mark").first()).toContainText(/lima/i);
  const coldSearchMs = Date.now() - coldStart;

  const warmQuery = corpus === "TestCorpus" ? "waco" : "fangcalay";
  await page.getByLabel("Word or meaning").fill(warmQuery);
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
