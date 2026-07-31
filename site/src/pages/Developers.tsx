import {PageIntro} from "../components/Layout";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

const endpoints = [
  ["meta.json", "Release, schema, and pinned source commit"],
  ["languages.json", "Display identities, capabilities, and counts"],
  ["corpora.json", "Corpus scopes, rights IDs, and counts"],
  ["rights.json", "Central and per-corpus rights policy"],
  ["models.json", "Public MT/ASR models and service registry"],
  ["orthography.json", "Reviewed conversion-table projections"],
  ["search/manifest.json", "Immutable browser search shards"],
];

export function Developers({data}: {data: AppData}) {
  const {t} = useI18n();
  const base = `${window.location.origin}${import.meta.env.BASE_URL}api/v1`;
  const liveApi = import.meta.env.VITE_LIVE_API_URL as string | undefined;
  return (
    <div className="page-wrap">
      <PageIntro title={t("developers.title")} lede={t("developers.lede")} />
      <section className="api-choice">
        <article className="api-choice__primary">
          <p className="eyebrow">Always available with the site</p>
          <h2>Static API v1</h2>
          <p>
            Best for catalogues, reproducible release metadata, manifests, and applications
            that can query local SQLite or shards.
          </p>
          <code>{base}/meta.json</code>
          <span className="status status--available">release-pinned</span>
        </article>
        <article>
          <p className="eyebrow">Optional no-cost service</p>
          <h2>Live REST API</h2>
          <p>
            Convenient bounded dictionary and concordance routes over the same release
            snapshot. The service may sleep. Static access remains canonical.
          </p>
          <code>{liveApi ?? "Not configured for this release"}</code>
          <span className={`status status--${liveApi ? "unchecked" : "unavailable"}`}>
            {liveApi ? "best effort" : "not deployed"}
          </span>
        </article>
      </section>
      <section className="endpoint-section">
        <div className="section-heading">
          <p className="eyebrow">Static contract</p>
          <h2>Public JSON endpoints</h2>
        </div>
        <div className="endpoint-list">
          {endpoints.map(([path, description]) => (
            <article key={path}>
              <code>GET /api/v1/{path}</code>
              <p>{description}</p>
              <a href={`${import.meta.env.BASE_URL}api/v1/${path}`}>Open JSON</a>
            </article>
          ))}
        </div>
      </section>
      <section className="code-samples">
        <div>
          <p className="eyebrow">Browser</p>
          <pre>
            <code>{`const release = await fetch(
  "${base}/meta.json"
).then(r => r.json());

console.log(release.release_id);`}</code>
          </pre>
        </div>
        <div>
          <p className="eyebrow">Python</p>
          <pre>
            <code>{`from urllib.request import urlopen
import json

with urlopen("${base}/languages.json") as r:
    languages = json.load(r)`}</code>
          </pre>
        </div>
        <div>
          <p className="eyebrow">R</p>
          <pre>
            <code>{`languages <- jsonlite::fromJSON(
  "${base}/languages.json"
)
languages[, c("id", "name", "iso639_3")]`}</code>
          </pre>
        </div>
      </section>
      <section className="contract-notes">
        <h2>Contract rules</h2>
        <ul>
          <li>Pin <code>{data.meta.release_id}</code> and source commit in published work.</li>
          <li>Do not key display languages by ISO alone. Seediq and Truku share <code>trv</code>.</li>
          <li>Keep original and FormosanBank standard forms in separate fields.</li>
          <li>Follow every rights ID referenced by a downloaded artifact.</li>
          <li>Verify SHA-256 before loading a release SQLite snapshot.</li>
        </ul>
      </section>
    </div>
  );
}
