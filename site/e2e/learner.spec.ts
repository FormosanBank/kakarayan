import {expect, test, type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";

async function seedLegacyCard(page: Page) {
  await page.evaluate(
    () =>
      new Promise<void>((resolve, reject) => {
        const request = indexedDB.open("kakarayan-learning", 1);
        request.onupgradeneeded = () => {
          const store = request.result.createObjectStore("cards", {keyPath: "id"});
          store.createIndex("dueAt", "dueAt");
          store.createIndex("deck", "deck");
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const database = request.result;
          const transaction = database.transaction("cards", "readwrite");
          transaction.objectStore("cards").put({
            id: "legacy-card",
            deck: "Legacy",
            front: "legacy front",
            back: "legacy answer",
            languageId: "lang_amis",
            tags: ["migration"],
            source: null,
            createdAt: "2024-01-01T00:00:00.000Z",
            updatedAt: "2024-01-01T00:00:00.000Z",
            dueAt: "2024-01-01T00:00:00.000Z",
            intervalDays: 0,
            ease: 2.5,
            repetitions: 0,
            lapses: 0,
          });
          transaction.oncomplete = () => {
            database.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      }),
  );
}

test("local study data migrates, backs up, restores, and remains private", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "IndexedDB lifecycle is exercised once in desktop Chromium",
  );
  await page.goto("#/learn");
  await seedLegacyCard(page);
  const dictionary = page.getByRole("tabpanel");
  await dictionary.getByText("Search options", {exact: true}).click();
  const corpus = dictionary.getByRole("combobox", {name: "Corpus", exact: true});
  const corpusLabels = await corpus.locator("option").allTextContents();
  const corpusLabel = corpusLabels.includes("TestCorpus")
    ? "TestCorpus"
    : "NTUFormosanCorpus";
  expect(corpusLabels).toContain(corpusLabel);
  await corpus.selectOption({label: corpusLabel});
  await dictionary.getByLabel("Word in Amis", {exact: true}).fill("lima");
  await dictionary.getByRole("button", {name: "Search"}).click();
  await dictionary.getByRole("button", {name: "Save word"}).click();
  const saveNotice = dictionary.locator(".search-notice");
  await expect(saveNotice).toContainText("lima saved.");
  await expect(saveNotice).toHaveCSS("position", "fixed");
  const noticeBox = await saveNotice.boundingBox();
  expect(noticeBox).not.toBeNull();
  expect((noticeBox?.y ?? 0) + (noticeBox?.height ?? 0)).toBeLessThanOrEqual(
    page.viewportSize()!.height,
  );
  await page.getByRole("tab", {name: /Study deck/}).click();
  await expect(page.getByRole("heading", {name: "legacy front"})).toBeVisible();
  await expect(page.locator(".deck-toolbar")).toContainText("2 cards");

  const backupDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Export backup"}).click();
  const backup = await backupDownload;
  const backupPath = await backup.path();
  expect(backupPath).not.toBeNull();
  const document = JSON.parse(await readFile(backupPath as string, "utf8")) as {
    schemaVersion: number;
    cards: Array<{
      id: string;
      direction: string;
      audioReferences: string[];
    }>;
  };
  expect(document.schemaVersion).toBe(1);
  expect(document.cards).toHaveLength(2);
  expect(document.cards.find((card) => card.id === "legacy-card")).toMatchObject({
    direction: "recognition",
    audioReferences: [],
  });

  await page.getByText(/All local cards/).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", {name: "Delete all local cards"}).click();
  await expect(page.getByText(/Save a word or sentence/)).toBeVisible();

  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: "kakarayan-study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(document)),
  });
  await expect(page.locator(".deck-toolbar")).toContainText("2 cards");
  await expect(page.getByRole("heading", {name: "legacy front"})).toBeVisible();
});

test("microphone denial is recoverable and local audio can be deleted", async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Media permission behavior is exercised once in desktop Chromium",
  );
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
      },
    });
  });
  await page.goto("#/learn");
  await page.getByRole("tab", {name: /Pronunciation/}).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", {name: "Start recording"}).click();
  await expect(panel.getByText(/Microphone unavailable: Permission denied/)).toBeVisible();

  await panel.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: "local-practice.webm",
    mimeType: "audio/webm",
    buffer: Buffer.from("synthetic local audio"),
  });
  await expect(panel.locator("audio")).toBeVisible();
  await panel.getByRole("button", {name: "Delete", exact: true}).click();
  await expect(panel.getByText("Local recording deleted.")).toBeVisible();
  await expect(panel.locator("audio")).toHaveCount(0);
});

test("the learner shell and local cards remain available offline", async ({
  page,
  context,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Offline service-worker behavior is exercised once in desktop Chromium",
  );
  await page.goto("#/learn");
  await seedLegacyCard(page);
  await page.getByRole("tab", {name: /Study deck/}).click();
  await expect(page.getByRole("heading", {name: "legacy front"})).toBeVisible();
  await page.evaluate(async () => {
    await navigator.serviceWorker.ready;
  });
  await page.reload();
  await expect(page.getByRole("heading", {name: "Learn from corpus examples"})).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller)))
    .toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", {name: "Learn from corpus examples"})).toBeVisible();
  expect(
    await page.evaluate(() =>
      fetch(`uncached-offline-probe-${Date.now()}`).then(
        () => true,
        () => false,
      ),
    ),
  ).toBe(false);
  await page.getByRole("tab", {name: /Study deck/}).click();
  await expect(page.getByRole("heading", {name: "legacy front"})).toBeVisible();
});

test("learner tools share the full workspace width", async ({page}, testInfo) => {
  test.skip(
    !["desktop-chromium", "mobile-chromium"].includes(testInfo.project.name),
    "Workspace geometry is checked at desktop and mobile widths in Chromium",
  );
  await page.goto("#/learn");
  const panel = page.locator(".studio-panel");
  const panelWidth = await panel.evaluate((element) => element.getBoundingClientRect().width);
  const tools = [
    [/Lookup/, "#lookup-results"],
    [/Study deck/, ".study-deck"],
    [/Pronunciation/, ".model-tool"],
    [/Translation/, ".model-tool"],
    [/Orthography/, ".model-tool"],
    [/Notes/, ".reviewed-content, .empty-state"],
  ] as const;

  for (const [name, selector] of tools) {
    await page.getByRole("tab", {name}).click();
    const tool = panel.locator(selector).first();
    await expect(tool).toBeVisible();
    const width = await tool.evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.abs(width - panelWidth), `${String(name)} width`).toBeLessThanOrEqual(1);
  }
});
