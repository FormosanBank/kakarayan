import assert from "node:assert/strict";
import test from "node:test";

import {KakarayanClient, KakarayanError} from "./index.js";

function json(value: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(value), {
    headers: {"Content-Type": "application/json", ...headers},
  });
}

test("reads static catalogues and pins the release", async () => {
  const calls: string[] = [];
  const client = new KakarayanClient({
    baseUrl: "https://example.test/kakarayan",
    releaseId: "release-1",
    fetch: async (input) => {
      const url = String(input);
      calls.push(url);
      if (url.endsWith("meta.json")) return json({release_id: "release-1"});
      return json([{id: "lang_amis"}]);
    },
  });
  assert.deepEqual(await client.getLanguages(), [{id: "lang_amis"}]);
  assert.equal(calls.length, 2);
});

test("iterates live cursor pages", async () => {
  const client = new KakarayanClient({
    baseUrl: "https://api.example.test",
    mode: "live",
    fetch: async (input) => {
      const url = new URL(String(input));
      const cursor = url.searchParams.get("cursor");
      return json({
        items: [{form: cursor ? "waco" : "lima"}],
        next_cursor: cursor ? null : "next",
      });
    },
  });
  const forms: unknown[] = [];
  for await (const item of client.pages((cursor) =>
    client.frequencies({language_id: "lang_amis", cursor}),
  )) {
    forms.push(item);
  }
  assert.deepEqual(forms, [{form: "lima"}, {form: "waco"}]);
});

test("rejects release mismatches", async () => {
  const client = new KakarayanClient({
    baseUrl: "https://example.test",
    releaseId: "release-1",
    fetch: async () => json({release_id: "release-2"}),
  });
  await assert.rejects(client.getMeta(), (error: unknown) => {
    return error instanceof KakarayanError && error.code === "release_mismatch";
  });
});
