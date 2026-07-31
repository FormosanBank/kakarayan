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
  const {locale, setLocale, t, tx} = useI18n();
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {t("nav.skip")}
      </a>
      <header className="topbar">
        <NavLink className="brand" to="/" aria-label={tx("Kakarayan home", "Kakarayan 首頁")}>
          <span className="brand-mark" aria-hidden="true">
            K
          </span>
          <span>
            <strong>Kakarayan</strong>
            <small>FormosanBank</small>
          </span>
        </NavLink>
        <nav className="primary-nav" aria-label={tx("Primary", "主要導覽")}>
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
            <span className="sr-only">{tx("Interface language", "介面語言")}</span>
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
          <p>{t("footer.summary")}</p>
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
  const {number} = useI18n();
  return (
    <div className={`stat stat--${tone}`}>
      <strong>{typeof value === "number" ? number(value) : value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function StatusBadge({value}: {value: string}) {
  const {tx} = useI18n();
  const labels: Record<string, string> = {
    allowed: tx("allowed", "允許"),
    available: tx("available", "可用"),
    unavailable: tx("unavailable", "不可用"),
    unchecked: tx("unchecked", "未檢查"),
    review_required: tx("review required", "需要審查"),
    denied: tx("denied", "不允許"),
    unknown: tx("unknown", "未知"),
  };
  return (
    <span className={`status status--${value.replaceAll("_", "-")}`}>
      {labels[value] ?? value}
    </span>
  );
}
