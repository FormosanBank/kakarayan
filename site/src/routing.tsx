import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type MouseEvent,
  type PropsWithChildren,
} from "react";

import {prepareRouting, routeFromPathname, routeHref} from "./routePaths";

interface LocationValue {
  path: string;
  search: URLSearchParams;
}
const LocationContext = createContext<LocationValue>({path: "/", search: new URLSearchParams()});

interface NavigationGuardValue {
  register: (blocker: () => boolean) => () => void;
  request: () => boolean;
}

const NavigationGuardContext = createContext<NavigationGuardValue>({
  register: () => () => undefined,
  request: () => true,
});

function normalizeRoutePath(path: string): string {
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`;
  if (withLeadingSlash.length === 1) return withLeadingSlash;
  return withLeadingSlash.replace(/\/+$/u, "");
}

function currentBrowserUrl(): string {
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

function readLocation(): LocationValue {
  return {
    path: routeFromPathname(window.location.pathname),
    search: new URLSearchParams(window.location.search),
  };
}

function pushRoute(href: string): void {
  window.history.pushState(null, "", href);
  window.dispatchEvent(new PopStateEvent("popstate", {state: window.history.state}));
}

export function RoutingProvider({children}: PropsWithChildren) {
  const [location, setLocation] = useState(() => {
    prepareRouting();
    return readLocation();
  });
  const blocker = useRef<(() => boolean) | null>(null);
  const acceptedUrl = useRef(currentBrowserUrl());
  const allowNextPop = useRef(false);
  const register = useCallback((next: () => boolean) => {
    blocker.current = next;
    return () => {
      if (blocker.current === next) blocker.current = null;
    };
  }, []);
  const request = useCallback(() => {
    if (!blocker.current) return true;
    const allowed = blocker.current();
    if (allowed) allowNextPop.current = true;
    return allowed;
  }, []);
  useEffect(() => {
    const update = () => {
      prepareRouting();
      if (allowNextPop.current) {
        allowNextPop.current = false;
      } else if (blocker.current && !blocker.current()) {
        window.history.pushState(window.history.state, "", acceptedUrl.current);
        return;
      }
      acceptedUrl.current = currentBrowserUrl();
      setLocation(readLocation());
    };
    window.addEventListener("popstate", update);
    window.addEventListener("hashchange", update);
    return () => {
      window.removeEventListener("popstate", update);
      window.removeEventListener("hashchange", update);
    };
  }, []);
  const guard = useMemo(() => ({register, request}), [register, request]);
  return (
    <NavigationGuardContext.Provider value={guard}>
      <LocationContext.Provider value={location}>{children}</LocationContext.Provider>
    </NavigationGuardContext.Provider>
  );
}

export function useRoutePath(): string {
  return useContext(LocationContext).path;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {to: string};

function isPlainLeftClick(event: MouseEvent<HTMLAnchorElement>): boolean {
  return event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
}

export function Link({to, children, onClick, target, ...props}: LinkProps) {
  const guard = useContext(NavigationGuardContext);
  const href = routeHref(to);
  return (
    <a
      href={href}
      target={target}
      onClick={(event) => {
        onClick?.(event);
        if (
          event.defaultPrevented ||
          !isPlainLeftClick(event) ||
          (target && target !== "_self")
        ) {
          return;
        }
        event.preventDefault();
        if (currentBrowserUrl() === href || !guard.request()) return;
        pushRoute(href);
      }}
      {...props}
    >
      {children}
    </a>
  );
}

export function NavLink({to, className, children, ...props}: LinkProps) {
  const path = useRoutePath();
  const destination = normalizeRoutePath(to.split(/[?#]/u, 1)[0] || "/");
  const active = destination === "/"
    ? path === "/"
    : path === destination || path.startsWith(`${destination}/`);
  const classes = [className, active ? "active" : ""].filter(Boolean).join(" ");
  return (
    <Link to={to} className={classes} aria-current={active ? "page" : undefined} {...props}>
      {children}
    </Link>
  );
}

export function useSearchParams(): [
  URLSearchParams,
  (value: Record<string, string>) => void,
] {
  const location = useContext(LocationContext);
  const guard = useContext(NavigationGuardContext);
  const search = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const setSearch = (value: Record<string, string>) => {
    const next = new URLSearchParams(value);
    if (!guard.request()) return;
    pushRoute(routeHref(`${location.path}${next.size ? `?${next}` : ""}`));
  };
  return [search, setSearch];
}

export function NavigationBlocker({active, message}: {active: boolean; message: string}) {
  const guard = useContext(NavigationGuardContext);
  useEffect(() => {
    if (!active) return;
    const unregister = guard.register(() => window.confirm(message));
    const beforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", beforeUnload);
    return () => {
      unregister();
      window.removeEventListener("beforeunload", beforeUnload);
    };
  }, [active, guard, message]);
  return null;
}
