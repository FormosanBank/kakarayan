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

interface ModelSummary {
  languages: string[];
}

interface DownloadSummary {
  artifacts: unknown[];
}

const routes = [
  ["", /FormosanBank, ready to use/],
  ["#/lookup", /Dictionary and sentences/],
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

async function staticApiData<T>(page: Page, endpoint: string): Promise<T> {
  const response = await page.request.get(`api/v1/${endpoint}.json`);
  expect(response.ok()).toBe(true);
  const envelope = (await response.json()) as StaticEnvelope<T>;
  return envelope.data;
}

test("all primary routes load a consistent release", async ({page}) => {
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", {level: 1, name: heading})).toBeVisible();
    await expect(page.locator(".release-pill")).toHaveText(/^fb-\d{8}-[0-9a-f]{8}$/);
  }
});

test("landing page foregrounds audiences, project stats, and direct tool access", async ({
  page,
}) => {
  await page.goto("");
  const main = page.locator("#main");
  await expect(main.getByRole("heading", {name: "Corpus snapshot"})).toBeVisible();
  await expect(main.getByText("For learners", {exact: true})).toBeVisible();
  await expect(
    main.getByText(
      "Save a dictionary entry or sentence, then review it in your private local deck.",
    ),
  ).toBeVisible();
  await expect(main.getByRole("link", {name: /Open learning tools/})).toHaveAttribute(
    "href",
    "#/learn",
  );
  await expect(main.getByRole("link", {name: /Open research tools/})).toHaveAttribute(
    "href",
    "#/research",
  );
  await expect(main.getByRole("link", {name: /Read API docs/})).toHaveAttribute(
    "href",
    "#/developers",
  );
  await expect(main.locator(".corpus-signal")).toHaveCount(0);
  await expect(main.locator(".home-stat")).toHaveCount(5);
  await expect(main.locator(".home-tools__grid > a")).toHaveCount(5);
  const geometry = await page.evaluate(() => ({
    viewport: window.innerWidth,
    document: document.documentElement.scrollWidth,
  }));
  expect(geometry.document).toBe(geometry.viewport);
});

test("landing page does not use decorative animation", async ({page}) => {
  await page.goto("");
  const animatedElements = await page.locator("#main *").evaluateAll((elements) =>
    elements.filter((element) => getComputedStyle(element).animationName !== "none").length,
  );
  expect(animatedElements).toBe(0);
});

test("legacy lookup routes open the matching mode on the unified page", async ({page}) => {
  await page.goto("#/dictionary");
  await expect(page.getByRole("button", {name: "Dictionary lookup"})).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await page.goto("#/sentences");
  await expect(page.getByRole("button", {name: "Sentence lookup"})).toHaveAttribute(
    "aria-pressed",
    "true",
  );
});

test("language and corpus catalogue entries have stable detail routes", async ({page}) => {
  await page.goto("#/languages/lang_amis");
  await expect(page.getByRole("heading", {level: 1, name: "Amis"})).toBeVisible();
  await expect(page.getByText("ISO 639-3 ami")).toBeVisible();
  await expect(page.getByText("No reviewed autonym")).toHaveCount(0);
  await expect(page.getByText("Searchable sentences in this language").first()).toBeVisible();
  await expect(page.locator("#main").getByRole("link", {name: "Dictionary"})).toHaveAttribute(
    "href",
    /#\/lookup\?type=dictionary&language=lang_amis/,
  );
  await expect(page.locator("#main").getByRole("link", {name: "Sentence search"})).toHaveAttribute(
    "href",
    /#\/lookup\?type=sentences&language=lang_amis/,
  );

  const response = await page.request.get("api/v1/corpora.json");
  expect(response.ok()).toBe(true);
  const corpora = (await response.json()) as StaticEnvelope<CorpusSummary[]>;
  const corpus = corpora.data[0];
  if (!corpus) throw new Error("The static API returned no corpora");
  await page.goto(`#/corpora/${corpus.id}`);
  await expect(page.getByRole("heading", {level: 1, name: corpus.name})).toBeVisible();
  await expect(page.getByRole("combobox", {name: "Search language"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Search sentences"})).toHaveCount(1);
  await expect(page.getByRole("link", {name: "Pinned public source"})).toHaveAttribute(
    "href",
    /FormosanBank\/tree\/[0-9a-f]{40}\/Corpora\//,
  );
  await expect(page.getByText(/approved for Kakarayan's noncommercial distribution/)).toBeVisible();
});

test("developer documentation links all maintained client libraries", async ({page}) => {
  await page.goto("#/developers");
  await page.getByRole("button", {name: "Run request"}).click();
  await expect(page.locator(".api-explorer__response")).toContainText("fb-");
  await expect(page.locator(".api-explorer__response")).toContainText('"api_version": "v1"');
  const clients = page.locator(".client-grid");
  await expect(clients.getByRole("heading", {name: "JavaScript"})).toBeVisible();
  await expect(clients.getByRole("heading", {name: "Python"})).toBeVisible();
  await expect(clients.getByRole("heading", {name: "R", exact: true})).toBeVisible();
  await expect(clients.getByRole("link", {name: "Setup and source →"})).toHaveCount(3);
});

test("model language coverage links into the matching learner tool", async ({page}) => {
  const {models} = await staticApiData<{models: ModelSummary[]}>(page, "models");
  test.skip(
    !models.some((model) => model.languages.includes("pwn")),
    "Requires a release with the public Paiwan model catalog",
  );
  await page.goto("#/models");
  await page.getByRole("combobox", {name: "Language coverage"}).selectOption({label: "Paiwan"});
  await expect(page.locator(".model-grid > article")).toHaveCount(5);
  await page.getByRole("link", {name: "Open ASR practice"}).click();
  await expect(page.getByRole("combobox", {name: "Learning language"})).toHaveValue("lang_paiwan");
  await expect(page.getByRole("tab", {name: "Pronunciation"})).toHaveAttribute("aria-selected", "true");
});

test("local corpus search reads a compressed shard", async ({page}) => {
  const searchAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/data/search/")) searchAssets.push(response.url());
  });
  await page.goto("#/lookup?type=sentences");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word or phrase in Amis").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  const firstResult = page.locator(".result-card").first();
  await expect(firstResult).toBeVisible();
  await expect(firstResult).toContainText(/lima/i);
  await firstResult.locator(".record-provenance").click();
  await expect(firstResult.getByRole("link", {name: "Source XML"})).toHaveAttribute(
    "href",
    /FormosanBank\/blob\/[0-9a-f]{40}\//,
  );
  expect(searchAssets.some((url) => url.includes("/indexes/"))).toBe(true);
  expect(searchAssets.some((url) => url.includes("/shards/"))).toBe(true);
  await expect(page.locator(".results-heading")).toContainText(/\d[\d,]* sentences?/);
  await expect(firstResult.locator(".kwic mark")).toContainText(/lima/i);
  await firstResult.getByRole("link", {name: "Stable record link"}).click();
  await page.reload();
  await expect(page.locator(".result-card").first()).toContainText(/lima/i);
});

test("dictionary lookup returns cited word meanings separately from sentence search", async ({
  page,
}) => {
  await page.goto("#/lookup?type=dictionary");
  await expect(page.getByRole("button", {name: "Dictionary lookup"})).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await selectSmallAmisScope(page, "NTUFormosanCorpus");
  await page.getByLabel("Word in Amis", {exact: true}).fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  const entry = page.locator(".dictionary-entry").first();
  await expect(entry).toBeVisible();
  await expect(entry.getByRole("heading", {name: /lima/i})).toBeVisible();
  await expect(entry).toContainText(/five/i);
  await expect(entry.getByRole("link", {name: "View sentences"})).toHaveAttribute(
    "href",
    /#\/lookup\?type=sentences&q=lima/,
  );
  await expect(entry.getByRole("button", {name: "Save word"})).toBeEnabled();
  await entry.getByRole("link", {name: "View sentences"}).click();
  await expect(page.getByRole("button", {name: "Sentence lookup"})).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.locator(".result-card").first()).toBeVisible();
});

test("dictionary and sentence lookup search from translations back to Formosan", async ({
  page,
}) => {
  await page.goto("#/lookup?type=dictionary");
  const corpus = await selectSmallAmisScope(page);
  test.skip(corpus !== "TestCorpus", "Reverse lookup fixture is tested in the bounded CI corpus");
  await page.getByRole("radio", {name: /English Translations and meanings/}).check();
  await page.getByLabel("Meaning in English").fill("five");
  await page.getByRole("button", {name: "Search"}).click();
  const entry = page.locator(".dictionary-entry").first();
  await expect(entry.getByRole("heading", {name: "lima"})).toBeVisible();
  await expect(entry).toContainText("FIVE");
  await expect(page).toHaveURL(/direction=translation/);

  await page.goto("#/lookup?type=sentences");
  await selectSmallAmisScope(page);
  await page.getByRole("radio", {name: /English Translations and meanings/}).check();
  await page.getByLabel("Word or phrase in English").fill("fictional");
  await page.getByRole("button", {name: "Search"}).click();
  const sentence = page.locator(".result-card").first();
  await expect(sentence.locator(".kwic")).toContainText("lima waco");
  await expect(sentence.locator(".translation-match mark")).toHaveText("fictional");
});

test("scoped RE2 search runs without weakening the content security policy", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("#/lookup?type=sentences");
  await selectSmallAmisScope(page);
  await page.getByRole("radio", {name: "Scoped RE2"}).check();
  await page.getByLabel("Word or phrase in Amis").fill("li.a");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await expect(page.locator(".callout--error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("concordance filters apply dialect and evidence requirements before counting", async ({
  page,
}) => {
  await page.goto("#/lookup?type=sentences");
  const corpus = await selectSmallAmisScope(page, "ePark");
  test.skip(corpus === "TestCorpus", "The generated fixture has no stable dialect mix");
  await page.getByRole("combobox", {name: "Dialect", exact: true}).selectOption("Coastal");
  await page.getByLabel("Word or phrase in Amis").fill("fangcalay");
  await page.getByRole("button", {name: "Search", exact: true}).click();
  await expect(page.locator(".result-card")).toHaveCount(1);
  await expect(page.locator(".result-summary")).toContainText("1 sentence");
  await expect(page.locator(".result-card__scope")).toContainText("Coastal");
});

test("dataset recipes and worker summaries are available without a backend", async ({
  page,
}) => {
  await page.goto("#/research");
  await page.getByRole("tab", {name: "Dataset builder"}).click();
  await selectSmallAmisScope(page, "MontgomeryTexts");
  const datasetFields = page.locator(".dataset-fields");
  await expect(datasetFields.getByRole("checkbox")).toHaveCount(13);
  await page.getByRole("button", {name: "Select all"}).click();
  await expect(datasetFields.getByRole("checkbox", {checked: true})).toHaveCount(13);
  await page.getByRole("button", {name: "Clear"}).click();
  await expect(datasetFields.getByRole("checkbox", {checked: true})).toHaveCount(0);
  await page.getByRole("button", {name: "Essential"}).click();
  await expect(page.getByRole("button", {name: "Essential"})).toHaveAttribute("aria-pressed", "true");
  await page.getByLabel("Record unit").selectOption("word");
  await page.getByRole("button", {name: "Refresh preview"}).click();
  await expect(
    page.getByRole("heading", {name: "Dataset preview"}),
  ).toBeVisible({timeout: 30_000});
  await expect(page.getByText(/First \d+ word rows/)).toBeVisible();
  await expect(page.locator(".builder__preview").getByRole("table")).toBeVisible();
  await expect(page.locator(".builder__estimate")).toContainText("Estimated output rows");
  await page.getByLabel("Output row cap").selectOption("all");
  await expect(page.locator(".builder__estimate")).toContainText("All rows");
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
  await page.goto("#/lookup?type=sentences");
  await selectSmallAmisScope(page);
  await page.getByLabel("Word or phrase in Amis").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible({timeout: 10_000});
  await page.getByLabel("Export").selectOption("parquet");
  const blocked = page.getByText(/Search-result data export is disabled/);
  if (await blocked.isVisible()) {
    await expect(page.getByRole("button", {name: "Download shown", exact: true})).toBeDisabled();
    return;
  }
  const parquetDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download shown", exact: true}).click();
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

test("prepared downloads are readable, filterable, and hide internal blocker codes", async ({
  page,
}) => {
  const {artifacts} = await staticApiData<DownloadSummary>(page, "downloads");
  test.skip(
    artifacts.length === 0,
    "Requires a release built with prepared download artifacts",
  );
  await page.goto("#/downloads");
  const main = page.locator("#main");
  const cards = main.locator(".artifact-card");
  await expect(cards.first()).toBeVisible();
  expect(await cards.count()).toBeLessThanOrEqual(24);
  await expect(cards.first().getByRole("heading", {level: 2})).not.toHaveText(/\.gz$|\.zip$/);
  await expect(main).not.toContainText(/rights_[a-z0-9_]+/);

  const unavailable = cards.first().getByText("Why is this unavailable?");
  if ((await unavailable.count()) > 0) {
    await unavailable.click();
    await expect(cards.first()).toContainText(/held from release/);
  }

  await page.getByRole("combobox", {name: "Format"}).selectOption("xml");
  await expect(main.getByRole("button", {name: "Clear filters"})).toBeVisible();
  await expect(cards.first().locator(".file-mark")).toHaveText("XML");
});

test("model catalogue keeps repeated caveats inside per-model details", async ({page}) => {
  const {models} = await staticApiData<{models: ModelSummary[]}>(page, "models");
  test.skip(models.length === 0, "Requires a release with the public model catalog");
  await page.goto("#/models");
  const cards = page.locator(".model-grid > article");
  await expect(cards).toHaveCount(20);
  await expect(page.getByText("Intended use from metadata:")).toHaveCount(0);
  const details = cards.first().getByText("Metadata and limitations", {exact: true});
  await details.click();
  await expect(cards.first().getByText("Intended use:", {exact: true})).toBeVisible();

  await page.getByRole("button", {name: /^MT 4$/}).click();
  await expect(cards).toHaveCount(4);
});

test("Traditional Chinese navigation updates content and document language", async ({page}) => {
  await page.goto("");
  await page.getByLabel("Interface language").selectOption("zh-Hant");
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.getByRole("heading", {level: 1})).toContainText(
    "FormosanBank，開箱即用",
  );
  await page.goto("#/explore");
  await expect(page.getByRole("heading", {level: 1})).toContainText("探索語料庫");
  await expect(page.getByPlaceholder("篩選語言…")).toBeVisible();

  await page.goto("#/lookup?type=sentences");
  await expect(page.getByLabel("Amis單詞或片語")).toBeVisible();
  await page.goto("#/research");
  await page.getByRole("tab", {name: "資料集產生器"}).click();
  await expect(page.getByRole("heading", {name: "選擇記錄"})).toBeVisible();

  await page.goto("#/learn");
  await expect(page.getByRole("tab", {name: /學習字卡/})).toBeVisible();
  await page.getByRole("tab", {name: /發音練習/}).click();
  await expect(page.getByRole("heading", {name: "發音錄音工具"})).toBeVisible();

  await page.goto("#/downloads");
  const pendingRights = page.getByText("部分套件尚未發布。");
  if ((await pendingRights.count()) > 0) await expect(pendingRights).toBeVisible();
  await expect(page.getByRole("heading", {name: "選擇格式"})).toBeVisible();
});

test("primary navigation and research tabs are keyboard operable", async ({
  page,
}, testInfo) => {
  await page.goto("");
  await expect(page.getByRole("heading", {level: 1, name: /FormosanBank, ready/})).toBeVisible();
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
  await expect(page.getByRole("heading", {level: 1, name: /FormosanBank, ready/})).toBeVisible();
  const mobile = testInfo.project.name === "mobile-chromium";
  const primaryNavigation = mobile
    ? page.locator(".mobile-menu").getByRole("navigation", {name: "Primary"})
    : page.locator(".primary-nav");
  const researchLink = primaryNavigation.getByRole("link", {name: "Research", exact: true});
  if (testInfo.project.name === "desktop-webkit") {
    await researchLink.focus();
  } else if (mobile) {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Kakarayan home"})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(page.getByRole("combobox", {name: "Interface language"})).toBeFocused();
    await page.keyboard.press("Tab");
    const menu = page.locator(".mobile-menu > summary");
    await expect(menu).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.locator(".mobile-menu")).toHaveAttribute("open", "");
    await page.keyboard.press("Tab");
    await expect(
      primaryNavigation.getByRole("link", {name: "Lookup", exact: true}),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(primaryNavigation.getByRole("link", {name: "Learn", exact: true})).toBeFocused();
    await page.keyboard.press("Tab");
  } else {
    await page.keyboard.press("Tab");
    await page.keyboard.press("Tab");
    await expect(page.getByRole("link", {name: "Kakarayan home"})).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(
      primaryNavigation.getByRole("link", {name: "Lookup", exact: true}),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(primaryNavigation.getByRole("link", {name: "Learn", exact: true})).toBeFocused();
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
    page.getByRole("heading", {name: "Choose the records"}),
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
  await page.goto("#/lookup?type=sentences");
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
  await page.getByLabel("Word or phrase in Amis").fill("lima");
  const coldStart = Date.now();
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".kwic mark").first()).toContainText(/lima/i);
  const coldSearchMs = Date.now() - coldStart;

  const warmQuery = corpus === "TestCorpus" ? "waco" : "fangcalay";
  await page.getByLabel("Word or phrase in Amis").fill(warmQuery);
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
