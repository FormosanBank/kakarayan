import {useEffect, useMemo, useRef, useState, type ChangeEvent} from "react";

import {transcribe, type ServiceStage} from "../modelServices";
import {wordError} from "../recorderMetrics";
import type {ModelCatalog} from "../types";

const ASR_LANGUAGES = [
  "Amis",
  "Atayal",
  "Bunun",
  "Kanakanavu",
  "Kavalan",
  "Paiwan",
  "Puyuma",
  "Rukai",
  "Saaroa",
  "Saisiyat",
  "Sakizaya",
  "Seediq",
  "Taroko",
  "Thao",
  "Tsou",
  "Yami / Tao",
];

export function Recorder({catalog}: {catalog: ModelCatalog}) {
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const controller = useRef<AbortController | null>(null);
  const audioUrlRef = useRef("");
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioName, setAudioName] = useState("kakarayan-recording.webm");
  const [language, setLanguage] = useState("Amis");
  const [consent, setConsent] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<ServiceStage | "idle">("idle");
  const service = catalog.services.find((item) => item.space === "FormosanBank/formosan_asr");
  const comparison = useMemo(
    () => (reference.trim() && transcript ? wordError(reference, transcript) : null),
    [reference, transcript],
  );

  useEffect(
    () => () => {
      controller.current?.abort();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

  function setLocalAudio(blob: Blob, name: string) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudio(blob);
    setAudioUrl(url);
    setAudioName(name);
    setTranscript("");
    setStatus("");
    setStage("idle");
  }

  function loadAudioFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setStatus("Audio must be 25 MiB or smaller.");
      return;
    }
    if (file.type && !file.type.startsWith("audio/")) {
      setStatus("Choose a browser-readable audio file.");
      return;
    }
    setLocalAudio(file, file.name);
  }

  async function startRecording() {
    setStatus("");
    setTranscript("");
    try {
      const media = await navigator.mediaDevices.getUserMedia({audio: true});
      stream.current = media;
      chunks.current = [];
      const next = new MediaRecorder(media);
      recorder.current = next;
      next.ondataavailable = (event) => {
        if (event.data.size) chunks.current.push(event.data);
      };
      next.onstop = () => {
        const blob = new Blob(chunks.current, {type: next.mimeType || "audio/webm"});
        setLocalAudio(blob, "kakarayan-recording.webm");
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setRecording(false);
      };
      next.start();
      setRecording(true);
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? `Microphone unavailable: ${cause.message}`
          : "Microphone unavailable.",
      );
    }
  }

  function removeRecording() {
    controller.current?.abort();
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    audioUrlRef.current = "";
    setAudio(null);
    setAudioUrl("");
    setTranscript("");
    setStatus("Local recording deleted.");
    setStage("idle");
  }

  async function runAsr() {
    if (!audio || !consent) return;
    controller.current?.abort();
    const next = new AbortController();
    controller.current = next;
    setTranscript("");
    try {
      const output = await transcribe(language, audio, {
        signal: next.signal,
        onStage: (nextStage, message) => {
          setStage(nextStage);
          setStatus(message ?? "");
        },
      });
      setTranscript(output.text);
      setStatus(output.metadata);
    } catch (cause) {
      if (cause instanceof DOMException && cause.name === "AbortError") {
        setStage("cancelled");
        setStatus("Transcription cancelled. The recording remains only in this browser.");
      } else {
        setStage("error");
        setStatus(
          `${cause instanceof Error ? cause.message : String(cause)} You can still play or download your local recording.`,
        );
      }
    }
  }

  function downloadTranscript() {
    const url = URL.createObjectURL(
      new Blob([`${transcript}\n`], {type: "text/plain;charset=utf-8"}),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "kakarayan-asr-hypothesis.txt";
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcript);
      setStatus("Automatic transcript copied.");
    } catch {
      setStatus("Clipboard access was unavailable. Select the transcript text to copy it.");
    }
  }

  const running = !["idle", "complete", "cancelled", "error"].includes(stage);
  return (
    <section className="model-tool" aria-labelledby="recording-heading">
      <div className="tool-heading">
        <div>
          <p className="eyebrow">Local first</p>
          <h3 id="recording-heading">Pronunciation recorder</h3>
        </div>
        <span className="status status--local">on-device</span>
      </div>
      <p>
        Recording and playback stay in this tab. Nothing is uploaded until you explicitly
        choose automatic transcription below.
      </p>
      <div className="recorder-panel">
        {!recording ? (
          <button className="button button--primary" onClick={startRecording}>
            {audio ? "Record again" : "Start recording"}
          </button>
        ) : (
          <button className="button button--danger" onClick={() => recorder.current?.stop()}>
            Stop recording
          </button>
        )}
        {recording && <span className="recording-indicator">Recording…</span>}
        {!recording && (
          <label className="button button--quiet file-button">
            Choose audio file
            <input type="file" accept="audio/*" onChange={loadAudioFile} />
          </label>
        )}
        {audioUrl && (
          <>
            <audio src={audioUrl} controls />
            <a className="button button--quiet" href={audioUrl} download={audioName}>
              Download
            </a>
            <button className="button button--quiet" onClick={removeRecording}>
              Delete
            </button>
          </>
        )}
      </div>
      {audio && (
        <div className="asr-panel">
          <div className="tool-heading">
            <h4>Optional automatic transcript</h4>
            <span className="status status--unchecked">{service?.status ?? "unavailable"}</span>
          </div>
          <label className="field">
            Model language
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {ASR_LANGUAGES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          <label className="field">
            Optional human reference transcript
            <textarea
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              rows={3}
              maxLength={4_000}
              placeholder="Paste a trusted transcript to compare with the model hypothesis"
            />
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              Upload this recording directly to the public FormosanBank ASR Space on Hugging
              Face. The result is an automatic transcript, not a pronunciation score.
            </span>
          </label>
          <div className="button-row">
            <button
              className="button button--primary"
              disabled={!consent || running}
              onClick={runAsr}
            >
              Transcribe
            </button>
            {running && (
              <button className="button button--quiet" onClick={() => controller.current?.abort()}>
                Cancel
              </button>
            )}
          </div>
        </div>
      )}
      {status && <p className="callout callout--info">{status}</p>}
      {transcript && (
        <div className="machine-output">
          <span>Automatic transcript</span>
          <p>{transcript}</p>
          <div className="button-row">
            <button
              className="button button--quiet"
              onClick={copyTranscript}
            >
              Copy hypothesis
            </button>
            <button className="button button--quiet" onClick={downloadTranscript}>
              Download text
            </button>
          </div>
          {comparison && (
            <div className="asr-comparison">
              <p>
                <strong>{(comparison.rate * 100).toFixed(1)}%</strong> word error rate
              </p>
              <small>
                {comparison.edits} edits over {comparison.referenceWords} reference words;{" "}
                {comparison.hypothesisWords} hypothesis words. This compares text strings
                only and is not a pronunciation score.
              </small>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
