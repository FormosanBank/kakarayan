import {expect, test, type Page} from "@playwright/test";
import {writeFile} from "node:fs/promises";
import {resolve} from "node:path";

const enabled = process.env.KAKARAYAN_PERFORMANCE === "1";
const latencyMs = 80;
const downloadBytesPerSecond = 192 * 1024;
const uploadBytesPerSecond = 96 * 1024;
const cpuThrottle = 4;
const sampleCount = 12;

function percentile(values: number[], percentileValue: number) {
  const ordered = [...values].sort((left, right) => left - right);
  return ordered[Math.max(0, Math.ceil(percentileValue * ordered.length) - 1)];
}

async function selectAmis(page: Page) {
  await page.getByRole("combobox", {name: "Formosan language"}).selectOption({label: "Amis"});
}

test("a constrained Taiwan-like mobile lookup meets the interaction budget", async ({
  page,
}, testInfo) => {
  test.skip(!enabled, "Set KAKARAYAN_PERFORMANCE=1 for the full-release performance run");
  test.skip(testInfo.project.name !== "mobile-chromium", "The constrained profile runs in Chromium");

  const session = await page.context().newCDPSession(page);
  await session.send("Network.enable");
  await session.send("Network.setCacheDisabled", {cacheDisabled: true});
  await session.send("Network.emulateNetworkConditions", {
    offline: false,
    latency: latencyMs,
    downloadThroughput: downloadBytesPerSecond,
    uploadThroughput: uploadBytesPerSecond,
    connectionType: "cellular3g",
  });
  await session.send("Emulation.setCPUThrottlingRate", {rate: cpuThrottle});

  const shellStarted = performance.now();
  await page.goto("lookup?type=sentences");
  await expect(page.getByRole("heading", {level: 1})).toBeVisible();
  await selectAmis(page);
  const shellMs = performance.now() - shellStarted;

  await page.getByLabel("Word or phrase").fill("fangcalay");
  const submit = page.locator(".search-form").getByRole("button").first();
  const timings: number[] = [];
  for (let sample = 0; sample < sampleCount; sample += 1) {
    const response = page.waitForResponse(
      (candidate) => candidate.url().includes("/concordance?") && candidate.ok(),
    );
    const started = performance.now();
    await submit.click();
    await response;
    await expect(submit).toBeEnabled();
    await expect(page.locator(".result-card--summary").first()).toBeVisible();
    timings.push(performance.now() - started);
  }

  const report = {
    schema_version: "1.0.0",
    measured_at: new Date().toISOString(),
    release_id: await page.locator(".release-pill").textContent(),
    profile: {
      device: "Playwright Pixel 7",
      latency_ms: latencyMs,
      download_mbps: 1.5,
      upload_mbps: 0.75,
      cpu_throttle: cpuThrottle,
      browser_cache_disabled: true,
    },
    shell_ms: Number(shellMs.toFixed(3)),
    lookup: {
      query: "fangcalay",
      samples: sampleCount,
      p50_ms: Number(percentile(timings, 0.5).toFixed(3)),
      p95_ms: Number(percentile(timings, 0.95).toFixed(3)),
      maximum_ms: Number(Math.max(...timings).toFixed(3)),
      values_ms: timings.map((value) => Number(value.toFixed(3))),
    },
  };
  const encoded = `${JSON.stringify(report, null, 2)}\n`;
  await testInfo.attach("taiwan-mobile-performance.json", {
    body: encoded,
    contentType: "application/json",
  });
  if (process.env.KAKARAYAN_PERFORMANCE_REPORT) {
    await writeFile(resolve(process.env.KAKARAYAN_PERFORMANCE_REPORT), encoded, "utf8");
  }

  expect(report.lookup.p95_ms).toBeLessThan(300);
});
