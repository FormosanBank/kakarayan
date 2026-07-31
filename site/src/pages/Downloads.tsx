import {useEffect, useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

interface Artifact {
  path: string;
  media_type: string;
  bytes: number;
  sha256: string;
  scope: string;
  rights_ids: string[];
}

interface ReleaseManifest {
  release_id: string;
  source: {repository: string; commit: string};
  artifacts: Artifact[];
}

function size(bytes: number): string {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(unit ? 1 : 0)} ${units[unit]}`;
}

export function Downloads({data}: {data: AppData}) {
  const {t} = useI18n();
  const [manifest, setManifest] = useState<ReleaseManifest | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}data/release-manifest.json`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        setManifest((await response.json()) as ReleaseManifest);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => controller.abort();
  }, []);
  const artifacts = useMemo(
    () =>
      (manifest?.artifacts ?? []).filter((artifact) => {
        const isResearch =
          artifact.path === "formosanbank.sqlite" ||
          artifact.path.startsWith("tables/") ||
          artifact.path === "search/sentences.jsonl";
        return isResearch && (format === "all" || artifact.path.endsWith(format));
      }),
    [format, manifest?.artifacts],
  );
  const hasUnreviewedRights = data.rights.entries.some(
    (entry) => entry.review_status === "review_required",
  );
  return (
    <div className="page-wrap">
      <PageIntro title={t("download.title")} lede={t("download.lede")} />
      <div className="download-principles">
        <div>
          <span>1</span>
          <strong>Choose by use</strong>
          <p>SQLite for local query, JSONL for streams, CSV for tables, XML for canon.</p>
        </div>
        <div>
          <span>2</span>
          <strong>Pin the release</strong>
          <p>Every artifact names the public source commit and immutable release.</p>
        </div>
        <div>
          <span>3</span>
          <strong>Carry the notice</strong>
          <p>Corpus and component rights remain attached to every derived package.</p>
        </div>
      </div>
      {hasUnreviewedRights && (
        <p className="callout callout--warning">
          <strong>Rights review is still in progress.</strong> Prepared projected tables are
          shown for technical inspection. Do not assume that public repository visibility
          grants uniform redistribution or commercial rights. Follow each corpus notice.
        </p>
      )}
      <div className="download-toolbar">
        <div>
          <span>{manifest?.release_id ?? data.meta.release_id}</span>
          <code>{data.meta.source.commit.slice(0, 12)}</code>
        </div>
        <label className="field field--compact">
          Format
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="all">All core formats</option>
            <option value=".sqlite">SQLite</option>
            <option value=".csv">CSV</option>
            <option value=".jsonl">JSON Lines</option>
          </select>
        </label>
      </div>
      {error && (
        <p className="callout callout--error">
          Prepared artifact manifest unavailable: {error}. Canonical XML remains available
          from the public FormosanBank repository.
        </p>
      )}
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <article key={artifact.path}>
            <div className="file-mark">{artifact.path.split(".").pop()?.toUpperCase()}</div>
            <div>
              <h2>{artifact.path}</h2>
              <p>{artifact.scope}</p>
              <code title={artifact.sha256}>sha256 {artifact.sha256.slice(0, 20)}…</code>
            </div>
            <div>
              <strong>{size(artifact.bytes)}</strong>
              <StatusBadge value={hasUnreviewedRights ? "review_required" : "allowed"} />
              {hasUnreviewedRights ? (
                <button className="button button--primary" disabled>
                  Rights review required
                </button>
              ) : (
                <a
                  className="button button--primary"
                  href={`${import.meta.env.BASE_URL}data/${artifact.path}`}
                  download
                >
                  Download
                </a>
              )}
            </div>
          </article>
        ))}
      </div>
      <section className="format-guide">
        <h2>Format guide</h2>
        <div>
          <article>
            <h3>Canonical XML</h3>
            <p>
              The authoritative hierarchy and exact source bytes. Obtain from the pinned
              public FormosanBank tree while package rights review is pending.
            </p>
          </article>
          <article>
            <h3>SQLite</h3>
            <p>Portable relational snapshot for SQL, R, Python, Datasette, and local APIs.</p>
          </article>
          <article>
            <h3>JSON Lines</h3>
            <p>One record per line for streaming, shell pipelines, and document tools.</p>
          </article>
          <article>
            <h3>CSV</h3>
            <p>One file per tier with stable IDs. Formula-like cells are guarded in UI exports.</p>
          </article>
        </div>
      </section>
    </div>
  );
}
