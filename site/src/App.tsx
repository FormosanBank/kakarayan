import {useEffect} from "react";

import {Layout} from "./components/Layout";
import {useAppData} from "./data";
import {useI18n} from "./i18n";
import {About} from "./pages/About";
import {Developers} from "./pages/Developers";
import {Downloads} from "./pages/Downloads";
import {Explore} from "./pages/Explore";
import {Home} from "./pages/Home";
import {Learn} from "./pages/Learn";
import {Models} from "./pages/Models";
import {Research} from "./pages/Research";
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
  const {t} = useI18n();
  return (
    <main className="boot-state boot-state--error">
      <div className="boot-mark">K</div>
      <h1>{t("common.unavailable")}</h1>
      <p>
        Kakarayan did not load a consistent public release. No partial or mismatched data is
        shown.
      </p>
      <code>{error.message}</code>
      <div className="button-row">
        <button className="button button--primary" onClick={retry}>
          {t("common.retry")}
        </button>
        <a className="button button--quiet" href="https://github.com/FormosanBank/FormosanBank">
          Open canonical public XML
        </a>
      </div>
    </main>
  );
}

function NotFound() {
  return (
    <div className="page-wrap page-wrap--prose">
      <p className="eyebrow">404</p>
      <h1>This path is not in the field notebook.</h1>
      <p>The release remains intact. Return home or open corpus search.</p>
      <div className="button-row">
        <Link className="button button--primary" to="/">
          Home
        </Link>
        <Link className="button button--quiet" to="/search">
          Search
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
  const page = (() => {
    switch (path) {
      case "/":
        return <Home data={data} />;
      case "/learn":
        return <Learn data={data} />;
      case "/explore":
        return <Explore data={data} />;
      case "/search":
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
