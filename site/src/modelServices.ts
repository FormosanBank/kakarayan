type GradioEvent =
  | {type: "data"; data: unknown[]}
  | {
      type: "status";
      stage: "pending" | "error" | "complete" | "generating" | "streaming";
      position?: number;
      message?: string | unknown[];
    }
  | {type: "log"}
  | {type: "render"};

export type ServiceStage =
  | "connecting"
  | "pending"
  | "generating"
  | "complete"
  | "cancelled"
  | "error";

export interface RunOptions {
  signal: AbortSignal;
  onStage: (stage: ServiceStage, message?: string) => void;
  timeoutMs?: number;
}

export interface BrowserModelService {
  space: string;
  endpoint: string;
}

async function runGradio(
  space: string,
  endpoint: string,
  payload: Record<string, unknown>,
  {signal, onStage, timeoutMs = 180_000}: RunOptions,
): Promise<unknown[]> {
  if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  onStage("connecting", "Connecting to the public Hugging Face Space…");
  const {Client} = await import("@gradio/client");
  type ClientInstance = Awaited<ReturnType<typeof Client.connect>>;
  type Job = ReturnType<ClientInstance["submit"]>;
  let client: ClientInstance | null = null;
  let job: Job | null = null;
  let interrupted: DOMException | null = null;
  let rejectInterruption: ((reason: DOMException) => void) | null = null;

  const interrupt = (reason: DOMException) => {
    if (interrupted) return;
    interrupted = reason;
    if (job) void job.cancel();
    client?.close();
    rejectInterruption?.(reason);
  };
  const abort = () => interrupt(new DOMException("Request cancelled", "AbortError"));
  signal.addEventListener("abort", abort, {once: true});
  const timer = window.setTimeout(
    () =>
      interrupt(
        new DOMException(
          "The public model did not respond before the request timeout",
          "TimeoutError",
        ),
      ),
    timeoutMs,
  );
  const interruption = new Promise<never>((_, reject) => {
    rejectInterruption = reject;
    if (interrupted) reject(interrupted);
  });

  const connection = Client.connect(space, {
    events: ["data", "status"],
    status_callback: (status) => {
      if (status.status === "sleeping" || status.status === "starting") {
        onStage("connecting", "The public Space is waking up. This can take a few minutes.");
      }
    },
  });
  void connection.then(
    (connected) => {
      if (interrupted) connected.close();
    },
    () => undefined,
  );
  let result: unknown[] | null = null;
  try {
    client = await Promise.race([connection, interruption]);
    job = client.submit(endpoint, payload);
    const consume = async () => {
      for await (const event of job as AsyncIterable<GradioEvent>) {
        if (event.type === "data") result = event.data;
        if (event.type === "status") {
          if (event.stage === "pending") {
            const detail =
              typeof event.position === "number"
                ? `Queue position ${event.position + 1}`
                : undefined;
            onStage("pending", detail);
          } else if (event.stage === "generating" || event.stage === "streaming") {
            onStage("generating", "The model is working…");
          } else if (event.stage === "error") {
            throw new Error(
              typeof event.message === "string"
                ? event.message
                : "The public model returned an error",
            );
          }
        }
      }
    };
    await Promise.race([consume(), interruption]);
    if (!result) throw new Error("The public model returned no result");
    onStage("complete");
    return result;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
    client?.close();
  }
}

function modelText(data: unknown[], task: string): {text: string; metadata: string} {
  if (typeof data[0] !== "string" || !data[0].trim()) {
    throw new Error(`The public ${task} model returned a malformed response`);
  }
  return {
    text: data[0],
    metadata: typeof data[1] === "string" ? data[1] : "",
  };
}

export interface TranslationRequest {
  text: string;
  direction: "Formosan → English" | "English → Formosan" | "Formosan → Chinese" | "Chinese → Formosan";
  language: string;
  dialect: string;
}

export async function translate(
  request: TranslationRequest,
  service: BrowserModelService,
  options: RunOptions,
): Promise<{text: string; metadata: string}> {
  const data = await runGradio(
    service.space,
    service.endpoint,
    {
      text: request.text,
      direction_label: request.direction,
      formosan_language: request.language,
      source_domain: "Unknown / general",
      dialect: request.dialect || "Default / unknown",
      max_new_tokens: 96,
      num_beams: 4,
      repetition_penalty: 1.15,
    },
    options,
  );
  return modelText(data, "translation");
}

export async function transcribe(
  language: string,
  audio: Blob,
  service: BrowserModelService,
  options: RunOptions,
): Promise<{text: string; metadata: string}> {
  if (audio.size > 25 * 1024 * 1024) throw new Error("Audio must be 25 MiB or smaller");
  const {handle_file} = await import("@gradio/client");
  const data = await runGradio(
    service.space,
    service.endpoint,
    {language_name: language, audio_path: handle_file(audio)},
    options,
  );
  return modelText(data, "speech recognition");
}
