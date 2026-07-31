import {useMemo, useState} from "react";

interface DiagnosticDocument {
  application: string;
  application_version: string;
  data_release: string | null;
  failed_public_asset: string | null;
  error: {name: string; detail: string} | null;
  capabilities: Record<string, boolean>;
}

function publicAsset(message: string): string | null {
  const match = message.match(/https?:\/\/[^\s]+|\/kakarayan\/(?:api|data)\/[^\s]+/u)?.[0];
  if (!match) return null;
  try {
    const url = new URL(match, window.location.origin);
    if (url.origin !== window.location.origin) return null;
    return `${url.origin}${url.pathname}`;
  } catch {
    return null;
  }
}

function safeDetail(error: Error): string {
  return error.message
    .replace(/Invalid RE2 pattern:.*/u, "Invalid RE2 pattern")
    .replace(/(?:\/Users|\/home|[A-Z]:\\Users)[^\s:]+/giu, "[local path]")
    .replace(/([?&](?:q|query)=)[^&\s]+/giu, "$1[redacted]")
    .slice(0, 500);
}

function makeDiagnostics(releaseId: string | null, error: Error | null): DiagnosticDocument {
  return {
    application: "Kakarayan",
    application_version: import.meta.env.VITE_APP_VERSION ?? "0.1.0",
    data_release: releaseId,
    failed_public_asset: error ? publicAsset(error.message) : null,
    error: error ? {name: error.name, detail: safeDetail(error)} : null,
    capabilities: {
      webassembly: "WebAssembly" in globalThis,
      worker: "Worker" in globalThis,
      decompression_stream: "DecompressionStream" in globalThis,
      indexed_db: "indexedDB" in globalThis,
      service_worker: "serviceWorker" in navigator,
      media_recorder: "MediaRecorder" in globalThis,
      microphone: Boolean(navigator.mediaDevices?.getUserMedia),
      web_crypto: Boolean(crypto.subtle),
    },
  };
}

function download(value: DiagnosticDocument) {
  const url = URL.createObjectURL(
    new Blob([`${JSON.stringify(value, null, 2)}\n`], {type: "application/json"}),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = "kakarayan-diagnostics.json";
  anchor.click();
  URL.revokeObjectURL(url);
}

export function Diagnostics({
  releaseId,
  error = null,
}: {
  releaseId: string | null;
  error?: Error | null;
}) {
  const [notice, setNotice] = useState("");
  const document = useMemo(() => makeDiagnostics(releaseId, error), [error, releaseId]);
  const body = `Kakarayan diagnostics\n\n\`\`\`json\n${JSON.stringify(document, null, 2)}\n\`\`\``;
  const issue = new URL("https://github.com/FormosanBank/kakarayan/issues/new");
  issue.searchParams.set("title", error ? "Public site error" : "Kakarayan problem report");
  issue.searchParams.set("body", body);
  const issueHref =
    issue.href.length <= 1_800
      ? issue.href
      : "https://github.com/FormosanBank/kakarayan/issues/new";
  return (
    <div className="diagnostic-actions">
      <button
        className="text-button"
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(JSON.stringify(document, null, 2));
            setNotice("Diagnostics copied.");
          } catch {
            setNotice("Clipboard unavailable. Download the diagnostics file instead.");
          }
        }}
      >
        Copy diagnostics
      </button>
      <button className="text-button" onClick={() => download(document)}>
        Download diagnostics
      </button>
      <a href={issueHref}>Report a public-site problem</a>
      {notice && (
        <span role="status" aria-live="polite">
          {notice}
        </span>
      )}
    </div>
  );
}
