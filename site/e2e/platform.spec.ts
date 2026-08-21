import AxeBuilder from "@axe-core/playwright";
import {expect, test, type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";

async function selectFixtureScope(page: Page) {
  await page.getByRole("combobox", {name: "Formosan language"}).selectOption({label: "Amis"});
  await page.getByText("Search options", {exact: true}).click();
  const corpus = page.getByRole("combobox", {name: "Corpus", exact: true}).first();
  const labels = await corpus.locator("option").allTextContents();
  const selected = labels.includes("TestCorpus") ? "TestCorpus" : labels[1];
  if (!selected) throw new Error("The release has no searchable Amis corpus");
  await corpus.selectOption({label: selected});
}

async function expectAccessible(page: Page) {
  const result = await new AxeBuilder({page}).analyze();
  expect(result.violations).toEqual([]);
}

test("the release-pinned shell, routes, and locale switch work", async ({page}) => {
  await page.goto("");
  await expect(page.getByRole("heading", {level: 1})).toContainText("FormosanBank");
  await expect(page.locator(".release-pill")).toHaveText(/^fb-\d{8}-[0-9a-f]{7,12}$/u);
  expect(await page.locator(".primary-nav a").allTextContents()).toEqual([
    "Lookup",
    "Learn",
    "Research",
    "Download",
    "Developers",
    "Docs",
  ]);
  await expectAccessible(page);

  await page.getByRole("button", {name: "Traditional Chinese"}).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "zh-Hant");
  await expect(page.getByRole("heading", {level: 1})).toContainText("FormosanBank");
  await page.goto("#/research");
  await expect(page.getByRole("heading", {level: 1})).toHaveText("研究工具");
  await page.getByRole("button", {name: "英文"}).click();
  await expect(page.locator("html")).toHaveAttribute("lang", "en");
});

test("sentence and reverse dictionary lookup use summaries then on-demand detail", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto("#/lookup?type=sentences");
  await selectFixtureScope(page);
  const tierFieldset = page.locator(".filter-checks");
  const tierCheckbox = tierFieldset.getByRole("checkbox").first();
  const dialectSelect = page.getByRole("combobox", {name: "Dialect"});
  await expect(tierFieldset).toBeVisible();
  expect(await tierFieldset.evaluate((element) => getComputedStyle(element).borderTopWidth)).toBe("0px");
  expect((await tierCheckbox.boundingBox())?.width).toBeLessThanOrEqual(1);
  expect((await dialectSelect.boundingBox())?.height).toBeLessThanOrEqual(42);
  await page.getByLabel("Word or phrase").fill("lima");
  await page.getByRole("button", {name: "Search", exact: true}).click();

  const summary = page.locator(".result-card--summary").first();
  await expect(summary).toBeVisible();
  await expect(summary).toContainText(/lima/iu);
  expect(requests.some((url) => url.includes("/concordance?"))).toBe(true);
  expect(requests.some((url) => url.includes("/data/search/"))).toBe(false);
  expect(requests.some((url) => /\/sentences\/[^/?]+$/u.test(url))).toBe(false);

  await summary.getByRole("button", {name: "Open full record"}).click();
  const detail = page.locator(".result-card").first();
  await expect(detail.getByRole("button", {name: "Save to deck"})).toBeVisible();
  expect(requests.some((url) => /\/sentences\/[^/?]+$/u.test(url))).toBe(true);
  await detail.getByText("Source and record details", {exact: true}).click();
  await expect(detail.getByRole("link", {name: "Source XML"})).toHaveAttribute(
    "href",
    /FormosanBank\/blob\/[0-9a-f]{40}\//u,
  );

  await page.goto("#/lookup?type=dictionary");
  await selectFixtureScope(page);
  await page.getByRole("radio", {name: "Search in English"}).check();
  await page.getByLabel("Word or meaning").fill("five");
  await page.getByRole("button", {name: "Search", exact: true}).click();
  const entry = page.locator(".dictionary-entry").first();
  await expect(entry.getByRole("heading")).toContainText("lima");
  await expect(entry).toContainText("English");

  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  const cachedUrls = await page.evaluate(async () => {
    const values: string[] = [];
    for (const key of await caches.keys()) {
      const cache = await caches.open(key);
      values.push(...(await cache.keys()).map((request) => request.url));
    }
    return values;
  });
  expect(cachedUrls.some((url) => url.includes("/v1/releases/"))).toBe(false);
});

test("dictionary examples stay in the learning workspace", async ({page}) => {
  await page.goto("#/learn");
  await page.getByLabel("Word or meaning").fill("lima");
  await page.getByRole("button", {name: "Search", exact: true}).click();
  const entry = page.locator(".dictionary-entry").first();
  await expect(entry).toBeVisible();

  await entry.getByRole("button", {name: "View sentences"}).click();

  await expect(page).toHaveURL(/#\/learn\?/u);
  await expect(page.getByRole("button", {name: "Sentence lookup"})).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(page.getByLabel("Word or phrase")).toHaveValue("lima");
  await expect(page.locator(".result-card--summary").first()).toBeVisible();
});

test("research preview, finite recipe, export, and summaries share the API", async ({page}) => {
  await page.goto("#/research");
  const language = page.getByRole("combobox", {name: "Language", exact: true}).first();
  await language.selectOption({label: "Amis"});
  const corpus = page.getByRole("combobox", {name: "Corpus", exact: true}).first();
  const labels = await corpus.locator("option").allTextContents();
  if (labels.includes("TestCorpus")) await corpus.selectOption({label: "TestCorpus"});
  await expect(page.locator(".builder__preview").getByRole("table")).toBeVisible();
  await expect(page.locator(".builder__summary")).toContainText("Matching rows");

  await page.getByRole("combobox", {name: "Search field"}).selectOption("translation");
  const translationLanguage = page.getByRole("combobox", {name: "Translation language"});
  await expect(translationLanguage).toBeVisible();
  await translationLanguage.selectOption("eng");
  await page.getByLabel("Optional word or phrase").fill("five");
  await page.getByRole("combobox", {name: "Match"}).selectOption("contains");
  await expect(page.locator(".builder__summary dd").first()).toHaveText(/^[1-9][\d,]*$/u);

  const recipeDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download recipe"}).click();
  const recipePath = await (await recipeDownload).path();
  if (!recipePath) throw new Error("Recipe download has no local path");
  const recipe = JSON.parse(await readFile(recipePath, "utf8")) as {
    selection: {max_rows: number; record_unit: string; translation_language: string};
    format: string;
  };
  expect(recipe.selection).toMatchObject({
    max_rows: 1000,
    record_unit: "sentence",
    translation_language: "eng",
  });
  expect(["csv", "tsv", "jsonl"]).toContain(recipe.format);

  const exportDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download dataset"}).click();
  expect((await exportDownload).suggestedFilename()).toMatch(/\.csv$/u);

  await page.getByRole("tab", {name: "Linguistic summaries"}).click();
  await page.getByRole("combobox", {name: "Language", exact: true}).selectOption({label: "Amis"});
  await page.getByRole("button", {name: "Compute summaries"}).click();
  await expect(page.getByRole("table")).toBeVisible();
});

test("developer routes expose the query contract and static metadata", async ({page}) => {
  await page.goto("#/developers");
  await expect(page.getByRole("heading", {name: "Live API v1"})).toBeVisible();
  await expect(page.locator(".api-choice__primary")).toContainText("available");
  await expect(page.getByRole("link", {name: "Open API reference"})).toHaveAttribute("href", /\/docs$/u);
  await page.getByRole("button", {name: "Run request"}).click();
  await expect(page.locator(".api-explorer__response")).toContainText('"headword": "lima"');
  await page.getByRole("combobox", {name: "Request"}).selectOption("concordance");
  await page.getByRole("button", {name: "Run request"}).click();
  await expect(page.locator(".api-explorer__response")).toContainText('"standard":');
  await expect(page.locator(".code-samples")).toContainText("/concordance?");
  await expectAccessible(page);
});

test("static resources remain usable when the query service is unavailable", async ({page}) => {
  await page.route("**/readyz", (route) =>
    route.fulfill({status: 503, contentType: "application/json", body: "{}"}),
  );
  await page.goto("");
  await expect(page.getByRole("heading", {level: 1})).toContainText("FormosanBank");
  await page.goto("#/lookup");
  await expect(page.getByText("Corpus search is temporarily unavailable.")).toBeVisible();
  await page.goto("#/downloads");
  await expect(page.getByRole("heading", {level: 1})).toHaveText("Download public data");
});
