import type {AnalysisOptions, AnalysisResult} from "./analysis";
import type {SearchRecord} from "./types";

export function runAnalysis(
  records: SearchRecord[],
  options: AnalysisOptions,
  signal?: AbortSignal,
): Promise<AnalysisResult> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("Analysis cancelled", "AbortError"));
      return;
    }
    const worker = new Worker(new URL("./analysis.worker.ts", import.meta.url), {type: "module"});
    const cleanup = () => {
      signal?.removeEventListener("abort", abort);
      worker.terminate();
    };
    const abort = () => {
      cleanup();
      reject(new DOMException("Analysis cancelled", "AbortError"));
    };
    signal?.addEventListener("abort", abort, {once: true});
    worker.onerror = (event) => {
      cleanup();
      reject(new Error(event.message || "Analysis worker failed"));
    };
    worker.onmessage = (event: MessageEvent<AnalysisResult>) => {
      cleanup();
      resolve(event.data);
    };
    worker.postMessage({records, options});
  });
}
