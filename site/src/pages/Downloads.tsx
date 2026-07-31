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
  publishable: boolean;
  blocked_reasons: string[];
  download_url: string;
}

interface DownloadsCatalog {
  release_id: string;
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
  const [manifest, setManifest] = useState<DownloadsCatalog | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState("all");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/v1/downloads.json`, {
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        setManifest((await response.json()) as DownloadsCatalog);
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
        return format === "all" || artifact.path.endsWith(format);
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
            <option value="all">All prepared formats</option>
            <option value=".zip">ZIP packages</option>
            <option value=".gz">SQLite gzip</option>
            <option value=".parquet">Parquet</option>
            <option value=".xlsx">XLSX</option>
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
              <StatusBadge value={artifact.publishable ? "allowed" : "review_required"} />
              {artifact.publishable ? (
                <a
                  className="button button--primary"
                  href={artifact.download_url}
                >
                  Download
                </a>
              ) : (
                <>
                  <button className="button button--primary" disabled>
                    Rights review required
                  </button>
                  <small>{artifact.blocked_reasons.join("; ")}</small>
                </>
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
            <p>
              Gzip-compressed portable relational snapshot for SQL, R, Python, Datasette,
              and local APIs.
            </p>
          </article>
          <article>
            <h3>JSON Lines</h3>
            <p>One record per line for streaming, shell pipelines, and document tools.</p>
          </article>
          <article>
            <h3>Parquet and XLSX</h3>
            <p>
              Columnar research tables and a spreadsheet-safe, human-oriented workbook.
            </p>
          </article>
          <article>
            <h3>CLDF and aligned media</h3>
            <p>
              Conservative CLDF examples plus EAF, TextGrid, WebVTT, and SRT only where
              valid timings exist.
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
