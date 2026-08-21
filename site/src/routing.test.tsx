import {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {
  Link,
  NavigationBlocker,
  RoutingProvider,
  useRoutePath,
} from "./routing";
import {prepareRouting, routeHref} from "./routePaths";

function GuardFixture() {
  const path = useRoutePath();
  return (
    <>
      <NavigationBlocker active message="Translation is running" />
      <Link to="/next">Next</Link>
      <output>{path}</output>
    </>
  );
}

describe("navigation protection", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    window.history.replaceState(null, "", "/start");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <RoutingProvider>
        <GuardFixture />
      </RoutingProvider>,
    ));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it("keeps the current route when the user declines to leave", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(false);
    const link = container.querySelector("a");
    if (!link) throw new Error("fixture link not found");

    await act(async () => link.click());

    expect(window.location.pathname).toBe("/start");
    expect(window.location.hash).toBe("");
    expect(container.querySelector("output")).toHaveTextContent("/start");
  });

  it("allows the route change after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const link = container.querySelector("a");
    if (!link) throw new Error("fixture link not found");

    await act(async () => link.click());

    await vi.waitFor(() => {
      expect(window.location.pathname).toBe("/next");
      expect(window.location.hash).toBe("");
      expect(container.querySelector("output")).toHaveTextContent("/next");
    });
  });

  it("asks the browser to confirm a refresh or close", () => {
    const event = new Event("beforeunload", {cancelable: true});
    window.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(true);
  });
});

describe("clean route migration", () => {
  afterEach(() => {
    window.history.replaceState(null, "", "/");
  });

  it("builds links beneath the GitHub Pages project path", () => {
    expect(routeHref("/research")).toBe("/research");
    expect(routeHref("/lookup?type=sentences")).toBe("/lookup?type=sentences");
  });

  it("converts old hash links without reloading", () => {
    window.history.replaceState(null, "", "/#/research?language=lang_amis");

    prepareRouting();

    expect(window.location.pathname).toBe("/research");
    expect(window.location.search).toBe("?language=lang_amis");
    expect(window.location.hash).toBe("");
  });

  it("restores a route forwarded by the GitHub Pages fallback", () => {
    window.history.replaceState(
      null,
      "",
      "/?__kakarayan_route=%2Fdevelopers%3Fsection%3Dapi",
    );

    prepareRouting();

    expect(window.location.pathname).toBe("/developers");
    expect(window.location.search).toBe("?section=api");
  });
});
