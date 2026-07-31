import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type AnchorHTMLAttributes,
  type PropsWithChildren,
} from "react";

interface LocationValue {
  path: string;
  search: URLSearchParams;
}
const LocationContext = createContext<LocationValue>({path: "/", search: new URLSearchParams()});

function readHash(): LocationValue {
  const raw = window.location.hash.replace(/^#/, "") || "/";
  const [path = "/", query = ""] = raw.split("?", 2);
  return {path: path.startsWith("/") ? path : `/${path}`, search: new URLSearchParams(query)};
}

export function RoutingProvider({children}: PropsWithChildren) {
  const [location, setLocation] = useState(readHash);
  useEffect(() => {
    const update = () => setLocation(readHash());
    window.addEventListener("hashchange", update);
    return () => window.removeEventListener("hashchange", update);
  }, []);
  return <LocationContext.Provider value={location}>{children}</LocationContext.Provider>;
}

export function useRoutePath(): string {
  return useContext(LocationContext).path;
}

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {to: string};

export function Link({to, children, ...props}: LinkProps) {
  return (
    <a href={`#${to.startsWith("/") ? to : `/${to}`}`} {...props}>
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
  const search = useMemo(
    () => new URLSearchParams(location.search),
    [location.search],
  );
  const setSearch = (value: Record<string, string>) => {
    const next = new URLSearchParams(value);
    window.location.hash = `${location.path}${next.size ? `?${next}` : ""}`;
  };
  return [search, setSearch];
}
