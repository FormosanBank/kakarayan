import {
  useCallback,
  createContext,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type AnchorHTMLAttributes,
  type PropsWithChildren,
} from "react";

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

function readHash(): LocationValue {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path = "/", query = ""] = raw.split("?", 2);
  return {path: path.startsWith("/") ? path : `/${path}`, search: new URLSearchParams(query)};
}

export function RoutingProvider({children}: PropsWithChildren) {
  const [location, setLocation] = useState(readHash);
  const blocker = useRef<(() => boolean) | null>(null);
  const acceptedHash = useRef(window.location.hash);
  const allowNextHashChange = useRef(false);
  const register = useCallback((next: () => boolean) => {
    blocker.current = next;
    return () => {
      if (blocker.current === next) blocker.current = null;
    };
  }, []);
  const request = useCallback(() => {
    if (!blocker.current) return true;
    const allowed = blocker.current();
    if (allowed) allowNextHashChange.current = true;
    return allowed;
  }, []);
  useEffect(() => {
    const update = () => {
      if (allowNextHashChange.current) {
        allowNextHashChange.current = false;
      } else if (blocker.current && !blocker.current()) {
        window.history.replaceState(null, "", acceptedHash.current || "#/");
        return;
      }
      acceptedHash.current = window.location.hash;
      setLocation(readHash());
    };
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
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

export function Link({to, children, onClick, ...props}: LinkProps) {
  const guard = useContext(NavigationGuardContext);
  const normalized = to.startsWith("/") ? to : `/${to}`;
  return (
    <a
      href={`#${normalized}`}
      onClick={(event) => {
        onClick?.(event);
        if (
          !event.defaultPrevented &&
          window.location.hash !== `#${normalized}` &&
          !guard.request()
        ) {
          event.preventDefault();
        }
      }}
      {...props}
    >
      {children}
    </a>
  );
}

export function NavLink({to, className, children, ...props}: LinkProps) {
  const path = useRoutePath();
  const active = to === "/" ? path === "/" : path === to || path.startsWith(`${to}/`);
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
    window.location.hash = `${location.path}${next.size ? `?${next}` : ""}`;
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
