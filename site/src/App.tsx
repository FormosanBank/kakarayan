import {useEffect} from "react";

import {Layout} from "./components/Layout";
import {Diagnostics} from "./components/Diagnostics";
import {useAppData} from "./data";
import {useI18n} from "./i18n";
import {About} from "./pages/About";
import {CorpusDetail, LanguageDetail} from "./pages/CatalogueDetail";
import {Developers} from "./pages/Developers";
import {Dictionary} from "./pages/Dictionary";
import {Downloads} from "./pages/Downloads";
import {Explore} from "./pages/Explore";
import {Home} from "./pages/Home";
import {Learn} from "./pages/Learn";
import {Models} from "./pages/Models";
import {Research} from "./pages/Research";
import {Sentences} from "./pages/Sentences";
import {Link, RoutingProvider, useRoutePath} from "./routing";

function Loading() {
  const {t} = useI18n();
  return (
    <main className="boot-state" aria-live="polite">
      <div className="boot-mark">K</div>
      <p>{t("common.loading")}</p>
    </main>
  );
}

function Unavailable({error, retry}: {error: Error; retry: () => void}) {
  const {t, tx} = useI18n();
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
      <Diagnostics releaseId={null} error={error} />
      <div className="button-row">
        <button className="button button--primary" onClick={retry}>
          {t("common.retry")}
        </button>
        <a className="button button--quiet" href="https://github.com/FormosanBank/FormosanBank">
          {tx("Open canonical public XML", "開啟權威公開 XML")}
        </a>
      </div>
    </main>
  );
}

function NotFound() {
  const {tx} = useI18n();
  return (
    <div className="page-wrap page-wrap--prose">
      <p className="eyebrow">404</p>
      <h1>{tx("Page not found", "找不到頁面")}</h1>
      <p>{tx("Return home or open the dictionary.", "請返回首頁或開啟單詞查詢。")}</p>
      <div className="button-row">
        <Link className="button button--primary" to="/">
          {tx("Home", "首頁")}
        </Link>
        <Link className="button button--quiet" to="/dictionary">
          {tx("Dictionary", "單詞查詢")}
        </Link>
      </div>
    </div>
  );
}

export function App() {
  const state = useAppData();
  useEffect(() => {
    if (!state.data || !("serviceWorker" in navigator)) return;
    const url = `${import.meta.env.BASE_URL}sw.js?v=${encodeURIComponent(state.data.meta.release_id)}`;
    navigator.serviceWorker.register(url).catch(() => {
      // Offline support is additive. The core site remains usable without registration.
    });
  }, [state.data]);
  if (state.loading) return <Loading />;
  if (!state.data || state.error) {
    return <Unavailable error={state.error ?? new Error("No release data")} retry={state.reload} />;
  }
  return <RoutedApp data={state.data} />;
}

function RoutedApp({data}: {data: NonNullable<ReturnType<typeof useAppData>["data"]>}) {
  return (
    <RoutingProvider>
      <RouteContent data={data} />
    </RoutingProvider>
  );
}

function RouteContent({data}: {data: NonNullable<ReturnType<typeof useAppData>["data"]>}) {
  const path = useRoutePath();
  const {locale, t, tx} = useI18n();
  const detailName = path.startsWith("/languages/")
    ? data.languages.find(
        (item) => item.id === decodeURIComponent(path.slice("/languages/".length)),
      )?.name
    : path.startsWith("/corpora/")
      ? data.corpora.find(
          (item) => item.id === decodeURIComponent(path.slice("/corpora/".length)),
        )?.name
      : undefined;
  const routeTitle =
    detailName ??
    ({
      "/": t("home.title"),
      "/learn": t("learn.title"),
      "/explore": t("explore.title"),
      "/dictionary": tx("Dictionary", "單詞查詢"),
      "/sentences": tx("Sentence search", "例句搜尋"),
      "/search": tx("Sentence search", "例句搜尋"),
      "/research": tx("Research tools", "研究工具"),
      "/downloads": t("download.title"),
      "/developers": t("developers.title"),
      "/models": t("models.title"),
      "/about": t("about.title"),
    }[path] ??
      tx("Page not found", "找不到頁面"));
  const routeDescription =
    path === "/dictionary"
      ? tx(
          "Look up a Formosan word and choose the translation language.",
          "查詢臺灣南島語單詞，並選擇翻譯語言。",
        )
      : path === "/sentences" || path === "/search"
      ? t("search.lede")
      : path === "/learn"
        ? t("learn.lede")
        : path === "/downloads"
          ? t("download.lede")
          : t("home.lede");
  useEffect(() => {
    document.title = `${routeTitle} | Kakarayan`;
    document.querySelector('meta[name="description"]')?.setAttribute("content", routeDescription);
    document.querySelector('meta[property="og:title"]')?.setAttribute("content", routeTitle);
    document
      .querySelector('meta[property="og:description"]')
      ?.setAttribute("content", routeDescription);
    document
      .querySelector('meta[property="og:locale"]')
      ?.setAttribute("content", locale === "zh-Hant" ? "zh_TW" : "en_US");
    document
      .querySelector('meta[name="robots"]')
      ?.setAttribute(
        "content",
        `${["/dictionary", "/sentences", "/search"].includes(path) ? "noindex" : "index"},follow,noai,noimageai`,
      );
  }, [locale, path, routeDescription, routeTitle]);
  const page = (() => {
    if (path.startsWith("/languages/")) {
      const id = decodeURIComponent(path.slice("/languages/".length));
      const language = data.languages.find((item) => item.id === id);
      return language ? <LanguageDetail data={data} language={language} /> : <NotFound />;
    }
    if (path.startsWith("/corpora/")) {
      const id = decodeURIComponent(path.slice("/corpora/".length));
      const corpus = data.corpora.find((item) => item.id === id);
      return corpus ? <CorpusDetail data={data} corpus={corpus} /> : <NotFound />;
    }
    switch (path) {
      case "/":
        return <Home data={data} />;
      case "/learn":
        return <Learn data={data} />;
      case "/explore":
        return <Explore data={data} />;
      case "/dictionary":
        return <Dictionary data={data} />;
      case "/sentences":
      case "/search":
        return <Sentences data={data} />;
      case "/research":
        return <Research data={data} />;
      case "/downloads":
        return <Downloads data={data} />;
      case "/developers":
        return <Developers data={data} />;
      case "/models":
        return <Models data={data} />;
      case "/about":
        return <About data={data} />;
      default:
        return <NotFound />;
    }
  })();
  return <Layout data={data}>{page}</Layout>;
}
