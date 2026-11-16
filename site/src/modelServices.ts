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

interface GradioJob extends AsyncIterable<GradioEvent> {
  cancel: () => Promise<void> | void;
}

interface GradioClient {
  close: () => void;
  submit: (endpoint: string, payload: Record<string, unknown>) => GradioJob;
}

const connections = new Map<string, Promise<GradioClient>>();
const RUN_HISTORY_PREFIX = "gradio:run-history:";

/** Removes run records that earlier versions let the Space client keep in this browser. */
export function forgetModelRunHistory(): void {
  try {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith(RUN_HISTORY_PREFIX)) localStorage.removeItem(key);
    }
  } catch {
    // Storage can be unavailable in private windows; nothing was kept there either.
  }
}

// The Space client copies the page's query string, which holds search terms and link
// parameters, into its request URLs. It reads it once when a job is submitted, so the
// address is hidden for that synchronous call only.
function submitWithoutPageQuery<T>(submit: () => T): T {
  const {pathname, search, hash} = window.location;
  if (!search) return submit();
  window.history.replaceState(window.history.state, "", `${pathname}${hash}`);
  try {
    return submit();
  } finally {
    window.history.replaceState(window.history.state, "", `${pathname}${search}${hash}`);
  }
}

async function modelClient(
  space: string,
  onStage: RunOptions["onStage"],
): Promise<GradioClient> {
  const existing = connections.get(space);
  if (existing) return existing;
  const {Client} = await import("@gradio/client");
  const connection = Client.connect(space, {
    events: ["data", "status"],
    // Kakarayan does not store model input or output; neither may the client.
    record_history: false,
    status_callback: (status) => {
      if (status.status === "sleeping" || status.status === "starting") {
        onStage("connecting", "The public Space is waking up. This can take a few minutes.");
      }
    },
  }).then((client) => client as GradioClient);
  connections.set(space, connection);
  try {
    return await connection;
  } catch (cause) {
    if (connections.get(space) === connection) connections.delete(space);
    throw cause;
  }
}

export function closeModelServiceConnections() {
  for (const connection of connections.values()) {
    void connection.then((client) => client.close(), () => undefined);
  }
  connections.clear();
}

async function runGradio(
  space: string,
  endpoint: string,
  payload: Record<string, unknown>,
  {signal, onStage, timeoutMs = 180_000}: RunOptions,
): Promise<unknown[]> {
  if (signal.aborted) throw new DOMException("Request cancelled", "AbortError");
  onStage("connecting", "Connecting to the public Hugging Face Space…");
  let job: GradioJob | null = null;
  let interrupted: DOMException | null = null;
  let rejectInterruption: ((reason: DOMException) => void) | null = null;

  const interrupt = (reason: DOMException) => {
    if (interrupted) return;
    interrupted = reason;
    if (job) {
      const current = job;
      // Provider cancellation is best effort. Detach locally even if it fails.
      void Promise.resolve().then(() => current.cancel()).catch(() => undefined);
    }
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

  const connection = modelClient(space, onStage);
  let result: unknown[] | null = null;
  try {
    const client = await Promise.race([connection, interruption]);
    const submitted = submitWithoutPageQuery(() => client.submit(endpoint, payload));
    job = submitted;
    const consume = async () => {
      for await (const event of submitted) {
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
  } catch (cause) {
    if (!(cause instanceof DOMException && cause.name === "AbortError")) {
      if (connections.get(space) === connection) connections.delete(space);
      void connection.then((connected) => connected.close(), () => undefined);
    }
    throw cause;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener("abort", abort);
  }
}

// Only the answer is used. A service's other values, such as its own attribution text, are
// not shown, so a service cannot label its output as reviewed or licensed.
function modelText(data: unknown[], task: string): {text: string} {
  if (typeof data[0] !== "string" || !data[0].trim()) {
    throw new Error(`The public ${task} model returned a malformed response`);
  }
  return {text: data[0]};
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
): Promise<{text: string}> {
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
): Promise<{text: string}> {
  if (audio.size > 25 * 1024 * 1024) throw new Error("Audio must be 25 MiB or smaller");
  const {handle_file} = await import("@gradio/client");
  const data = await runGradio(
    service.space,
    service.endpoint,
    // A chosen file's own name stays on the device; the Space gets an unnamed blob.
    {language_name: language, audio_path: handle_file(new Blob([audio], {type: audio.type}))},
    options,
  );
  return modelText(data, "speech recognition");
}
