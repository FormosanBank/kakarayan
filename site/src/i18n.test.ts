import {describe, expect, it} from "vitest";

import {messages} from "./i18nMessages";

describe("interface catalogues", () => {
  it("keeps English and Traditional Chinese keys in parity", () => {
    expect(Object.keys(messages["zh-Hant"]).sort()).toEqual(Object.keys(messages.en).sort());
  });

  it("does not leave blank interface messages", () => {
    for (const catalogue of Object.values(messages)) {
      expect(Object.values(catalogue).every((message) => message.trim().length > 0)).toBe(true);
    }
  });
});
