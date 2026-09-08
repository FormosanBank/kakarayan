import {afterEach, vi} from "vitest";
import {act, createElement} from "react";
import {createRoot} from "react-dom/client";

import {loadAppData, loadOptionalCatalog, useAppData} from "./data";
import {appFixture} from "./test/fixtures";

const releaseId = "fb-20240102-3b367525";

function envelope(endpoint: string, data: unknown, release = releaseId) {
  return {
    schema_version: "1.0.0",
    api_version: "v1",
    read_model_version: 2,
    endpoint,
    release_id: release,
    generated_at: "2024-01-02T03:04:05Z",
    kakarayan: {repository: "FormosanBank/kakarayan", version: "0.2.0", commit: "a".repeat(40)},
    source: {repository: "FormosanBank/FormosanBank", commit: "b".repeat(40)},
    canonical_url: `https://formosanbank.github.io/kakarayan/api/v1/${endpoint}.json`,
    data,
  };
}

const endpointData: Record<string, unknown> = {
  meta: {current_release: releaseId},
  languages: [],
  corpora: [],
  rights: appFixture().rights,
  models: {schema_version: "1.0.0", generated_at: "2024-01-02T03:04:05Z", provider: "Hugging Face", models: [], services: []},
  orthography: {schema_version: "1.0.0", source_commit: "b".repeat(40), tables: []},
  content: {schema_version: "1.0.0", entries: []},
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("loads navigation without waiting for optional resources or readiness", async () => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/readyz")) return new Response("unavailable", {status: 503});
    const endpoint = /\/([^/]+)\.json$/u.exec(url)?.[1] ?? "";
    return Response.json(envelope(endpoint, endpointData[endpoint]));
  });
  vi.stubGlobal("fetch", fetchMock);
  const data = await loadAppData();
  expect(data.meta.release_id).toBe(releaseId);
  expect(data.query.available).toBe(false);
  expect(data.resources.models.status).toBe("loading");
  expect(fetchMock).toHaveBeenCalledTimes(4);
});

it("times out an unresponsive optional catalogue", async () => {
  vi.stubGlobal("fetch", vi.fn(() => new Promise<Response>(() => undefined)));
  await expect(loadOptionalCatalog("models", appFixture().meta, undefined, 1))
    .rejects.toThrow("did not respond in time");
});

it.each(["models", "orthography", "content"] as const)("keeps %s failures local to that catalogue", async (resource) => {
  const identity = {...appFixture().meta, release_id: releaseId};
  vi.stubGlobal("fetch", vi.fn(async () => new Response("missing", {status: 404})));
  await expect(loadOptionalCatalog(resource, identity)).rejects.toThrow("404");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json(envelope(resource, endpointData[resource]))));
  await expect(loadOptionalCatalog(resource, identity)).resolves.toEqual(endpointData[resource]);
});

it("rejects a mixed static release before querying the backend", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    const endpoint = /\/([^/]+)\.json$/u.exec(url)?.[1] ?? "";
    return Response.json(
      envelope(endpoint, endpointData[endpoint], endpoint === "corpora" ? "fb-20240102-deadbeef" : releaseId),
    );
  }));
  await expect(loadAppData()).rejects.toThrow("Static metadata release mismatch: corpora");
});

it("validates nested catalogue members and their endpoint, not only the envelope", async () => {
  for (const invalid of [envelope("languages", [{id: "lang_amis"}]), envelope("corpora", [])]) {
    vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
      const endpoint = /\/([^/]+)\.json$/u.exec(String(input))?.[1] ?? "";
      return Response.json(endpoint === "languages" ? invalid : envelope(endpoint, endpointData[endpoint]));
    }));
    await expect(loadAppData()).rejects.toThrow("Invalid static API envelope");
  }
});

it("recovers optional resources and readiness without unmounting local work", async () => {
  vi.useFakeTimers();
  let failed = true;
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/readyz")) return Response.json({status: "ready", read_model_version: 2, release_id: failed ? "other-release" : releaseId});
    const endpoint = /\/([^/]+)\.json$/u.exec(url)?.[1] ?? "";
    if (endpoint === "models" && failed) return new Response("unavailable", {status: 503});
    return Response.json(envelope(endpoint, endpointData[endpoint]));
  }));
  let state: ReturnType<typeof useAppData> | undefined;
  function Probe() {
    state = useAppData();
    return state.data ? createElement("input", {defaultValue: ""}) : null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  try {
    await act(async () => root.render(createElement(Probe)));
    expect(state?.loading).toBe(false);
    expect(state?.error).toBeNull();
    expect(state?.data?.query.error).toContain("Release mismatch:");
    expect(state?.data?.resources.models.status).toBe("error");
    expect(state?.data?.resources.orthography.status).toBe("ready");
    const input = container.querySelector("input");
    if (!input) throw new Error("Local tool was not rendered");
    input.value = "unfinished work";
    failed = false;
    await act(async () => state?.retryResource("models"));
    await act(async () => vi.advanceTimersByTimeAsync(16_000));
    expect(state?.data?.query.available).toBe(true);
    expect(state?.data?.resources.models.status).toBe("ready");
    expect(container.querySelector("input")?.value).toBe("unfinished work");
  } finally {
    await act(async () => root.unmount());
  }
});
