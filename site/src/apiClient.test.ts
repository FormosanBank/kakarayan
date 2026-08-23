import {afterEach, describe, expect, it, vi} from "vitest";

import {
  API_INTERACTIVE_TIMEOUT_MS,
  dictionary,
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
