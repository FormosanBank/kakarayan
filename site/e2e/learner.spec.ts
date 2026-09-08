import {expect, test, type Page} from "@playwright/test";
import {readFile} from "node:fs/promises";

async function seedCard(page: Page) {
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
            id: "fixture-card",
            deck: "Practice",
            front: "practice front",
            back: "practice answer",
            languageId: "lang_amis",
            tags: ["backup"],
            direction: "recognition",
            audioReferences: [],
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

test("learn keeps one language context across its tools", async ({page}) => {
  await page.goto("learn");
  await expect(page.getByRole("heading", {level: 1})).toHaveText("Learn");
  await expect(page.getByRole("combobox", {name: "Formosan language"})).toHaveCount(1);
  await expect(page.getByRole("combobox", {name: "Dialect"})).toHaveCount(1);
  await expect(page.getByRole("combobox", {name: "Search text language"})).toBeVisible();
  await expect(page.getByRole("combobox", {name: "Translations in"})).toBeVisible();
  await expect(page.getByText("Corpus sentences", {exact: true})).toHaveCount(0);

  await page.getByRole("button", {name: "Sentence lookup"}).click();
  await page.getByText("Search options", {exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Dialect"})).toHaveCount(1);

  await page.getByRole("tab", {name: "Translation", exact: true}).click();
  await expect(page.getByRole("combobox", {name: "Formosan language"})).toHaveCount(1);
  await expect(page.getByRole("heading", {name: "Machine translation"})).toBeVisible();
});

test("local study data backs up and restores without losing fields", async ({page}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "IndexedDB is exercised once");
  await page.goto("learn");
  await seedCard(page);
  await page.getByRole("tab", {name: /Study deck/u}).click();
  await expect(page.getByRole("heading", {name: "practice front"})).toBeVisible();

  const download = page.waitForEvent("download");
  await page.getByRole("button", {name: "Export backup"}).click();
  const path = await (await download).path();
  if (!path) throw new Error("Study backup has no local path");
  const backup = JSON.parse(await readFile(path, "utf8")) as {cards: unknown[]};
  expect(backup.cards).toHaveLength(1);
  expect(backup.cards[0]).toMatchObject({direction: "recognition", audioReferences: [], tags: ["backup"]});

  await page.getByText(/All local cards/u).click();
  page.once("dialog", (dialog) => void dialog.accept());
  await page.getByRole("button", {name: "Delete all local cards"}).click();
  await expect(page.getByText(/Save a word or sentence/u)).toBeVisible();
  await page.locator('input[type="file"][accept*="json"]').setInputFiles({
    name: "kakarayan-study.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(backup)),
  });
  await expect(page.getByRole("heading", {name: "practice front"})).toBeVisible();

  const original = backup.cards[0];
  if (!original || typeof original !== "object") throw new Error("Missing backup card");
  const replacement = {...original, front: "restored prompt"};
  const added = {...original, id: "second-card", front: "second prompt"};
  await page.evaluate(() => {
    const put = IDBObjectStore.prototype.put;
    let calls = 0;
    IDBObjectStore.prototype.put = function (value: unknown, key?: IDBValidKey) {
      calls += 1;
      if (calls === 2) {
        IDBObjectStore.prototype.put = put;
        throw new DOMException("Injected full storage", "QuotaExceededError");
      }
      return put.call(this, value, key);
    };
  });
  const twoCards = {...backup, cards: [replacement, added]};
  const file = {name: "two-cards.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(twoCards))};
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  await expect(page.locator(".study-deck .callout--error")).toContainText("Injected full storage");
  await page.reload();
  await expect(page.getByRole("heading", {name: "practice front"})).toBeVisible();
  await expect(page.locator(".deck-toolbar")).toContainText("1 cards");
  await page.locator('input[type="file"][accept*="json"]').setInputFiles(file);
  await expect(page.locator(".deck-toolbar")).toContainText("2 cards");
  const updatedDownload = page.waitForEvent("download");
  await page.getByRole("button", {name: "Export backup"}).click();
  const updatedPath = await (await updatedDownload).path();
  if (!updatedPath) throw new Error("Missing restored backup");
  expect(JSON.parse(await readFile(updatedPath, "utf8")).cards).toEqual(expect.arrayContaining([replacement, added]));
});

test("microphone denial is recoverable and local audio can be deleted", async ({
  page,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Media behavior is exercised once");
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: () =>
          Promise.reject(new DOMException("Permission denied", "NotAllowedError")),
      },
    });
  });
  await page.goto("learn");
  await page.getByRole("tab", {name: /Pronunciation/u}).click();
  const panel = page.getByRole("tabpanel");
  await panel.getByRole("button", {name: "Start recording"}).click();
  await expect(panel.getByText("Microphone permission was denied.")).toBeVisible();
  await panel.locator('input[type="file"][accept="audio/*"]').setInputFiles({
    name: "local-practice.webm",
    mimeType: "audio/webm",
    buffer: Buffer.from("synthetic local audio"),
  });
  await expect(panel.locator("audio")).toBeVisible();
  await panel.getByRole("button", {name: "Delete", exact: true}).click();
  await expect(panel.locator("audio")).toHaveCount(0);
});

test("the shell and local cards remain available offline", {tag: "@production-smoke"}, async ({
  page,
  context,
}, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Offline behavior is exercised once");
  await page.goto("learn");
  await seedCard(page);
  await page.getByRole("tab", {name: /Study deck/u}).click();
  await page.evaluate(async () => navigator.serviceWorker.ready);
  await page.reload();
  await expect.poll(() => page.evaluate(() => Boolean(navigator.serviceWorker.controller))).toBe(true);

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByRole("heading", {level: 1})).toBeVisible();
  await page.getByRole("tab", {name: /Study deck/u}).click();
  await expect(page.getByRole("heading", {name: "practice front"})).toBeVisible();
});
