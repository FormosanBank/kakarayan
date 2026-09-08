import {afterEach, describe, expect, it, vi} from "vitest";

import {
  API_INTERACTIVE_TIMEOUT_MS,
  dictionary,
  preflightExport,
} from "./apiClient";
import type {ApiRequestError} from "./apiClient";

const options = {
  q: "mother",
  languageId: "lang_amis",
  direction: "translation" as const,
  translationLanguage: "eng",
  match: "exact" as const,
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("API request lifecycle", () => {
  it("reports invalid JSON as an actionable response error", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("<html>proxy</html>")));
    await expect(dictionary("fb-test", options)).rejects.toMatchObject({code: "invalid_response", status: 502});
  });
  it.each([
    {release_id: "fb-test", items: [{}], next_cursor: null},
    {release_id: "fb-test", items: "broken", next_cursor: null},
    {release_id: "fb-test", items: [], next_cursor: 0},
  ])("rejects malformed successful responses", async (payload) => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(payload)));
    await expect(dictionary("fb-test", options)).rejects.toMatchObject({code: "invalid_response", status: 502});
  });
  it("rejects responses from another release", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({release_id: "other", items: [], next_cursor: null})));
    await expect(dictionary("fb-test", options)).rejects.toMatchObject({code: "release_mismatch"});
  });
  it.each([429, 503, 504, 403])("leaves export preflight failures actionable (%s)", async (status) => {
    const mock = vi.fn().mockResolvedValue(Response.json({error: {code: "blocked", message: "Try again"}}, {status}));
    vi.stubGlobal("fetch", mock);
    await expect(preflightExport("fb-test", "export", new URLSearchParams({language_id: "lang_amis"})))
      .rejects.toMatchObject({status, code: "blocked"});
    expect(mock).toHaveBeenCalledTimes(1);
    expect(mock.mock.calls[0]?.[0]).toContain("preflight=true");
  });
  it("retries one momentary busy response", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json(
        {error: {code: "server_busy", message: "busy"}},
        {status: 503, headers: {"Retry-After": "0"}},
      ))
      .mockResolvedValueOnce(Response.json({
        release_id: "fb-test",
        items: [],
        next_cursor: null,
      }));
    vi.stubGlobal("fetch", fetchMock);

    const result = dictionary("fb-test", options);
    await vi.advanceTimersByTimeAsync(100);

    await expect(result).resolves.toMatchObject({release_id: "fb-test", items: []});
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({cache: "no-store"}),
    );
  });

  it("stops an unresponsive lookup after the interactive budget", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), {once: true});
      })));

    const result = dictionary("fb-test", options);
    const rejection = expect(result).rejects.toMatchObject({
      code: "client_timeout",
      status: 0,
    } satisfies Partial<ApiRequestError>);
    await vi.advanceTimersByTimeAsync(API_INTERACTIVE_TIMEOUT_MS);

    await rejection;
  });

  it("preserves an explicit user cancellation", async () => {
    const caller = new AbortController();
    vi.stubGlobal("fetch", vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        const signal = init?.signal;
        signal?.addEventListener("abort", () => reject(signal.reason), {once: true});
      })));

    const result = dictionary("fb-test", options, caller.signal);
    caller.abort();

    await expect(result).rejects.toMatchObject({name: "AbortError"});
  });
});
