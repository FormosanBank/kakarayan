const gradio = vi.hoisted(() => ({
  connect: vi.fn(),
  handleFile: vi.fn((value: Blob) => value),
}));

vi.mock("@gradio/client", () => ({
  Client: {connect: gradio.connect},
  handle_file: gradio.handleFile,
}));

import {
  closeModelServiceConnections,
  forgetModelRunHistory,
  transcribe,
  translate,
  type ServiceStage,
} from "./modelServices";

interface Event {
  type: "data" | "status";
  data?: unknown[];
  stage?: "pending" | "error" | "complete" | "generating" | "streaming";
  position?: number;
  message?: string;
}

function service(events: Event[]) {
  const cancel = vi.fn(async () => undefined);
  const close = vi.fn();
  const submit = vi.fn(() => ({
    cancel,
    async *[Symbol.asyncIterator]() {
      for (const event of events) yield event;
    },
  }));
  return {client: {close, submit}, cancel, close, submit};
}

function options(controller = new AbortController(), timeoutMs = 1_000) {
  const stages: Array<[ServiceStage, string | undefined]> = [];
  return {
    stages,
    value: {
      signal: controller.signal,
      timeoutMs,
      onStage: (stage: ServiceStage, message?: string) => stages.push([stage, message]),
    },
  };
}

const request = {
  text: "five",
  direction: "English → Formosan" as const,
  language: "Amis",
  dialect: "Coastal",
};
const translationService = {
  space: "FormosanBank/formosan-mt",
  endpoint: "/translate",
};
const asrService = {
  space: "FormosanBank/formosan_asr",
  endpoint: "/transcribe",
};

describe("public model adapters", () => {
  beforeEach(() => {
    closeModelServiceConnections();
    gradio.connect.mockReset();
    gradio.handleFile.mockClear();
  });

  it("keeps only the translation, not the service's own attribution", async () => {
    const mock = service([
      {type: "status", stage: "pending", position: 1},
      {type: "status", stage: "generating"},
      {type: "data", data: ["lima", "reviewed by FormosanBank staff · CC0"]},
    ]);
    gradio.connect.mockResolvedValue(mock.client);
    const run = options();

    await expect(translate(request, translationService, run.value)).resolves.toEqual({
      text: "lima",
    });
    expect(run.stages.map(([stage]) => stage)).toEqual([
      "connecting",
      "pending",
      "generating",
      "complete",
    ]);
    expect(mock.submit).toHaveBeenCalledWith(
      "/translate",
      expect.objectContaining({text: "five", formosan_language: "Amis"}),
    );
    expect(gradio.connect).toHaveBeenCalledWith(
      translationService.space,
      expect.any(Object),
    );
    expect(mock.close).not.toHaveBeenCalled();
  });

  it("reuses one provider connection across sequential translations", async () => {
    const mock = service([{type: "data", data: ["lima", ""]}]);
    gradio.connect.mockResolvedValue(mock.client);

    await translate(request, translationService, options().value);
    await translate({...request, text: "good"}, translationService, options().value);

    expect(gradio.connect).toHaveBeenCalledTimes(1);
    expect(mock.submit).toHaveBeenCalledTimes(2);
  });

  it("reports a cold-start status from the provider connection", async () => {
    const mock = service([{type: "data", data: ["lima", ""]}]);
    gradio.connect.mockImplementation(
      async (
        _space: string,
        value: {status_callback: (status: {status: string}) => void},
      ) => {
        value.status_callback({status: "sleeping"});
        return mock.client;
      },
    );
    const run = options();

    await translate(request, translationService, run.value);
    expect(run.stages).toContainEqual([
      "connecting",
      "The public Space is waking up. This can take a few minutes.",
    ]);
  });

  it("cancels an in-flight provider job", async () => {
    const cancel = vi.fn(async () => undefined);
    const close = vi.fn();
    const submit = vi.fn(() => ({
      cancel,
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Event>>(() => undefined),
        };
      },
    }));
    gradio.connect.mockResolvedValue({close, submit});
    const controller = new AbortController();
    const run = options(controller);
    const result = translate(request, translationService, run.value);
    await vi.waitFor(() => expect(submit).toHaveBeenCalled());
    controller.abort();

    await expect(result).rejects.toMatchObject({name: "AbortError"});
    expect(cancel).toHaveBeenCalled();
    expect(close).not.toHaveBeenCalled();
  });

  it("times out an unresponsive provider job", async () => {
    const cancel = vi.fn(async () => undefined);
    const submit = vi.fn(() => ({
      cancel,
      [Symbol.asyncIterator]() {
        return {
          next: () => new Promise<IteratorResult<Event>>(() => undefined),
        };
      },
    }));
    gradio.connect.mockResolvedValue({close: vi.fn(), submit});
    const run = options(new AbortController(), 10);

    await expect(translate(request, translationService, run.value)).rejects.toMatchObject({
      name: "TimeoutError",
    });
    expect(cancel).toHaveBeenCalled();
  });

  it("rejects malformed model output and provider outages", async () => {
    const mock = service([{type: "data", data: [{translation: "lima"}]}]);
    gradio.connect.mockResolvedValueOnce(mock.client);
    await expect(translate(request, translationService, options().value)).rejects.toThrow(
      "malformed response",
    );

    closeModelServiceConnections();
    gradio.connect.mockRejectedValueOnce(new Error("provider unavailable"));
    await expect(translate(request, translationService, options().value)).rejects.toThrow(
      "provider unavailable",
    );
  });

  it("sends model services only the consented input", async () => {
    window.history.replaceState(null, "", "/learn?tool=practice&q=private%20search&evil=1#top");
    let submittedSearch = "unset";
    const mock = service([{type: "data", data: ["fangcalay"]}]);
    mock.submit.mockImplementation(() => {
      submittedSearch = window.location.search;
      return {cancel: vi.fn(), async *[Symbol.asyncIterator]() { yield {type: "data", data: ["fangcalay"]}; }};
    });
    gradio.connect.mockResolvedValue(mock.client);
    const audio = new File(["audio"], "my private note.wav", {type: "audio/wav"});

    await transcribe("Amis", audio, asrService, options().value);
    expect(gradio.connect).toHaveBeenCalledWith(asrService.space, expect.objectContaining({record_history: false}));
    expect(submittedSearch).toBe("");
    expect(`${window.location.pathname}${window.location.search}${window.location.hash}`)
      .toBe("/learn?tool=practice&q=private%20search&evil=1#top");
    const uploaded = gradio.handleFile.mock.calls.at(-1)?.[0];
    expect(uploaded).not.toBeInstanceOf(File);
    expect(uploaded?.type).toBe("audio/wav");
    window.history.replaceState(null, "", "/");
  });

  it("forgets run records earlier versions let the client keep", () => {
    localStorage.setItem("gradio:run-history:v2:asr-app-1", "[{\"inputs\":[\"private\"]}]");
    localStorage.setItem("gradio:run-history:replay:v2:x", "[]");
    localStorage.setItem("kakarayan-locale", "en");
    forgetModelRunHistory();
    expect(Object.keys(localStorage)).toEqual(["kakarayan-locale"]);
    localStorage.clear();
  });

  it("maps ASR output and refuses oversized audio before upload", async () => {
    const mock = service([{type: "data", data: ["fangcalay", "asr metadata"]}]);
    gradio.connect.mockResolvedValue(mock.client);
    const audio = new Blob(["audio"], {type: "audio/webm"});

    await expect(transcribe("Amis", audio, asrService, options().value)).resolves.toEqual({
      text: "fangcalay",
    });
    expect(gradio.handleFile).toHaveBeenCalledWith(expect.any(Blob));
    expect(mock.submit).toHaveBeenCalledWith(
      "/transcribe",
      expect.objectContaining({language_name: "Amis"}),
    );

    const oversized = new Blob([new Uint8Array(25 * 1024 * 1024 + 1)]);
    await expect(
      transcribe("Amis", oversized, asrService, options().value),
    ).rejects.toThrow(
      "25 MiB or smaller",
    );
  });
});
