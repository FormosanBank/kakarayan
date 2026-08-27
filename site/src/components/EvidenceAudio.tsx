import {useState, type SyntheticEvent} from "react";

import {useI18n} from "../i18n";
import type {SearchRecord} from "../types";

type AudioEvidence = SearchRecord["audio"][number];

type PlaybackCandidate = {
  end: number | null;
  start: number;
  url: string;
};

const TIME_TOLERANCE_SECONDS = 0.05;

function nonNegative(value: number | null): number | null {
  return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function publicUrl(value: string): string | null {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

function addCandidate(
  candidates: PlaybackCandidate[],
  seen: Set<string>,
  value: string,
  start: number,
  end: number | null,
) {
  const url = publicUrl(value);
  if (!url || seen.has(url)) return;
  seen.add(url);
  candidates.push({end, start, url});
}

function playbackCandidates(audio: AudioEvidence): PlaybackCandidate[] {
  const candidates: PlaybackCandidate[] = [];
  const seen = new Set<string>();
  const sourceStart = nonNegative(audio.start) ?? 0;
  const sourceEndValue = nonNegative(audio.end);
  const sourceEnd = sourceEndValue !== null && sourceEndValue > sourceStart
    ? sourceEndValue
    : null;
  const recordedDuration = nonNegative(audio.duration);
  const clipDuration = recordedDuration !== null && recordedDuration > 0
    ? recordedDuration
    : sourceEnd === null ? null : sourceEnd - sourceStart;

  for (const url of audio.playback_urls) {
    addCandidate(candidates, seen, url, 0, clipDuration);
  }
  addCandidate(candidates, seen, audio.file, 0, clipDuration);
  addCandidate(candidates, seen, audio.url, sourceStart, sourceEnd);
  addCandidate(candidates, seen, audio.source, sourceStart, sourceEnd);
  return candidates;
}

function temporalMediaUrl(candidate: PlaybackCandidate): string {
  if (candidate.start === 0 && candidate.end === null) return candidate.url;
  const url = new URL(candidate.url);
  url.hash = `t=${candidate.start}${candidate.end === null ? "" : `,${candidate.end}`}`;
  return url.href;
}

function seek(media: HTMLAudioElement, time: number) {
  const target = Number.isFinite(media.duration)
    ? Math.min(time, Math.max(0, media.duration))
    : time;
  try {
    media.currentTime = target;
  } catch {
    // The media may not expose a seekable range until more metadata is available.
  }
}

function bounds(media: HTMLAudioElement, candidate: PlaybackCandidate) {
  const duration = Number.isFinite(media.duration) ? media.duration : null;
  return {
    start: duration === null ? candidate.start : Math.min(candidate.start, duration),
    end: candidate.end === null || duration === null
      ? candidate.end
      : Math.min(candidate.end, duration),
  };
}

export function EvidenceAudio({audio}: {audio: AudioEvidence}) {
  const {tx} = useI18n();
  const [candidateIndex, setCandidateIndex] = useState(0);
  const [failed, setFailed] = useState(false);
  const candidates = playbackCandidates(audio);
  const candidate = candidates[candidateIndex];

  if (failed) {
    return <small>{tx("Audio could not be loaded.", "無法載入音訊。")}</small>;
  }
  if (!candidate) {
    return <small>{tx("Reference is not a public web URL.", "此參照不是公開網路網址。")}</small>;
  }
  const activeCandidate = candidate;

  function handleLoadedMetadata(event: SyntheticEvent<HTMLAudioElement>) {
    const range = bounds(event.currentTarget, activeCandidate);
    if (Math.abs(event.currentTarget.currentTime - range.start) > TIME_TOLERANCE_SECONDS) {
      seek(event.currentTarget, range.start);
    }
  }

  function handlePlay(event: SyntheticEvent<HTMLAudioElement>) {
    const range = bounds(event.currentTarget, activeCandidate);
    if (event.currentTarget.currentTime < range.start - TIME_TOLERANCE_SECONDS
      || (range.end !== null
        && event.currentTarget.currentTime >= range.end - TIME_TOLERANCE_SECONDS)) {
      seek(event.currentTarget, range.start);
    }
  }

  function handleSeeking(event: SyntheticEvent<HTMLAudioElement>) {
    const range = bounds(event.currentTarget, activeCandidate);
    if (event.currentTarget.currentTime < range.start - TIME_TOLERANCE_SECONDS) {
      seek(event.currentTarget, range.start);
    } else if (range.end !== null
      && event.currentTarget.currentTime > range.end + TIME_TOLERANCE_SECONDS) {
      seek(event.currentTarget, range.end);
    }
  }

  function handleTimeUpdate(event: SyntheticEvent<HTMLAudioElement>) {
    const range = bounds(event.currentTarget, activeCandidate);
    if (range.end !== null
      && event.currentTarget.currentTime >= range.end - TIME_TOLERANCE_SECONDS) {
      event.currentTarget.pause();
      seek(event.currentTarget, range.end);
    }
  }

  return (
    <audio
      aria-label={candidate.end === null
        ? tx(`Audio from ${candidate.start} seconds`, `從 ${candidate.start} 秒開始的音訊`)
        : tx(
            `Audio clip from ${candidate.start} to ${candidate.end} seconds`,
            `從 ${candidate.start} 至 ${candidate.end} 秒的音訊片段`,
          )}
      controls
      data-clip-end={candidate.end ?? undefined}
      data-clip-start={candidate.start}
      onCanPlay={handleLoadedMetadata}
      onError={() => {
        if (candidateIndex + 1 < candidates.length) setCandidateIndex(candidateIndex + 1);
        else setFailed(true);
      }}
      onLoadedMetadata={handleLoadedMetadata}
      onPlay={handlePlay}
      onPlaying={handlePlay}
      onSeeking={handleSeeking}
      onTimeUpdate={handleTimeUpdate}
      preload="metadata"
      src={temporalMediaUrl(candidate)}
    />
  );
}
