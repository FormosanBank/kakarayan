import {afterEach, vi} from "vitest";

import {loadAppData} from "./data";

const releaseId = "fb-20240102-3b367525";

function envelope(endpoint: string, data: unknown, release = releaseId) {
  return {
    schema_version: "1.0.0",
    api_version: "v1",
    endpoint,
    release_id: release,
    generated_at: "2024-01-02T03:04:05Z",
    kakarayan: {repository: "FormosanBank/kakarayan", version: "0.2.0", commit: "a".repeat(40)},
    source: {repository: "FormosanBank/FormosanBank", commit: "b".repeat(40)},
    canonical_url: `https://example.test/${endpoint}.json`,
    data,
  };
}

const endpointData: Record<string, unknown> = {
  meta: {current_release: releaseId},
  languages: [],
  corpora: [],
  rights: {schema_version: "1.0.0", central_terms: {}, entries: []},
  models: {schema_version: "1.0.0", generated_at: "2024-01-02T03:04:05Z", provider: "Hugging Face", models: [], services: []},
  orthography: {schema_version: "1.0.0", source_commit: "b".repeat(40), tables: []},
  content: {schema_version: "1.0.0", entries: []},
};

afterEach(() => vi.unstubAllGlobals());

it("keeps static tools available when the query service is unavailable", async () => {
  vi.stubGlobal("fetch", vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.endsWith("/readyz")) return new Response("unavailable", {status: 503});
    const endpoint = /\/([^/]+)\.json$/u.exec(url)?.[1] ?? "";
    return Response.json(envelope(endpoint, endpointData[endpoint]));
  }));
  const data = await loadAppData();
  expect(data.meta.release_id).toBe(releaseId);
  expect(data.query.available).toBe(false);
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
