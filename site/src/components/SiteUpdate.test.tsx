import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";
import {I18nProvider} from "../i18n";
import {SiteUpdate} from "./SiteUpdate";

class WaitingWorker extends EventTarget {
  state = "installed";
  postMessage = vi.fn();
  activate() {
    this.state = "activated";
    this.dispatchEvent(new Event("statechange"));
  }
}

describe("explicit site updates", () => {
  const reload = vi.fn();
  let worker: WaitingWorker;
  let port: {onmessage: ((event: MessageEvent<unknown>) => void) | null; close: ReturnType<typeof vi.fn>};

  beforeEach(() => {
    vi.stubEnv("PROD", true);
    reload.mockClear();
    worker = new WaitingWorker();
    port = {onmessage: null, close: vi.fn()};
    vi.stubGlobal("MessageChannel", class {port1 = port; port2 = {};});
    vi.stubGlobal("navigator", {language: "en", serviceWorker: {
      register: vi.fn().mockResolvedValue({waiting: worker, addEventListener: vi.fn(), removeEventListener: vi.fn()}),
    }});
    const mockWindow = Object.create(window);
    Object.defineProperty(mockWindow, "location", {value: {reload}});
    vi.stubGlobal("window", mockWindow);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

  async function accept() {
    await act(async () => { render(<I18nProvider><SiteUpdate /></I18nProvider>); });
    fireEvent.click(screen.getByRole("button", {name: "Update"}));
    expect(worker.postMessage).toHaveBeenCalledOnce();
  }
  function acknowledge(status: string) {
    port.onmessage?.(new MessageEvent("message", {data: {status}}));
  }

  it.each([true, false])("reloads after both acknowledgement and activation, activation first: %s", async (activationFirst) => {
    await accept();
    await act(async () => {
      if (activationFirst) worker.activate();
      acknowledge("activating");
      if (!activationFirst) worker.activate();
    });
    expect(reload).toHaveBeenCalledOnce();
    expect(port.close).toHaveBeenCalled();
  });

  it("does not reload another tab's session or activate without consent", async () => {
    await accept();
    await act(async () => { acknowledge("other_tabs"); worker.activate(); });
    expect(reload).not.toHaveBeenCalled();
    expect(screen.getByText("Close other Kakarayan tabs before updating.")).toBeVisible();
  });
});
