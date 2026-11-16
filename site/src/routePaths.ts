const basePath = import.meta.env.BASE_URL.replace(/\/+$/u, "");
const pagesRouteParameter = "__kakarayan_route";

export function routeHref(route: string): string {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return `${basePath}${normalized}` || "/";
}

// A shared link names an in-app route. It must stay under the base path once the browser
// resolves it, so empty, dot, and backslash segments are refused. Browsers read %2e as a
// dot, and decoding exposes encoded separators, so both forms are checked.
function escapesBase(path: string): boolean {
  const segments = path.slice(1).split("/");
  return path.includes("\\") || segments.some((segment, index) =>
    segment === "." || segment === ".." || (segment === "" && index < segments.length - 1));
}

function inAppRoute(value: string): string | null {
  if (!value.startsWith("/")) return null;
  const pathEnd = value.search(/[?#]/u);
  const path = pathEnd === -1 ? value : value.slice(0, pathEnd);
  if (escapesBase(path.replace(/%2e/giu, "."))) return null;
  try {
    if (escapesBase(decodeURIComponent(path))) return null;
  } catch {
    // Malformed escapes cannot be decoded by the router either; the page shows not found.
  }
  return value;
}

export function prepareRouting(): void {
  const parameters = new URLSearchParams(window.location.search);
  const forwarded = parameters.get(pagesRouteParameter);
  const legacyHash = window.location.hash.replace(/^#/u, "");
  const route = forwarded !== null ? inAppRoute(forwarded) : inAppRoute(legacyHash);
  if (route) {
    window.history.replaceState(window.history.state, "", routeHref(route));
    return;
  }
  // An alias such as /kakarayan// serves the same shell; settle on the one real path.
  const {pathname, search, hash} = window.location;
  const canonical = pathname.replace(/\/{2,}/gu, "/");
  if (canonical !== pathname) {
    window.history.replaceState(window.history.state, "", `${canonical}${search}${hash}`);
  }
}

export function routeFromPathname(pathname: string): string {
  let route = pathname;
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    route = pathname.slice(basePath.length) || "/";
  }
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  try {
    decodeURIComponent(withLeadingSlash);
  } catch {
    return "/not-found";
  }
  if (withLeadingSlash.length === 1) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/u, "");
}
