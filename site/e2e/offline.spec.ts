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
  const stopServer = async () => {
    if (!server.listening) return;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  };
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
      await caches.open("kakarayan-fb-20240102-1234567");
      await caches.open("unrelated-application");
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
    // Stop the origin itself so all browsers exercise real network failure,
    // including WebKit where emulated offline mode rejects worker fetches too.
    await stopServer();
    expect(await readRelease()).toBe("two");
    for (const path of ["learn?q=one", "research?q=two", "lookup?q=three"]) {
      await page.goto(base + path);
      await expect(page.locator("main")).toHaveText("two");
    }
    expect(await page.evaluate(async () => (await (await caches.open("kakarayan-shell-two")).keys()).length)).toBe(3);
    expect((await page.evaluate(() => caches.keys())).sort()).toEqual([
      "kakarayan-shell-one", "kakarayan-shell-two", "unrelated-application",
    ]);
  } finally {
    await stopServer();
  }
});

test("the installed shell verifies cache hits and aliases, and frames cannot block updates", async ({page, context}) => {
  let generation = "one";
  const template = readFileSync(new URL("../service-worker.js", import.meta.url), "utf8");
  const files = () => ({
    "./": `<html><body><main>${generation}</main></body></html>`,
    "meta.json": JSON.stringify({release: generation}),
    "assets/app.js": `export const generation = "${generation}";`,
  });
  const server = createServer((request, response) => {
    response.setHeader("Cache-Control", "no-store");
    const raw = request.url?.split("?")[0] ?? "/";
    if (raw === "/frame.html") {
      response.setHeader("Content-Type", "text/html");
      response.end(`<iframe src="http://127.0.0.1:${port}/kakarayan/learn"></iframe>`);
      return;
    }
    // The host answers aliases too; their bytes must never reach the page.
    if (/\/\/|%2f/iu.test(raw.slice(1))) { response.end("TAMPERED"); return; }
    const path = raw.replace(/^\/kakarayan\//u, "") || "./";
    const current: Record<string, string> = files();
    if (path === "sw.js") {
      response.setHeader("Content-Type", "text/javascript");
      const entries = Object.entries(current).map(([name, content]) => ({
        path: name, required: true, bytes: Buffer.byteLength(content),
        sha256: createHash("sha256").update(content).digest("hex"),
      }));
      response.end(template.replace("__KAKARAYAN_SHELL__", JSON.stringify({generation, entries})));
      return;
    }
    response.setHeader("Content-Type", path.endsWith(".js") ? "text/javascript" : path.endsWith(".json") ? "application/json" : "text/html");
    response.end(current[path] ?? current["./"]);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Fixture server did not start");
  const port = address.port;
  const base = `http://127.0.0.1:${port}/kakarayan/`;
  const read = (path: string) => page.evaluate(async (url) => {
    const response = await fetch(new URL(url, location.origin));
    return `${response.status} ${await response.text()}`;
  }, path);
  try {
    await page.goto(base);
    await page.evaluate(async () => {
      await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;
    });
    await page.reload();

    const meta = '200 {"release":"one"}';
    expect(await read("/kakarayan//meta.json")).toBe(meta);
    expect(await read("/kakarayan/%2fmeta.json")).toBe(meta);
    expect(await read("/kakarayan//assets/app.js")).toBe('200 export const generation = "one";');
    expect((await read("/kakarayan//assets/other.js")).startsWith("404")).toBe(true);
    expect((await read("/kakarayan/assets/other.js")).startsWith("404")).toBe(true);

    await page.evaluate(async () => {
      const cache = await caches.open("kakarayan-shell-one");
      await cache.put(new URL("meta.json", location.href), new Response("{\"release\":\"poisoned\"}"));
    });
    expect(await read("/kakarayan/meta.json")).toBe(meta);
    expect(await page.evaluate(async () => (await (await caches.open("kakarayan-shell-one")).match(new URL("meta.json", location.href)))?.text())).toBe('{"release":"one"}');

    generation = "two";
    await page.evaluate(async () => { await (await navigator.serviceWorker.getRegistration())?.update(); });
    await expect.poll(() => page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting))).toBe(true);
    const embedder = await context.newPage();
    await embedder.goto(`http://localhost:${port}/frame.html`);
    await expect.poll(() => embedder.frames().length).toBe(2);
    const status = await page.evaluate(async () => {
      const waiting = (await navigator.serviceWorker.getRegistration())?.waiting;
      return new Promise((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => { channel.port1.close(); resolve(event.data.status); };
        waiting?.postMessage({type: "ACTIVATE"}, [channel.port2]);
      });
    });
    expect(status).toBe("activating");
    await embedder.close();
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});
