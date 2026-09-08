import {createHash} from "node:crypto";
import {readFileSync} from "node:fs";
import {createServer} from "node:http";
import {expect, test} from "@playwright/test";

test("offline updates retain a complete generation until the user accepts", async ({page, context}) => {
  let generation = "one";
  let corrupt = false;
  let optionalDown = false;
  const template = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  const server = createServer((request, response) => {
    const files: Record<string, string> = {
      "./": `<html><body><main>${generation}</main></body></html>`,
      "meta.json": JSON.stringify({release: generation}),
      "models.json": JSON.stringify({models: generation}),
    };
    response.setHeader("Cache-Control", "no-store");
    const path = request.url?.split("?")[0]?.replace(/^\/kakarayan\//u, "") || "./";
    if (path === "sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      const entries = Object.entries(files).map(([name, content]) => ({
        path: name, required: name !== "models.json", bytes: Buffer.byteLength(content),
        sha256: createHash("sha256").update(content).digest("hex"),
      }));
      response.end(template.replace("__KAKARAYAN_SHELL__", JSON.stringify({generation, entries})));
    } else if (path === "meta.json" && corrupt) response.end("incomplete publication");
    else if (path === "models.json" && optionalDown) { response.statusCode = 503; response.end("unavailable"); }
    else { response.setHeader("Content-Type", path.endsWith(".json") ? "application/json" : "text/html"); response.end(files[path] ?? files["./"]); }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start");
  const base = `http://127.0.0.1:${address.port}/kakarayan/`;
  const readRelease = () => page.evaluate(async () => (await (await fetch("meta.json")).json()).release);
  const askUpdate = () => page.evaluate(async () => {
    const registration = await navigator.serviceWorker.getRegistration();
    if (!registration?.waiting) throw new Error("No waiting update");
    return new Promise((resolve) => {
      const channel = new MessageChannel();
      channel.port1.onmessage = (event) => { channel.port1.close(); resolve(event.data.status); };
      registration.waiting?.postMessage({type: "ACTIVATE"}, [channel.port2]);
    });
  });
  try {
    await page.goto(base);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.reload();
    expect(await readRelease()).toBe("one");
    generation = "two";
    corrupt = true;
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      await registration?.update();
    });
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.installing?.state ?? "none")).toBe("none");
    expect(await page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting === null)).toBe(true);
    expect(await readRelease()).toBe("one");
    expect(await page.evaluate(() => caches.keys())).not.toContain("kakarayan-shell-two");

    corrupt = false;
    optionalDown = true;
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    expect(await readRelease()).toBe("one");
    const other = await context.newPage();
    await other.goto(base);
    expect(await askUpdate()).toBe("other_tabs");
    await other.close();
    expect(await askUpdate()).toBe("activating");
    await expect.poll(() => page.evaluate(async () => (await navigator.serviceWorker.getRegistration())?.waiting === null)).toBe(true);
    await page.reload();
    await expect(page.locator("main")).toHaveText("two");
    expect(await readRelease()).toBe("two");
    expect(await page.evaluate(async () => (await fetch("models.json")).status)).toBe(503);
    optionalDown = false;
    expect(await page.evaluate(async () => (await (await fetch("models.json")).json()).models)).toBe("two");
    await context.setOffline(true);
    for (const path of ["learn?q=one", "research?q=two", "lookup?q=three"]) {
      await page.goto(base + path);
      await expect(page.locator("main")).toHaveText("two");
    }
    expect(await page.evaluate(async () => (await (await caches.open("kakarayan-shell-two")).keys()).length)).toBe(3);
    expect((await page.evaluate(() => caches.keys())).sort()).toEqual(["kakarayan-shell-one", "kakarayan-shell-two"]);
  } finally {
    await context.setOffline(false);
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});
