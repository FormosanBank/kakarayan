import type {ReactNode} from "react";

import {useI18n} from "../i18n";
import {NavLink} from "../routing";
import type {AppData} from "../types";
import {Diagnostics} from "./Diagnostics";

const navigation = [
  ["/learn", "nav.learn"],
  ["/explore", "nav.explore"],
  ["/downloads", "nav.download"],
  ["/developers", "nav.developers"],
  ["/models", "nav.models"],
  ["/about", "nav.about"],
] as const;

export function Layout({data, children}: {data: AppData; children: ReactNode}) {
  const {locale, setLocale, t} = useI18n();
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label="Kakarayan home">
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <span>
            <strong>Kakarayan</strong>
            <small>FormosanBank</small>
          </span>
        </NavLink>
        <nav className="primary-nav" aria-label="Primary">
          {navigation.map(([to, key]) => (
            <NavLink key={to} to={to}>
              {t(key)}
            </NavLink>
          ))}
        </nav>
        <div className="topbar-tools">
          <span className="release-pill" title={data.meta.source.commit}>
            {data.meta.release_id}
          </span>
          <label className="locale-picker">
            <span className="sr-only">Interface language</span>
            <select
              value={locale}
              onChange={(event) => setLocale(event.target.value as "en" | "zh-Hant")}
            >
              <option value="en">EN</option>
              <option value="zh-Hant">繁中</option>
            </select>
          </label>
        </div>
      </header>
      <main id="main">{children}</main>
      <footer className="footer">
        <div>
          <strong>Kakarayan</strong>
          <p>Public Formosan language resources for research, learning, and revitalization.</p>
        </div>
        <div>
          <span>{t("common.release")}</span>
          <code>{data.meta.release_id}</code>
        </div>
        <div>
          <span>{t("common.source")}</span>
          <a
            href={`https://github.com/FormosanBank/FormosanBank/commit/${data.meta.source.commit}`}
          >
            <code>{data.meta.source.commit.slice(0, 12)}</code>
          </a>
        </div>
        <Diagnostics releaseId={data.meta.release_id} />
      </footer>
    </div>
  );
}

export function PageIntro({
  eyebrow,
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede: string;
}) {
  return (
    <header className="page-intro">
      {eyebrow && <p className="eyebrow">{eyebrow}</p>}
      <h1>{title}</h1>
      <p>{lede}</p>
    </header>
  );
}

export function Stat({
  value,
  label,
  tone = "ink",
}: {
  value: number | string;
  label: string;
  tone?: "ink" | "coral" | "gold" | "moss";
}) {
  return (
    <div className={`stat stat--${tone}`}>
      <strong>{typeof value === "number" ? new Intl.NumberFormat().format(value) : value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({value}: {value: string}) {
  return <span className={`status status--${value.replaceAll("_", "-")}`}>{value}</span>;
}
