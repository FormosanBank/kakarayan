import {useEffect, useMemo, useState} from "react";

import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import {Link} from "../routing";
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

const CURATED_DOWNLOAD_PATHS = [
  "formosanbank.sqlite.gz",
  "prepared/csv-tables.zip",
  "prepared/flat-jsonl-tables.zip",
  "prepared/formosanbank-cldf.zip",
  "prepared/formosanbank.xlsx",
  "prepared/metadata-and-audio.zip",
  "prepared/parquet-tables.zip",
  "prepared/text-exports.zip",
  "prepared/time-aligned.zip",
  "prepared/tsv-tables.zip",
] as const;

const curatedOrder = new Map<string, number>(
  CURATED_DOWNLOAD_PATHS.map((path, index) => [path, index]),
);

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

export function Downloads({data}: {data: AppData}) {
  const {number, t, tx} = useI18n();
  const [manifest, setManifest] = useState<DownloadsCatalog | null>(null);
  const [error, setError] = useState("");

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
      (manifest?.artifacts ?? [])
        .filter((artifact) => curatedOrder.has(artifact.path))
        .sort(
          (left, right) =>
            (curatedOrder.get(left.path) ?? Number.MAX_SAFE_INTEGER) -
            (curatedOrder.get(right.path) ?? Number.MAX_SAFE_INTEGER),
        ),
    [manifest?.artifacts],
  );
  const rightsById = useMemo(
    () => new Map(data.rights.entries.map((entry) => [entry.id, entry])),
    [data.rights.entries],
  );
  const unavailableCount = artifacts.filter((artifact) => !artifact.publishable).length;
  const formatNames: Record<string, string> = {
    aligned: tx("time-aligned media", "時間對齊媒體"),
    cldf: tx("CLDF dataset", "CLDF 資料集"),
    csv: tx("CSV tables", "CSV 表格"),
    jsonl: tx("JSON Lines", "JSON Lines"),
    metadata: tx("metadata package", "詮釋資料套件"),
    parquet: tx("Parquet tables", "Parquet 表格"),
    sqlite: tx("SQLite database", "SQLite 資料庫"),
    text: tx("plain-text exports", "純文字匯出"),
    tsv: tx("TSV tables", "TSV 表格"),
    xlsx: tx("Excel workbook", "Excel 活頁簿"),
    xml: tx("canonical XML", "權威 XML"),
  };
  const tierNames: Record<string, string> = {
    text: tx("text", "文本"),
    sentence: tx("sentence", "句子"),
    word: tx("word", "詞"),
    morpheme: tx("morpheme", "語素"),
    form: tx("form", "形式"),
    phonology: tx("phonology", "音韻"),
    translation: tx("translation", "翻譯"),
    audio: tx("audio", "音訊"),
    language: tx("language", "語言"),
    metadata: tx("metadata", "詮釋資料"),
    token: tx("token", "詞元"),
  };

  function localizedArtifactTitle(artifact: Artifact): string {
    const formatName = formatNames[artifact.format] ?? artifact.format.toUpperCase();
    return tx(`Complete FormosanBank ${formatName}`, `完整 FormosanBank ${formatName}`);
  }

  function localizedArtifactScope(artifact: Artifact): string {
    return tx(
      `${number(artifact.language_ids.length)} languages · ${number(artifact.corpus_ids.length)} corpora`,
      `${number(artifact.language_ids.length)} 種語言 · ${number(artifact.corpus_ids.length)} 個語料庫`,
    );
  }

  return (
    <div className="page-wrap">
      <PageIntro title={t("download.title")} />
      {manifest && unavailableCount > 0 && (
        <p className="callout callout--warning">
          {tx(
            "Unavailable packages remain listed without download links until rights review is complete.",
            "未完成權利審查的套件仍會列出，但不提供下載連結。",
          )}
        </p>
      )}
      <div className="download-toolbar">
        <div className="download-release">
          <span>{tx("Release", "資料版本")} {manifest?.release_id ?? data.meta.release_id}</span>
          <code>{data.meta.source.commit.slice(0, 12)}</code>
        </div>
        <div className="download-results" aria-live="polite">
          <span><strong>{number(artifacts.length)}</strong> {tx("packages", "個套件")}</span>
          <Link className="button button--quiet" to="/research">
            {tx("Build a custom dataset", "建立自訂資料集")}
          </Link>
        </div>
      </div>
      {error && (
        <p className="callout callout--error">
          {tx("Prepared artifact manifest unavailable:", "無法取得預備成品清單：")} {error}. {" "}
          {tx("Canonical XML remains available from the public FormosanBank repository.", "權威 XML 仍可從公開 FormosanBank 儲存庫取得。")}
        </p>
      )}
      <div className="artifact-list">
        {artifacts.map((artifact) => {
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
                    <h2>{localizedArtifactTitle(artifact)}</h2>
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
                  {localizedArtifactScope(artifact)}
                </p>
                <div className="tier-list" aria-label={tx("Included tiers", "所含層級")}>
                  {artifact.tiers.map((value) => <span key={value}>{tierNames[value] ?? value}</span>)}
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
      {!error && manifest && artifacts.length === 0 && (
        <div className="empty-state">
          {tx(
            "Prepared packages are unavailable for this release. Build a custom dataset in Research.",
            "此資料版本沒有可用的預備套件。請在研究工具中建立自訂資料集。",
          )}
        </div>
      )}
    </div>
  );
}
