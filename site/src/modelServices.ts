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

interface RunOptions {
  signal: AbortSignal;
  onStage: (stage: ServiceStage, message?: string) => void;
}

async function runGradio(
  space: string,
  endpoint: string,
  payload: Record<string, unknown>,
  {signal, onStage}: RunOptions,
): Promise<unknown[]> {
  if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  onStage("connecting", "Connecting to the public Hugging Face Space…");
  const {Client} = await import("@gradio/client");
  const client = await Client.connect(space, {
    events: ["data", "status"],
    status_callback: (status) => {
      if (status.status === "sleeping" || status.status === "starting") {
        onStage("connecting", "The public Space is waking up. This can take a few minutes.");
      }
    },
  });
  const job = client.submit(endpoint, payload);
  const cancel = () => {
    void job.cancel();
    client.close();
  };
  signal.addEventListener("abort", cancel, {once: true});
  let result: unknown[] | null = null;
  try {
    for await (const event of job as AsyncIterable<GradioEvent>) {
      if (event.type === "data") result = event.data;
      if (event.type === "status") {
        if (event.stage === "pending") {
          const detail =
            typeof event.position === "number" ? `Queue position ${event.position + 1}` : undefined;
          onStage("pending", detail);
        } else if (event.stage === "generating" || event.stage === "streaming") {
          onStage("generating", "The model is working…");
        } else if (event.stage === "error") {
          throw new Error(
            typeof event.message === "string" ? event.message : "The public model returned an error",
          );
        }
      }
    }
    if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
    if (!result) throw new Error("The public model returned no result");
    onStage("complete");
    return result;
  } finally {
    signal.removeEventListener("abort", cancel);
    client.close();
  }
}

export interface TranslationRequest {
  text: string;
  direction: "Formosan → English" | "English → Formosan" | "Formosan → Chinese" | "Chinese → Formosan";
  language: string;
  dialect: string;
}

export async function translate(
  request: TranslationRequest,
  options: RunOptions,
): Promise<{text: string; metadata: string}> {
  const data = await runGradio(
    "FormosanBank/formosan-mt",
    "/translate",
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
  return {text: String(data[0] ?? ""), metadata: String(data[1] ?? "")};
}

export async function transcribe(
  language: string,
  audio: Blob,
  options: RunOptions,
): Promise<{text: string; metadata: string}> {
  if (audio.size > 25 * 1024 * 1024) throw new Error("Audio must be 25 MiB or smaller");
  const {handle_file} = await import("@gradio/client");
  const data = await runGradio(
    "FormosanBank/formosan_asr",
    "/transcribe",
    {language_name: language, audio_path: handle_file(audio)},
    options,
  );
  return {text: String(data[0] ?? ""), metadata: String(data[1] ?? "")};
}
