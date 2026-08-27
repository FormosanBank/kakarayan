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
  url: "https://audio.example.test/full.wav",
  playback_urls: ["https://audio.example.test/clip.wav"],
  start: 10,
  end: 15,
  source: "",
  duration: 5,
  availability_status: "available",
};

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
  expect(player?.src).toBe("https://audio.example.test/clip.wav#t=0,5");
  expect(player).toHaveAttribute("data-clip-start", "0");
  expect(player).toHaveAttribute("data-clip-end", "5");

  await act(async () => player?.dispatchEvent(new Event("error")));
  expect(container.querySelector("audio")?.src).toBe(
    "https://audio.example.test/full.wav#t=10,15",
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
