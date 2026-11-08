import {act} from "react";
import {createRoot} from "react-dom/client";

import {I18nProvider} from "../i18n";
import type {SearchRecord} from "../types";
import {EvidenceAudio} from "./EvidenceAudio";

const evidence: SearchRecord["audio"][number] = {
  owner_type: "sentence",
  owner_id: "sentence_one",
  position: 0,
  file: "sentence.wav",
  url: "https://klokah.tw/full.wav",
  playback_urls: ["https://huggingface.co/datasets/FormosanBank/Test/resolve/main/clip.wav"],
  start: 10,
  end: 15,
  source: "",
  duration: 5,
  availability_status: "available",
};

it("plays only allowlisted hosts and tries at most three copies", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const hostile = {
    ...evidence,
    playback_urls: [
      "https://rogue-beacon.test/probe",
      "https://klokah.tw:6379/probe",
      "http://klokah.tw/plain.wav",
      "https://huggingface.co/datasets/Someone/x/clip.wav",
      "javascript:alert(1)",
      ...Array.from({length: 5}, (_, index) => `https://klokah.tw/${index}.wav`),
    ],
    url: "https://rogue-beacon.test/from_url",
    file: "https://rogue-beacon.test/from_file",
  };

  await act(async () => root.render(<I18nProvider><EvidenceAudio audio={hostile} /></I18nProvider>));
  const sources: string[] = [];
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const player = container.querySelector("audio");
    if (!player) break;
    sources.push(player.src.replace(/#.*$/u, ""));
    await act(async () => player.dispatchEvent(new Event("error")));
  }
  expect(sources).toEqual(["https://klokah.tw/0.wav", "https://klokah.tw/1.wav", "https://klokah.tw/2.wav"]);

  await act(async () => root.unmount());
  container.remove();
});

it("distinguishes clip-local mirrors from source-recording fallbacks", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(
    <I18nProvider>
      <EvidenceAudio audio={evidence} />
    </I18nProvider>,
  ));

  const player = container.querySelector("audio");
  expect(player?.src).toBe("https://huggingface.co/datasets/FormosanBank/Test/resolve/main/clip.wav#t=0,5");
  expect(player).toHaveAttribute("data-clip-start", "0");
  expect(player).toHaveAttribute("data-clip-end", "5");

  await act(async () => player?.dispatchEvent(new Event("error")));
  expect(container.querySelector("audio")?.src).toBe(
    "https://klokah.tw/full.wav#t=10,15",
  );
  expect(container.querySelector("audio")).toHaveAttribute("data-clip-start", "10");
  expect(container.querySelector("audio")).toHaveAttribute("data-clip-end", "15");

  await act(async () => root.unmount());
  container.remove();
});

it("seeks, clamps, stops, and replays within the aligned source interval", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(
    <I18nProvider>
      <EvidenceAudio audio={{...evidence, playback_urls: []}} />
    </I18nProvider>,
  ));

  const player = container.querySelector("audio");
  if (!player) throw new Error("Audio player not rendered");
  Object.defineProperty(player, "duration", {configurable: true, value: 60});
  Object.defineProperty(player, "pause", {configurable: true, value: vi.fn()});

  player.currentTime = 0;
  await act(async () => player.dispatchEvent(new Event("loadedmetadata")));
  expect(player.currentTime).toBe(10);

  player.currentTime = 5;
  await act(async () => player.dispatchEvent(new Event("seeking")));
  expect(player.currentTime).toBe(10);

  player.currentTime = 15.1;
  await act(async () => player.dispatchEvent(new Event("timeupdate")));
  expect(player.pause).toHaveBeenCalledOnce();
  expect(player.currentTime).toBe(15);

  await act(async () => player.dispatchEvent(new Event("play")));
  expect(player.currentTime).toBe(10);

  await act(async () => root.unmount());
  container.remove();
});
