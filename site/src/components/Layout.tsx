import {useRef, type ReactNode} from "react";

import {useI18n} from "../i18n";
import {NavLink} from "../routing";
import type {AppData} from "../types";
import {Diagnostics} from "./Diagnostics";

const navigation = [
  ["/lookup", "nav.lookup"],
  ["/learn", "nav.learn"],
  ["/research", "nav.research"],
  ["/guide", "nav.guide"],
  ["/downloads", "nav.download"],
  ["/developers", "nav.developers"],
] as const;

const resourceNavigation = [
  ["/explore", "nav.explore"],
  ["/models", "nav.models"],
] as const;

export function Layout({data, children}: {data: AppData; children: ReactNode}) {
  const {locale, setLocale, t, tx} = useI18n();
  const mobileMenu = useRef<HTMLDetailsElement>(null);
  const closeMobileMenu = () => mobileMenu.current?.removeAttribute("open");
  return (
    <div className="site-shell">
      <a className="skip-link" href="#main">
        {t("nav.skip")}
      </a>
      <header className="topbar">
        <div className="topbar__inner">
          <NavLink className="brand" to="/" aria-label={tx("Kakarayan home", "Kakarayan 首頁")}>
            <span className="brand-mark" aria-hidden="true">K</span>
            <strong>Kakarayan</strong>
          </NavLink>
          <nav className="primary-nav" aria-label={tx("Primary", "主要導覽")}>
            {navigation.map(([to, key]) => (
              <NavLink key={to} to={to}>{t(key)}</NavLink>
            ))}
          </nav>
          <div className="topbar-tools">
            <div
              className="locale-switch"
              role="group"
              aria-label={tx("Interface language", "介面語言")}
            >
              <button
                type="button"
                aria-label={tx("English", "英文")}
                aria-pressed={locale === "en"}
                onClick={() => setLocale("en")}
              >
                EN
              </button>
              <button
                type="button"
                aria-label={tx("Traditional Chinese", "繁體中文")}
                aria-pressed={locale === "zh-Hant"}
                onClick={() => setLocale("zh-Hant")}
              >
                繁中
              </button>
            </div>
            <a className="button button--primary topbar-github" href="https://github.com/FormosanBank/FormosanBank">
              GitHub
            </a>
          </div>
          <details className="mobile-menu" ref={mobileMenu}>
            <summary aria-label={tx("Open navigation", "開啟導覽")}>
              <span aria-hidden="true" />
              <span aria-hidden="true" />
            </summary>
            <nav aria-label={tx("Primary", "主要導覽")}>
              {navigation.map(([to, key]) => (
                <NavLink key={to} to={to} onClick={closeMobileMenu}>{t(key)}</NavLink>
              ))}
              {resourceNavigation.map(([to, key]) => (
                <NavLink key={to} to={to} onClick={closeMobileMenu}>{t(key)}</NavLink>
              ))}
              <NavLink to="/about" onClick={closeMobileMenu}>{t("nav.about")}</NavLink>
            </nav>
          </details>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {children}
      </main>
      <footer className="footer">
        <div className="footer__inner">
          <div className="footer__brand">
            <strong>Kakarayan</strong>
            <span className="release-pill">{data.meta.release_id}</span>
          </div>
          <nav aria-label={tx("Footer", "頁尾")}>
            <NavLink to="/explore">{t("nav.explore")}</NavLink>
            <NavLink to="/models">{t("nav.models")}</NavLink>
            <NavLink to="/downloads">{t("nav.download")}</NavLink>
            <NavLink to="/developers">{t("nav.developers")}</NavLink>
            <NavLink to="/guide">{t("nav.guide")}</NavLink>
            <NavLink to="/about">{t("nav.about")}</NavLink>
            <a href="https://github.com/FormosanBank/kakarayan">GitHub</a>
            <a href={`https://github.com/FormosanBank/FormosanBank/commit/${data.meta.source.commit}`}>
              {t("common.source")} <code>{data.meta.source.commit.slice(0, 7)}</code>
            </a>
          </nav>
          <Diagnostics releaseId={data.meta.release_id} />
        </div>
      </footer>
    </div>
  );
}

export function PageIntro({
  title,
  lede,
}: {
  eyebrow?: string;
  title: string;
  lede?: string;
}) {
  return (
    <header className={`page-intro${lede ? "" : " page-intro--title-only"}`}>
      <h1>{title}</h1>
      {lede && <p>{lede}</p>}
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
    sleeping: tx("sleeping", "休眠中"),
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
