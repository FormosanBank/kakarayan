import {wordError} from "../recorderMetrics";

describe("ASR hypothesis comparison", () => {
  it("computes deterministic Unicode word error counts", () => {
    expect(wordError("Lima waco", "lima wacu")).toEqual({
      edits: 1,
      referenceWords: 2,
      hypothesisWords: 2,
      rate: 0.5,
    });
    expect(wordError("fangcalay", "fangcalay")).toEqual({
      edits: 0,
      referenceWords: 1,
      hypothesisWords: 1,
      rate: 0,
    });
  });
});
