import AxeBuilder from "@axe-core/playwright";
import {expect, test} from "@playwright/test";
import {readFile} from "node:fs/promises";

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

test("all primary routes load a consistent release", async ({page}) => {
  for (const [route, heading] of routes) {
    await page.goto(route);
    await expect(page.getByRole("heading", {level: 1, name: heading})).toBeVisible();
    await expect(page.locator(".release-pill")).toContainText("fb-20240102-");
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

  await page.goto("#/corpora/corpus_testcorpus");
  await expect(page.getByRole("heading", {level: 1, name: "TestCorpus"})).toBeVisible();
  await expect(page.getByRole("link", {name: "Pinned public source"})).toHaveAttribute(
    "href",
    /FormosanBank\/tree\/[0-9a-f]{40}\/Corpora\/TestCorpus/,
  );
  await expect(page.getByText(/Public repository visibility is not a blanket license/)).toBeVisible();
});

test("local corpus search reads a compressed shard", async ({page}) => {
  const searchAssets: string[] = [];
  page.on("response", (response) => {
    if (response.url().includes("/data/search/")) searchAssets.push(response.url());
  });
  await page.goto("#/search");
  await page.getByLabel("Language", {exact: true}).selectOption({label: "Amis"});
  await page.getByLabel("Word or meaning").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await expect(page.locator(".result-card").first()).toContainText("lima");
  await expect(page.getByRole("link", {name: "Source XML"}).first()).toHaveAttribute(
    "href",
    /FormosanBank\/blob\/[0-9a-f]{40}\//,
  );
  expect(searchAssets.some((url) => url.includes("/indexes/"))).toBe(true);
  expect(searchAssets.some((url) => url.includes("/shards/"))).toBe(true);
});

test("scoped RE2 search runs without weakening the content security policy", async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  await page.goto("#/search");
  await page.getByLabel("Language", {exact: true}).selectOption({label: "Amis"});
  await page.getByRole("radio", {name: "Scoped RE2"}).check();
  await page.getByLabel("Word or meaning").fill("li.a");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toContainText("lima");
  await expect(page.locator(".callout--error")).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test("dataset recipes and worker summaries are available without a backend", async ({
  page,
}) => {
  await page.goto("#/search");
  await page.getByRole("tab", {name: "Dataset builder"}).click();
  await page
    .getByRole("combobox", {name: "Language", exact: true})
    .selectOption({label: "Amis"});
  await page.getByRole("button", {name: "Preview"}).click();
  await expect(
    page.getByRole("heading", {name: "Preview in deterministic source order"}),
  ).toBeVisible();
  await page.getByLabel("Format").selectOption("recipe");
  const recipeDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download"}).click();
  const recipe = await recipeDownload;
  expect(recipe.suggestedFilename()).toMatch(/-recipe\.json$/);
  const recipePath = await recipe.path();
  expect(recipePath).not.toBeNull();
  const document = JSON.parse(await readFile(recipePath as string, "utf8")) as {
    release_id: string;
    selection: {language_ids: string[]};
  };
  expect(document.release_id).toMatch(/^fb-20240102-/);
  expect(document.selection.language_ids).toEqual(["lang_amis"]);

  await page.getByRole("tab", {name: "Linguistic summaries"}).click();
  await page
    .getByRole("combobox", {name: "Language", exact: true})
    .selectOption({label: "Amis"});
  await page.getByRole("button", {name: "Compute summaries"}).click();
  await expect(page.getByText("source-exact types")).toBeVisible();
  await expect(page.getByRole("table")).toContainText("lima");
});

test("lazy DuckDB-Wasm export creates a real Parquet file", async ({page}, testInfo) => {
  test.skip(testInfo.project.name.includes("mobile"), "Large export smoke test runs on desktop");
  test.setTimeout(120_000);
  await page.goto("#/search");
  await page.getByLabel("Language", {exact: true}).selectOption({label: "Amis"});
  await page.getByLabel("Word or meaning").fill("lima");
  await page.getByRole("button", {name: "Search"}).click();
  await expect(page.locator(".result-card").first()).toBeVisible();
  await page.getByLabel("Export").selectOption("parquet");
  const parquetDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Download"}).click();
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
  await page.getByRole("link", {name: "探索"}).click();
  await expect(page.getByRole("heading", {level: 1})).toContainText("探索語料庫");
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
