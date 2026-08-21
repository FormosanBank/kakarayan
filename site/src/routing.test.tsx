import {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {Link, NavigationBlocker, RoutingProvider, useRoutePath} from "./routing";

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
    window.location.hash = "/start";
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

    expect(window.location.hash).toBe("#/start");
    expect(container.querySelector("output")).toHaveTextContent("/start");
  });

  it("allows the route change after confirmation", async () => {
    vi.spyOn(window, "confirm").mockReturnValue(true);
    const link = container.querySelector("a");
    if (!link) throw new Error("fixture link not found");

    await act(async () => link.click());

    await vi.waitFor(() => expect(window.location.hash).toBe("#/next"));
    expect(container.querySelector("output")).toHaveTextContent("/next");
  });
});
