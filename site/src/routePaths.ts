const basePath = import.meta.env.BASE_URL.replace(/\/+$/u, "");
const pagesRouteParameter = "__kakarayan_route";

export function routeHref(route: string): string {
  const normalized = route.startsWith("/") ? route : `/${route}`;
  return `${basePath}${normalized}` || "/";
}

function isSafeForwardedRoute(value: string): boolean {
  return value.startsWith("/") && !value.startsWith("//") && !value.includes("\\");
}

export function prepareRouting(): void {
  const parameters = new URLSearchParams(window.location.search);
  const forwardedRoute = parameters.get(pagesRouteParameter);
  if (forwardedRoute && isSafeForwardedRoute(forwardedRoute)) {
    window.history.replaceState(window.history.state, "", routeHref(forwardedRoute));
    return;
  }

  const legacyHash = window.location.hash.replace(/^#/, "");
  if (legacyHash.startsWith("/")) {
    window.history.replaceState(window.history.state, "", routeHref(legacyHash));
  }
}

export function routeFromPathname(pathname: string): string {
  let route = pathname;
  if (basePath && (pathname === basePath || pathname.startsWith(`${basePath}/`))) {
    route = pathname.slice(basePath.length) || "/";
  }
  const withLeadingSlash = route.startsWith("/") ? route : `/${route}`;
  if (withLeadingSlash.length === 1) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/u, "");
}
