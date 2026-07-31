import AxeBuilder from "@axe-core/playwright";
import {expect, test} from "@playwright/test";

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

test("local corpus search reads a compressed shard", async ({page}) => {
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
