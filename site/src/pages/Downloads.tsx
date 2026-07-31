import {useEffect, useMemo, useState} from "react";

import {PageIntro, StatusBadge} from "../components/Layout";
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
  const {t, tx} = useI18n();
  const [params] = useSearchParams();
  const [manifest, setManifest] = useState<DownloadsCatalog | null>(null);
  const [error, setError] = useState("");
  const [format, setFormat] = useState(params.get("format") ?? "all");
  const [languageId, setLanguageId] = useState(params.get("language") ?? "all");
  const [corpusId, setCorpusId] = useState(params.get("corpus") ?? "all");
  const [tier, setTier] = useState(params.get("tier") ?? "all");
  useEffect(() => {
    const controller = new AbortController();
    fetch(`${import.meta.env.BASE_URL}api/v1/downloads.json`, {
      signal: controller.signal,
    })
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
      (manifest?.artifacts ?? []).filter((artifact) => {
        return (
          (format === "all" || artifact.format === format) &&
          (languageId === "all" || artifact.language_ids.includes(languageId)) &&
          (corpusId === "all" || artifact.corpus_ids.includes(corpusId)) &&
          (tier === "all" || artifact.tiers.includes(tier))
        );
      }),
    [corpusId, format, languageId, manifest?.artifacts, tier],
  );
  const tiers = useMemo(
    () =>
      [
        ...new Set((manifest?.artifacts ?? []).flatMap((artifact) => artifact.tiers)),
      ].sort(),
    [manifest?.artifacts],
  );
  const formats = useMemo(
    () =>
      [
        ...new Set((manifest?.artifacts ?? []).map((artifact) => artifact.format)),
      ].sort(),
    [manifest?.artifacts],
  );
  const corpora = data.corpora.filter(
    (corpus) => languageId === "all" || corpus.languages.includes(languageId),
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
          <strong>{tx("Choose by use", "依用途選擇")}</strong>
          <p>{tx("SQLite for local query, JSONL for streams, CSV for tables, XML for canon.", "SQLite 適合本機查詢，JSONL 適合串流，CSV 適合表格，XML 則是權威格式。")}</p>
        </div>
        <div>
          <span>2</span>
          <strong>{tx("Pin the release", "固定資料版本")}</strong>
          <p>{tx("Every artifact names the public source commit and immutable release.", "每個成品都標明公開來源提交與不可變的資料版本。")}</p>
        </div>
        <div>
          <span>3</span>
          <strong>{tx("Carry the notice", "保留權利聲明")}</strong>
          <p>{tx("Corpus and component rights remain attached to every derived package.", "每個衍生套件都保留語料庫及各組件的權利資訊。")}</p>
        </div>
      </div>
      {hasUnreviewedRights && (
        <p className="callout callout--warning">
          <strong>{tx("Rights review is still in progress.", "權利審查仍在進行中。")}</strong>{" "}
          {tx(
            "Prepared projected tables are shown for technical inspection. Do not assume that public repository visibility grants uniform redistribution or commercial rights. Follow each corpus notice.",
            "預備投影表僅供技術檢查。請勿假設公開儲存庫的可見性就授予一致的再散布或商業權利，並應遵守各語料庫聲明。",
          )}
        </p>
      )}
      <div className="download-toolbar">
        <div>
          <span>{manifest?.release_id ?? data.meta.release_id}</span>
          <code>{data.meta.source.commit.slice(0, 12)}</code>
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
            }}
          >
            <option value="all">{tx("All languages", "所有語言")}</option>
            {data.languages.map((language) => (
              <option key={language.id} value={language.id}>
                {language.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {tx("Corpus", "語料庫")}
          <select value={corpusId} onChange={(event) => setCorpusId(event.target.value)}>
            <option value="all">{tx("All corpora", "所有語料庫")}</option>
            {corpora.map((corpus) => (
              <option key={corpus.id} value={corpus.id}>
                {corpus.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {tx("Tier", "層級")}
          <select value={tier} onChange={(event) => setTier(event.target.value)}>
            <option value="all">{tx("All tiers", "所有層級")}</option>
            {tiers.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
        <label className="field">
          {tx("Format", "格式")}
          <select value={format} onChange={(event) => setFormat(event.target.value)}>
            <option value="all">{tx("All prepared formats", "所有預備格式")}</option>
            {formats.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      {error && (
        <p className="callout callout--error">
          {tx("Prepared artifact manifest unavailable:", "無法取得預備成品清單：")} {error}。
          {tx("Canonical XML remains available from the public FormosanBank repository.", "權威 XML 仍可從公開 FormosanBank 儲存庫取得。")}
        </p>
      )}
      <div className="artifact-list">
        {artifacts.map((artifact) => (
          <article key={artifact.path}>
            <div className="file-mark">{artifact.path.split(".").pop()?.toUpperCase()}</div>
            <div>
              <h2>{artifact.path}</h2>
              <p>
                {artifact.format} · {artifact.tiers.join(", ")}
              </p>
              <code title={artifact.sha256}>sha256 {artifact.sha256.slice(0, 20)}…</code>
              <details>
                <summary>{tx("Command line and checksum", "命令列與校驗碼")}</summary>
                <pre>
                  {`curl -L --fail --output '${artifact.path.split("/").pop()}' '${artifact.download_url}'\n` +
                    `printf '%s  %s\\n' '${artifact.sha256}' '${artifact.path.split("/").pop()}' | sha256sum --check -`}
                </pre>
              </details>
              <details>
                <summary>{tx("Citation, scope, and rights", "引用、範圍與權利")}</summary>
                <p>
                  {tx("Scope:", "範圍：")} <code>{artifact.scope}</code>。
                  {tx("Source commit", "來源提交")}{" "}
                  <code>{data.meta.source.commit}</code>。{tx("Release", "資料版本")}{" "}
                  <code>{manifest?.release_id}</code>.
                </p>
                {artifact.compression && (
                  <p>
                    {tx("Compression:", "壓縮：")} {artifact.compression}。
                    {tx("Decoded size", "解碼後大小")}{" "}
                    {artifact.content_bytes ? size(artifact.content_bytes) : tx("not reported", "未報告")}；
                    {tx("decoded SHA-256", "解碼後 SHA-256")}{" "}
                    <code>{artifact.content_sha256 ?? tx("not reported", "未報告")}</code>。
                  </p>
                )}
                <ul>
                  {artifact.rights_ids.map((id) => {
                    const rights = data.rights.entries.find((entry) => entry.id === id);
                    return (
                      <li key={id}>
                        <code>{id}</code>:{" "}
                        {rights?.attribution || tx("No reviewed attribution statement", "無經審查的署名聲明")}；
                        {tx("license", "授權")}{" "}
                        {rights?.license_expression ?? tx("not established", "尚未確立")}。
                      </li>
                    );
                  })}
                </ul>
              </details>
            </div>
            <div>
              <strong>{size(artifact.bytes)}</strong>
              <StatusBadge value={artifact.publishable ? "allowed" : "review_required"} />
              {artifact.publishable ? (
                <a
                  className="button button--primary"
                  href={artifact.download_url}
                >
                  {tx("Download", "下載")}
                </a>
              ) : (
                <>
                  <button className="button button--primary" disabled>
                    {tx("Rights review required", "需要權利審查")}
                  </button>
                  <small>{artifact.blocked_reasons.join("; ")}</small>
                </>
              )}
            </div>
          </article>
        ))}
      </div>
      {!error && manifest && artifacts.length === 0 && (
        <div className="empty-state">
          {tx(
            "No prepared package matches every selected facet. Clear a filter or build a bounded browser selection in Research.",
            "沒有預備套件符合所有選定條件。請清除篩選條件，或在研究工具中建立有界限的瀏覽器資料選集。",
          )}
        </div>
      )}
      <section className="format-guide">
        <h2>{tx("Format guide", "格式指南")}</h2>
        <div>
          <article>
            <h3>{tx("Canonical XML", "權威 XML")}</h3>
            <p>
              {tx(
                "The authoritative hierarchy and exact source bytes. Obtain from the pinned public FormosanBank tree while package rights review is pending.",
                "保留權威階層與完全相同的來源位元組。套件權利審查期間，請從固定版本的公開 FormosanBank 樹狀目錄取得。",
              )}
            </p>
          </article>
          <article>
            <h3>SQLite</h3>
            <p>
              {tx(
                "Gzip-compressed portable relational snapshot for SQL, R, Python, Datasette, and local APIs.",
                "以 Gzip 壓縮的可攜式關聯快照，適用於 SQL、R、Python、Datasette 與本機 API。",
              )}
            </p>
          </article>
          <article>
            <h3>{tx("JSON Lines", "JSON 行格式")}</h3>
            <p>{tx("One record per line for streaming, shell pipelines, and document tools.", "每行一筆記錄，適合串流、命令列管線與文件工具。")}</p>
          </article>
          <article>
            <h3>{tx("Parquet and XLSX", "Parquet 與 XLSX")}</h3>
            <p>
              {tx("Columnar research tables and a spreadsheet-safe, human-oriented workbook.", "欄式研究表格，以及適合試算表且方便人員閱讀的活頁簿。")}
            </p>
          </article>
          <article>
            <h3>{tx("CLDF and aligned media", "CLDF 與對齊媒體")}</h3>
            <p>
              {tx(
                "Conservative CLDF examples plus EAF, TextGrid, WebVTT, and SRT only where valid timings exist.",
                "保守映射的 CLDF 例句，以及僅在具備有效時間資訊時提供的 EAF、TextGrid、WebVTT 與 SRT。",
              )}
            </p>
          </article>
        </div>
      </section>
    </div>
  );
}
