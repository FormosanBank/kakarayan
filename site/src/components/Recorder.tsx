import {useEffect, useRef, useState} from "react";

import {transcribe, type ServiceStage} from "../modelServices";
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
  const [language, setLanguage] = useState("Amis");
  const [consent, setConsent] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<ServiceStage | "idle">("idle");
  const service = catalog.services.find((item) => item.space === "FormosanBank/formosan_asr");

  useEffect(
    () => () => {
      controller.current?.abort();
      stream.current?.getTracks().forEach((track) => track.stop());
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    },
    [],
  );

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
        if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
        const url = URL.createObjectURL(blob);
        audioUrlRef.current = url;
        setAudio(blob);
        setAudioUrl(url);
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
        {audioUrl && (
          <>
            <audio src={audioUrl} controls />
            <a className="button button--quiet" href={audioUrl} download="kakarayan-recording.webm">
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
        </div>
      )}
    </section>
  );
}
