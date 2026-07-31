import {useEffect, useMemo, useRef, useState, type ChangeEvent} from "react";

import {transcribe, type ServiceStage} from "../modelServices";
import {useI18n} from "../i18n";
import {wordError} from "../recorderMetrics";
import {makeManualCard, saveCard} from "../study";
import type {Language, ModelCatalog} from "../types";

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

export function Recorder({
  catalog,
  languages,
}: {
  catalog: ModelCatalog;
  languages: Language[];
}) {
  const {number, tx} = useI18n();
  const recorder = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const controller = useRef<AbortController | null>(null);
  const audioUrlRef = useRef("");
  const recordStartedAt = useRef(0);
  const [recording, setRecording] = useState(false);
  const [audio, setAudio] = useState<Blob | null>(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [audioName, setAudioName] = useState("kakarayan-recording.webm");
  const [audioDuration, setAudioDuration] = useState<number | null>(null);
  const [language, setLanguage] = useState("Amis");
  const [consent, setConsent] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [reference, setReference] = useState("");
  const [status, setStatus] = useState("");
  const [stage, setStage] = useState<ServiceStage | "idle">("idle");
  const service = catalog.services.find((item) => item.space === "FormosanBank/formosan_asr");
  const modelSlug =
    language === "Yami / Tao"
      ? "yami"
      : language.toLocaleLowerCase().replaceAll(/[^a-z]+/gu, "-");
  const model = catalog.models.find(
    (item) =>
      item.task === "automatic-speech-recognition" &&
      item.repository.toLocaleLowerCase().endsWith(`-${modelSlug}`),
  );
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

  function setLocalAudio(blob: Blob, name: string, knownDuration: number | null = null) {
    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
    const url = URL.createObjectURL(blob);
    audioUrlRef.current = url;
    setAudio(blob);
    setAudioUrl(url);
    setAudioName(name);
    setAudioDuration(knownDuration);
    setTranscript("");
    setStatus("");
    setStage("idle");
    const probe = document.createElement("audio");
    probe.preload = "metadata";
    probe.src = url;
    probe.onloadedmetadata = () => {
      if (
        audioUrlRef.current === url &&
        Number.isFinite(probe.duration) &&
        probe.duration > 0
      ) {
        setAudioDuration(probe.duration);
      }
    };
  }

  function loadAudioFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 25 * 1024 * 1024) {
      setStatus(tx("Audio must be 25 MiB or smaller.", "音訊檔案不得超過 25 MiB。"));
      return;
    }
    if (file.type && !file.type.startsWith("audio/")) {
      setStatus(tx("Choose a browser-readable audio file.", "請選擇瀏覽器可讀取的音訊檔案。"));
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
        const duration = Math.max(0, (performance.now() - recordStartedAt.current) / 1_000);
        setLocalAudio(blob, "kakarayan-recording.webm", duration);
        media.getTracks().forEach((track) => track.stop());
        stream.current = null;
        setRecording(false);
      };
      next.start();
      recordStartedAt.current = performance.now();
      setRecording(true);
    } catch (cause) {
      setStatus(
        cause instanceof Error
          ? tx(`Microphone unavailable: ${cause.message}`, `無法使用麥克風：${cause.message}`)
          : tx("Microphone unavailable.", "無法使用麥克風。"),
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
    setAudioDuration(null);
    setStatus(tx("Local recording deleted.", "已刪除本機錄音。"));
    setStage("idle");
  }

  async function runAsr() {
    if (!audio || !consent || !model || audioDuration === null) return;
    if (audioDuration > 600) {
      setStatus(tx("Audio must be 10 minutes or shorter.", "音訊長度不得超過 10 分鐘。"));
      return;
    }
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
        setStatus(tx("Transcription cancelled. The recording remains only in this browser.", "已取消轉錄。錄音仍只保留在此瀏覽器。"));
      } else {
        setStage("error");
        setStatus(
          `${cause instanceof Error ? cause.message : String(cause)} ${tx("You can still play or download your local recording.", "您仍可播放或下載本機錄音。")}`,
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
      setStatus(tx("Automatic transcript copied.", "已複製自動轉錄文字。"));
    } catch {
      setStatus(tx("Clipboard access was unavailable. Select the transcript text to copy it.", "無法存取剪貼簿。請選取轉錄文字後自行複製。"));
    }
  }

  async function saveTranscript() {
    if (!transcript) return;
    const targetLanguage = languages.find(
      (item) => item.name.toLocaleLowerCase() === language.toLocaleLowerCase(),
    );
    try {
      await saveCard(
        makeManualCard({
          front: reference.trim() || tx(`Automatic ${language} transcript`, `${language} 自動轉錄`),
          back: transcript,
          deck: "Pronunciation practice",
          languageId: targetLanguage?.id ?? "",
          tags: ["asr", "machine-output"],
        }),
      );
      setStatus(tx("Automatic transcript saved as a local card.", "已將自動轉錄儲存為本機卡片。"));
    } catch (cause) {
      setStatus(cause instanceof Error ? cause.message : String(cause));
    }
  }

  const running = !["idle", "complete", "cancelled", "error"].includes(stage);
  return (
    <section className="model-tool" aria-labelledby="recording-heading">
      <div className="tool-heading">
        <div>
          <p className="eyebrow">{tx("Local first", "本機優先")}</p>
          <h3 id="recording-heading">{tx("Pronunciation recorder", "發音錄音工具")}</h3>
        </div>
        <span className="status status--local">{tx("on-device", "裝置端")}</span>
      </div>
      <p>
        {tx(
          "Recording and playback stay in this tab. Nothing is uploaded until you explicitly choose automatic transcription below.",
          "錄音與播放都留在此分頁中。只有在您明確選擇下方的自動轉錄後，資料才會上傳。",
        )}
      </p>
      <div className="recorder-panel">
        {!recording ? (
          <button className="button button--primary" onClick={startRecording}>
            {audio ? tx("Record again", "重新錄音") : tx("Start recording", "開始錄音")}
          </button>
        ) : (
          <button className="button button--danger" onClick={() => recorder.current?.stop()}>
            {tx("Stop recording", "停止錄音")}
          </button>
        )}
        {recording && <span className="recording-indicator">{tx("Recording…", "錄音中…")}</span>}
        {!recording && (
          <label className="button button--quiet file-button">
            {tx("Choose audio file", "選擇音訊檔案")}
            <input type="file" accept="audio/*" onChange={loadAudioFile} />
          </label>
        )}
        {audioUrl && (
          <>
            <audio src={audioUrl} controls />
            <a className="button button--quiet" href={audioUrl} download={audioName}>
              {tx("Download", "下載")}
            </a>
            <button className="button button--quiet" onClick={removeRecording}>
              {tx("Delete", "刪除")}
            </button>
            <small>
              {audioDuration === null
                ? tx("Reading audio duration…", "正在讀取音訊長度…")
                : `${audioDuration.toFixed(1)} ${tx("seconds", "秒")} · ${((audio?.size ?? 0) / 1024 ** 2).toFixed(1)} MiB`}
            </small>
          </>
        )}
      </div>
      {audio && (
        <div className="asr-panel">
          <div className="tool-heading">
            <h4>{tx("Optional automatic transcript", "選用自動轉錄")}</h4>
            <span className="status status--unchecked">{service?.status ?? "unavailable"}</span>
          </div>
          <label className="field">
            {tx("Model language", "模型語言")}
            <select value={language} onChange={(event) => setLanguage(event.target.value)}>
              {ASR_LANGUAGES.map((value) => (
                <option key={value}>{value}</option>
              ))}
            </select>
          </label>
          {model ? (
            <p className="model-disclosure">
              {tx("Model:", "模型：")} <a href={model.url}>{model.repository}</a> ·{" "}
              {tx("license", "授權")} {model.license} ·{" "}
              {model.limitations}
            </p>
          ) : (
            <p className="callout callout--warning">
              {tx(`This release has no registered public ASR model for ${language}. Recording, playback, and download remain available.`, `此版本沒有登錄 ${language} 的公開語音辨識模型。錄音、播放與下載仍可使用。`)}
            </p>
          )}
          <label className="field">
            {tx("Optional human reference transcript", "選用人工參考轉錄")}
            <textarea
              value={reference}
              onChange={(event) => setReference(event.target.value)}
              rows={3}
              maxLength={4_000}
              placeholder={tx("Paste a trusted transcript to compare with the model hypothesis", "貼上可信的轉錄文字，以便與模型假設比較")}
            />
          </label>
          <label className="consent">
            <input
              type="checkbox"
              checked={consent}
              onChange={(event) => setConsent(event.target.checked)}
            />
            <span>
              {tx(
                "Upload this recording directly to the public FormosanBank ASR Space on Hugging Face. The result is an automatic transcript, not a pronunciation score.",
                "將此錄音直接上傳至 Hugging Face 上公開的 FormosanBank 語音辨識 Space。結果是自動轉錄文字，不是發音評分。",
              )}
            </span>
          </label>
          <div className="button-row">
            <button
              className="button button--primary"
              disabled={
                !consent ||
                running ||
                !model ||
                audioDuration === null ||
                audioDuration > 600
              }
              onClick={runAsr}
            >
              {tx("Transcribe", "轉錄")}
            </button>
            {running && (
              <button className="button button--quiet" onClick={() => controller.current?.abort()}>
                {tx("Cancel", "取消")}
              </button>
            )}
          </div>
        </div>
      )}
      {status && <p className="callout callout--info">{status}</p>}
      {transcript && (
        <div className="machine-output">
          <span>{tx("Automatic transcript", "自動轉錄")}</span>
          <p>{transcript}</p>
          <div className="button-row">
            <button
              className="button button--quiet"
              onClick={copyTranscript}
            >
              {tx("Copy hypothesis", "複製模型假設")}
            </button>
            <button className="button button--quiet" onClick={downloadTranscript}>
              {tx("Download text", "下載文字")}
            </button>
            <button className="button button--quiet" onClick={saveTranscript}>
              {tx("Save to local deck", "儲存至本機牌組")}
            </button>
          </div>
          {comparison && (
            <div className="asr-comparison">
              <p>
                <strong>{(comparison.rate * 100).toFixed(1)}%</strong>{" "}
                {tx("word error rate", "字錯誤率")}
              </p>
              <small>
                {number(comparison.edits)} {tx("edits over", "次編輯，參考文字共")}{" "}
                {number(comparison.referenceWords)} {tx("reference words;", "個詞；模型假設共")}{" "}
                {number(comparison.hypothesisWords)} {tx("hypothesis words. This compares text strings only and is not a pronunciation score.", "個詞。這只比較文字字串，並非發音評分。")}
              </small>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
