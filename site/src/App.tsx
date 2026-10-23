import {Component, useEffect, useRef, useState, type PropsWithChildren, type ReactNode} from "react";

import {Layout} from "./components/Layout";
import {Diagnostics} from "./components/Diagnostics";
import {LoadingState} from "./components/LoadingState";
import {ResourceRetryContext, useAppData} from "./data";
import {StudyDeck} from "./components/StudyDeck";
import {SiteUpdate} from "./components/SiteUpdate";
import {DOCS_BASE_URL} from "./docs";
import {useI18n} from "./i18n";
import {About} from "./pages/About";
import {CorpusDetail, LanguageDetail} from "./pages/CatalogueDetail";
import {Developers} from "./pages/Developers";
import {Downloads} from "./pages/Downloads";
import {Explore} from "./pages/Explore";
import {Guide} from "./pages/Guide";
import {Home} from "./pages/Home";
import {Learn} from "./pages/Learn";
import {Lookup} from "./pages/Lookup";
import {Models} from "./pages/Models";
import {Research} from "./pages/Research";
import {routeHref} from "./routePaths";
import {Link, RoutingProvider, useRoutePath} from "./routing";

function decodedId(value: string): string {
  try { return decodeURIComponent(value); } catch { return ""; }
}

function Loading() {
  const {t} = useI18n();
  return (
    <main className="boot-state">
      <LoadingState kind="page" label={t("common.loading")} />
    </main>
  );
}

function Unavailable({error, retry}: {error: Error; retry: () => void}) {
  const {t, tx} = useI18n();
  const [showDeck, setShowDeck] = useState(false);
  return (
    <main className="boot-state boot-state--error">
      <div className="boot-mark">K</div>
      <h1>{t("common.unavailable")}</h1>
      <p>
        {tx(
          "Kakarayan did not load a consistent public release. No partial or mismatched data is shown.",
          "Kakarayan 無法載入一致的公開版本，因此不會顯示部分或不相符的資料。",
        )}
      </p>
      <code>{error.message}</code>
      <Diagnostics meta={null} error={error} />
      <div className="button-row">
        <button className="button button--primary" onClick={retry}>
          {t("common.retry")}
        </button>
        <a className="button button--quiet" href="https://github.com/FormosanBank/FormosanBank">
          {tx("Open canonical public XML", "開啟權威公開 XML")}
        </a>
        <button className="button button--quiet" onClick={() => setShowDeck((value) => !value)}>
          {tx("Local study deck", "本機學習牌組")}
        </button>
        <a className="button button--quiet" href={`${DOCS_BASE_URL}/`}>
          {tx("Docs", "文件")}
        </a>
      </div>
      {showDeck && <StudyDeck currentRelease="" languageId="" dialect="" />}
    </main>
  );
}

function NotFound() {
  const {tx} = useI18n();
  return (
    <div className="page-wrap page-wrap--prose">
      <p className="eyebrow">404</p>
      <h1>{tx("Page not found", "找不到頁面")}</h1>
      <p>{tx("Return home or open corpus lookup.", "請返回首頁或開啟語料查詢。")}</p>
      <div className="button-row">
        <Link className="button button--primary" to="/">
          {tx("Home", "首頁")}
        </Link>
        <Link className="button button--quiet" to="/lookup">
          {tx("Corpus lookup", "語料查詢")}
        </Link>
      </div>
    </div>
  );
}

export function App() {
  const state = useAppData();
  const {t} = useI18n();
  return <RoutingProvider>
    <SiteUpdate />
    {state.loading ? <Loading /> : !state.data
      ? <Unavailable error={state.error ?? new Error("No release data")} retry={state.reload} />
      : <ResourceRetryContext.Provider value={state.retryResource}>
        {state.error && <div className="callout callout--warning" role="status">
          {state.error.message} <button onClick={state.reload}>{t("common.retry")}</button>
        </div>}
        <RouteContent data={state.data} />
      </ResourceRetryContext.Provider>}
  </RoutingProvider>;
}

interface Route {
  title: string;
  description?: string;
  page: ReactNode;
}

function RouteContent({data}: {data: NonNullable<ReturnType<typeof useAppData>["data"]>}) {
  const path = useRoutePath();
  const previousPath = useRef(path);
  const {locale, t, tx} = useI18n();
  const routes: Record<string, Route> = {
    "/": {title: t("home.title"), page: <Home data={data} />},
    "/learn": {title: t("learn.title"), description: t("learn.lede"), page: <Learn data={data} />},
    "/explore": {title: t("explore.title"), page: <Explore data={data} />},
    "/lookup": {
      title: tx("Dictionary and sentences", "單詞釋義與語境例句"),
      description: tx(
        "Switch between dictionary meanings and sentences in context over the same public corpus data.",
        "在同一套公開語料資料中切換單詞釋義與語境例句。",
      ),
      page: <Lookup data={data} />,
    },
    "/research": {title: tx("Research tools", "研究工具"), page: <Research data={data} />},
    "/docs": {
      title: tx("Docs", "文件"),
      description: tx(
        "Browse FormosanBank corpus, format, rights, and developer documentation.",
        "瀏覽 FormosanBank 語料、格式、權利與開發者文件。",
      ),
      page: <Guide data={data} />,
    },
    "/downloads": {title: t("download.title"), description: t("download.lede"), page: <Downloads data={data} />},
    "/developers": {title: t("developers.title"), page: <Developers data={data} />},
    "/models": {title: t("models.title"), page: <Models data={data} />},
    "/about": {title: t("about.title"), page: <About data={data} />},
  };
  const language = path.startsWith("/languages/")
    ? data.languages.find((item) => item.id === decodedId(path.slice("/languages/".length)))
    : undefined;
  const corpus = path.startsWith("/corpora/")
    ? data.corpora.find((item) => item.id === decodedId(path.slice("/corpora/".length)))
    : undefined;
  const route: Route = language
    ? {title: language.name, page: <LanguageDetail data={data} language={language} />}
    : corpus
      ? {title: corpus.name, page: <CorpusDetail data={data} corpus={corpus} />}
      : routes[path] ?? {title: tx("Page not found", "找不到頁面"), page: <NotFound />};
  const routeTitle = route.title;
  const routeDescription = route.description ?? t("home.lede");
  useEffect(() => {
    const canonicalUrl = new URL(routeHref(path), window.location.origin).href;
    document.title = `${routeTitle} | Kakarayan`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", routeDescription);
    document.querySelector('link[rel="canonical"]')?.setAttribute("href", canonicalUrl);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", routeTitle);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", routeDescription);
    document.querySelector('meta[property="og:url"]')?.setAttribute("content", canonicalUrl);
    document
      .querySelector('meta[property="og:locale"]')
      ?.setAttribute("content", locale === "zh-Hant" ? "zh_TW" : "en_US");
    document
      .querySelector('meta[name="robots"]')
      ?.setAttribute("content", `${path === "/lookup" ? "noindex" : "index"},follow,noai,noimageai`);
  }, [locale, path, routeDescription, routeTitle]);
  useEffect(() => {
    if (previousPath.current !== path) document.getElementById("main")?.focus({preventScroll: true});
    window.scrollTo({top: 0, left: 0, behavior: "instant"});
    previousPath.current = path;
  }, [path]);
  const page = route.page;
  return <Layout data={data}><PageBoundary key={path}>{page}</PageBoundary></Layout>;
}

class PageBoundary extends Component<PropsWithChildren, {failed: boolean}> {
  state = {failed: false};
  static getDerivedStateFromError() { return {failed: true}; }
  render() {
    return this.state.failed
      ? <PageFailure retry={() => this.setState({failed: false})} />
      : this.props.children;
  }
}

function PageFailure({retry}: {retry: () => void}) {
  const {tx} = useI18n();
  return <section className="page-wrap" role="alert">
    <h1>{tx("This tool could not be displayed", "無法顯示此工具")}</h1>
    <div className="button-row">
      <button className="button button--primary" onClick={retry}>{tx("Retry", "重試")}</button>
      <Link className="button button--quiet" to="/">{tx("Home", "首頁")}</Link>
    </div>
  </section>;
}
