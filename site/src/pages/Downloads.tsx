import {useEffect, useMemo, useState} from "react";

import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
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
  format: string;
  language_ids: string[];
  corpus_ids: string[];
  tiers: string[];
  compression?: "gzip";
  content_bytes?: number;
  content_sha256?: string;
}

interface DownloadsCatalog {
  release_id: string;
  artifacts: Artifact[];
}

interface DownloadsEnvelope {
  api_version: "v1";
  release_id: string;
  data: DownloadsCatalog;
}

const PAGE_SIZE = 24;
const FORMAT_NAMES: Record<string, string> = {
  aligned: "time-aligned media",
  cldf: "CLDF dataset",
  csv: "CSV tables",
  jsonl: "JSON Lines",
  metadata: "metadata package",
  parquet: "Parquet tables",
  sqlite: "SQLite database",
  text: "plain-text exports",
  tsv: "TSV tables",
  xlsx: "Excel workbook",
  xml: "canonical XML",
};

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

function fileName(path: string): string {
  return path.split("/").pop() ?? path;
}

function artifactTitle(artifact: Artifact, corpusName?: string): string {
  const formatName = FORMAT_NAMES[artifact.format] ?? artifact.format.toUpperCase();
  if (artifact.corpus_ids.length === 1 && corpusName) return `${corpusName} ${formatName}`;
  if (artifact.path === "formosanbank.sqlite.gz") return "Complete FormosanBank SQLite database";
  return `Complete FormosanBank ${formatName}`;
}

function artifactScope(artifact: Artifact, corpusName?: string, languageName?: string): string {
  if (artifact.corpus_ids.length === 1 && corpusName) {
    return languageName ? `${languageName} · ${corpusName}` : corpusName;
  }
  return `${artifact.language_ids.length} languages · ${artifact.corpus_ids.length} corpora`;
}

export function Downloads({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const [params] = useSearchParams();
  const [manifest, setManifest] = useState<DownloadsCatalog | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState(params.get("format") ?? "all");
  const [languageId, setLanguageId] = useState(params.get("language") ?? "all");
  const [corpusId, setCorpusId] = useState(params.get("corpus") ?? "all");
  const [tier, setTier] = useState(params.get("tier") ?? "all");
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/v1/downloads.json`, {signal: controller.signal})
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        const envelope = (await response.json()) as DownloadsEnvelope;
        if (envelope.api_version !== "v1" || envelope.release_id !== data.meta.release_id) {
          throw new Error("Prepared download metadata does not match the loaded release");
        }
        setManifest(envelope.data);
      })
      .catch((cause: unknown) => {
        if (!controller.signal.aborted) {
          setError(cause instanceof Error ? cause.message : String(cause));
        }
      });
    return () => controller.abort();
  }, [data.meta.release_id]);

  const artifacts = useMemo(
    () =>
      (manifest?.artifacts ?? []).filter((artifact) =>
        (format === "all" || artifact.format === format) &&
        (languageId === "all" || artifact.language_ids.includes(languageId)) &&
        (corpusId === "all" || artifact.corpus_ids.includes(corpusId)) &&
        (tier === "all" || artifact.tiers.includes(tier)),
      ),
    [corpusId, format, languageId, manifest?.artifacts, tier],
  );
  const tiers = useMemo(
    () => [...new Set((manifest?.artifacts ?? []).flatMap((artifact) => artifact.tiers))].sort(),
    [manifest?.artifacts],
  );
  const formats = useMemo(
    () => [...new Set((manifest?.artifacts ?? []).map((artifact) => artifact.format))].sort(),
    [manifest?.artifacts],
  );
  const corpora = data.corpora.filter(
    (corpus) => languageId === "all" || corpus.languages.includes(languageId),
  );
  const corpusById = useMemo(
    () => new Map(data.corpora.map((corpus) => [corpus.id, corpus])),
    [data.corpora],
  );
  const languageById = useMemo(
    () => new Map(data.languages.map((language) => [language.id, language])),
    [data.languages],
  );
  const rightsById = useMemo(
    () => new Map(data.rights.entries.map((entry) => [entry.id, entry])),
    [data.rights.entries],
  );
  const visibleArtifacts = artifacts.slice(0, visibleCount);
  const unavailableCount = artifacts.filter((artifact) => !artifact.publishable).length;
  const hasActiveFilters = [format, languageId, corpusId, tier].some((value) => value !== "all");

  function clearFilters() {
    setFormat("all");
    setLanguageId("all");
    setCorpusId("all");
    setTier("all");
    setVisibleCount(PAGE_SIZE);
  }

  return (
    <div className="page-wrap">
      <PageIntro title={t("download.title")} lede={t("download.lede")} />
      {manifest && unavailableCount > 0 && (
        <p className="callout callout--warning">
          <strong>{tx("Some packages are not published yet.", "部分套件尚未發布。")}</strong>{" "}
          {tx(
            "Their metadata remains visible, but download links stay disabled until the release records a reviewed redistribution decision for every included corpus.",
            "其詮釋資料仍可查看，但在版本記錄所含各語料庫的再散布決定均經審查前，下載連結會維持停用。",
          )}
        </p>
      )}
      <div className="download-toolbar">
        <div className="download-release">
          <span>{tx("Release", "資料版本")} {manifest?.release_id ?? data.meta.release_id}</span>
          <code>{data.meta.source.commit.slice(0, 12)}</code>
        </div>
        <div className="download-results" aria-live="polite">
          <span><strong>{artifacts.length.toLocaleString()}</strong> {tx("packages", "個套件")}</span>
          {hasActiveFilters && (
            <button className="text-button" type="button" onClick={clearFilters}>
              {tx("Clear filters", "清除篩選")}
            </button>
          )}
        </div>
      </div>
      <div className="download-filters">
        <label className="field">
          {tx("Language", "語言")}
          <select
            value={languageId}
            onChange={(event) => {
              setLanguageId(event.target.value);
              setCorpusId("all");
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="all">{tx("All languages", "所有語言")}</option>
            {data.languages.map((language) => (
              <option key={language.id} value={language.id}>{language.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          {tx("Corpus", "語料庫")}
          <select
            value={corpusId}
            onChange={(event) => {
              setCorpusId(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="all">{tx("All corpora", "所有語料庫")}</option>
            {corpora.map((corpus) => (
              <option key={corpus.id} value={corpus.id}>{corpus.name}</option>
            ))}
          </select>
        </label>
        <label className="field">
          {tx("Tier", "層級")}
          <select
            value={tier}
            onChange={(event) => {
              setTier(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="all">{tx("All tiers", "所有層級")}</option>
            {tiers.map((value) => <option key={value}>{value}</option>)}
          </select>
        </label>
        <label className="field">
          {tx("Format", "格式")}
          <select
            value={format}
            onChange={(event) => {
              setFormat(event.target.value);
              setVisibleCount(PAGE_SIZE);
            }}
          >
            <option value="all">{tx("All formats", "所有格式")}</option>
            {formats.map((value) => (
              <option key={value} value={value}>{FORMAT_NAMES[value] ?? value}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="callout callout--error">
          {tx("Prepared artifact manifest unavailable:", "無法取得預備成品清單：")} {error}. {" "}
          {tx("Canonical XML remains available from the public FormosanBank repository.", "權威 XML 仍可從公開 FormosanBank 儲存庫取得。")}
        </p>
      )}
      <div className="artifact-list">
        {visibleArtifacts.map((artifact) => {
          const onlyCorpusId = artifact.corpus_ids.length === 1 ? artifact.corpus_ids[0] : undefined;
          const onlyLanguageId = artifact.language_ids.length === 1 ? artifact.language_ids[0] : undefined;
          const corpus = onlyCorpusId ? corpusById.get(onlyCorpusId) : undefined;
          const language = onlyLanguageId ? languageById.get(onlyLanguageId) : undefined;
          const rightsEntries = artifact.rights_ids.flatMap((id) => {
            const entry = rightsById.get(id);
            return entry ? [entry] : [];
          });
          return (
            <article className="artifact-card" key={artifact.path}>
              <div className="file-mark">{artifact.format.toUpperCase()}</div>
              <div className="artifact-card__body">
                <header className="artifact-card__header">
                  <div>
                    <h2>{artifactTitle(artifact, corpus?.name)}</h2>
                    <code>{fileName(artifact.path)}</code>
                  </div>
                  <div className="artifact-card__status">
                    <strong>{size(artifact.bytes)}</strong>
                    <span className={artifact.publishable ? "availability availability--ready" : "availability"}>
                      {artifact.publishable ? tx("Ready", "可下載") : tx("Not published", "尚未發布")}
                    </span>
                  </div>
                </header>
                <p className="artifact-card__scope">
                  {artifactScope(artifact, corpus?.name, language?.name)}
                </p>
                <div className="tier-list" aria-label={tx("Included tiers", "所含層級")}>
                  {artifact.tiers.map((value) => <span key={value}>{value}</span>)}
                </div>
                <div className="artifact-card__actions">
                  {artifact.publishable ? (
                    <a className="button button--primary" href={artifact.download_url}>
                      {tx("Download", "下載")}
                    </a>
                  ) : (
                    <span className="artifact-card__unavailable">
                      {tx("Download unavailable for this release", "此版本無法下載")}
                    </span>
                  )}
                  <details>
                    <summary>{tx("Technical details", "技術細節")}</summary>
                    <dl className="artifact-facts">
                      <div><dt>SHA-256</dt><dd><code>{artifact.sha256}</code></dd></div>
                      <div><dt>{tx("Release scope", "版本範圍")}</dt><dd><code>{artifact.scope}</code></dd></div>
                      {artifact.compression && (
                        <div>
                          <dt>{tx("Decoded file", "解碼後檔案")}</dt>
                          <dd>{artifact.content_bytes ? size(artifact.content_bytes) : tx("Size not reported", "未報告大小")}</dd>
                        </div>
                      )}
                    </dl>
                    <pre>
                      {`curl -L --fail --output '${fileName(artifact.path)}' '${artifact.download_url}'\n` +
                        `printf '%s  %s\\n' '${artifact.sha256}' '${fileName(artifact.path)}' | sha256sum --check -`}
                    </pre>
                  </details>
                  <details>
                    <summary>{tx("Citation and rights", "引用與權利")}</summary>
                    <p>
                      {tx("Built from FormosanBank commit", "由 FormosanBank 提交版本建立")} {" "}
                      <code>{data.meta.source.commit}</code>. {" "}
                      {tx("Cite every included corpus according to its source record.", "請依來源記錄引用每個所含語料庫。")}
                    </p>
                    <ul className="rights-list">
                      {rightsEntries.map((entry) => (
                        <li key={entry.id}>
                          <strong>{entry.corpus}</strong>
                          <span>{entry.license_expression ?? tx("License not established", "授權尚未確立")}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                  {!artifact.publishable && (
                    <details className="artifact-card__blocked">
                      <summary>{tx("Why is this unavailable?", "為何無法下載？")}</summary>
                      <p>
                        {tx(
                          `This package was held from release because ${artifact.blocked_reasons.length || artifact.rights_ids.length} included rights records had not cleared publication review when the release was built.`,
                          `此套件未隨版本發布，因版本建立時有 ${artifact.blocked_reasons.length || artifact.rights_ids.length} 筆所含權利記錄尚未通過發布審查。`,
                        )}
                      </p>
                    </details>
                  )}
                </div>
              </div>
            </article>
          );
        })}
      </div>
      {visibleCount < artifacts.length && (
        <div className="download-more">
          <button className="button" type="button" onClick={() => setVisibleCount((count) => count + PAGE_SIZE)}>
            {tx("Show more packages", "顯示更多套件")}
          </button>
          <span>{visibleCount.toLocaleString()} {tx("of", "／")} {artifacts.length.toLocaleString()}</span>
        </div>
      )}
      {!error && manifest && artifacts.length === 0 && (
        <div className="empty-state">
          {tx(
            "No prepared package matches every selected filter. Clear a filter or build a custom dataset in Research.",
            "沒有預備套件符合所有篩選條件。請清除篩選條件，或在研究工具中建立自訂資料集。",
          )}
        </div>
      )}
      <section className="format-guide">
        <h2>{tx("Choose a format", "選擇格式")}</h2>
        <div>
          <article>
            <h3>{tx("Canonical XML", "權威 XML")}</h3>
            <p>{tx("The authoritative hierarchy and exact source data.", "權威階層與完全相同的來源資料。")}</p>
          </article>
          <article>
            <h3>SQLite</h3>
            <p>{tx("A complete relational snapshot for SQL, R, Python, and Datasette.", "適用於 SQL、R、Python 與 Datasette 的完整關聯快照。")}</p>
          </article>
          <article>
            <h3>{tx("CSV, TSV, and XLSX", "CSV、TSV 與 XLSX")}</h3>
            <p>{tx("Flat tables for statistics and spreadsheet workflows.", "適用於統計與試算表工作流程的平面表格。")}</p>
          </article>
          <article>
            <h3>{tx("JSON Lines and Parquet", "JSON Lines 與 Parquet")}</h3>
            <p>{tx("Streaming records and efficient columnar research tables.", "串流記錄與高效的欄式研究表格。")}</p>
          </article>
        </div>
      </section>
    </div>
  );
}
