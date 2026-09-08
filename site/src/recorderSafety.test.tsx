import {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {Recorder} from "./components/Recorder";
import {I18nProvider} from "./i18n";
import {Link, RoutingProvider} from "./routing";
import {appFixture} from "./test/fixtures";

class FakeRecorder {
  static current: FakeRecorder;
  static fail = false;
  static isTypeSupported = (type: string) => type === "audio/mp4";
  mimeType = "audio/mp4";
  state = "inactive";
  ondataavailable: ((event: {data: Blob}) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() {
    if (FakeRecorder.fail) throw new Error("encoder unavailable");
    FakeRecorder.current = this;
  }
  start() { this.state = "recording"; }
  stop() {
    this.state = "inactive";
    this.ondataavailable?.({data: new Blob(["audio"], {type: this.mimeType})});
    this.onstop?.();
  }
}

describe("local recording lifecycle", () => {
  let root: Root;
  let container: HTMLDivElement;
  const stop = vi.fn();
  const getUserMedia = vi.fn();
  const createUrl = vi.fn<(blob: Blob) => string>(() => "blob:fixture");
  const revokeUrl = vi.fn();

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    FakeRecorder.fail = false;
    vi.stubGlobal("MediaRecorder", FakeRecorder);
    vi.stubGlobal("navigator", {language: "en", mediaDevices: {getUserMedia}});
    vi.stubGlobal("URL", Object.assign(URL, {createObjectURL: createUrl, revokeObjectURL: revokeUrl}));
    getUserMedia.mockResolvedValue({getTracks: () => [{stop}]});
    window.history.replaceState(null, "", "/learn");
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(<I18nProvider><RoutingProvider>
      <Recorder catalog={appFixture().models} selectedLanguage="Amis" />
      <Link to="/lookup">Leave</Link>
    </RoutingProvider></I18nProvider>));
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });
  async function click(text: string) {
    const button = [...container.querySelectorAll("button, a")].find((item) => item.textContent === text);
    if (!(button instanceof HTMLElement)) throw new Error(`Missing ${text}`);
    await act(async () => button.click());
  }

  it("uses Safari's supported format and confirms before leaving unsaved audio", async () => {
    await click("Start recording");
    await click("Stop recording");
    expect(stop).toHaveBeenCalled();
    expect(container.querySelector("a[download]")).toHaveAttribute("download", "kakarayan-recording.m4a");
    vi.spyOn(window, "confirm").mockReturnValue(false);
    await click("Leave");
    expect(window.location.pathname).toBe("/learn");
    await click("Delete");
    expect(revokeUrl).toHaveBeenCalledWith("blob:fixture");
    await click("Leave");
    expect(window.location.pathname).toBe("/lookup");
  });

  it("stops after ten minutes and never retains more than 25 MiB", async () => {
    await click("Start recording");
    await act(async () => vi.advanceTimersByTime(600_000));
    expect(FakeRecorder.current.state).toBe("inactive");
    expect(container).toHaveTextContent("Recording stopped at the size or duration limit.");
    vi.spyOn(window, "confirm").mockReturnValue(true);
    await click("Record again");
    await act(async () => {
      FakeRecorder.current.ondataavailable?.({data: new Blob([new Uint8Array(20 * 1024 * 1024)])});
      FakeRecorder.current.ondataavailable?.({data: new Blob([new Uint8Array(10 * 1024 * 1024)])});
    });
    expect(FakeRecorder.current.state).toBe("inactive");
    const audio = createUrl.mock.calls.at(-1)?.[0];
    expect(audio).toBeInstanceOf(Blob);
    if (audio instanceof Blob) expect(audio.size).toBeLessThanOrEqual(25 * 1024 * 1024);
  });

  it("releases microphone tracks if encoder creation fails", async () => {
    FakeRecorder.fail = true;
    await click("Start recording");
    expect(stop).toHaveBeenCalled();
    expect(container).toHaveTextContent("encoder unavailable");
    expect(container.querySelector("audio")).toBeNull();
  });

  it("handles denied microphone permission without leaving a busy state", async () => {
    getUserMedia.mockRejectedValueOnce(new DOMException("denied", "NotAllowedError"));
    await click("Start recording");
    expect(container).toHaveTextContent("denied");
    expect(container.querySelector("button")).not.toBeDisabled();
  });
});
