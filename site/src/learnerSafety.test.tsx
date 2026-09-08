import {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {TranslationTool} from "./components/ModelTools";
import {I18nProvider} from "./i18n";
import {translate} from "./modelServices";
import {Learn} from "./pages/Learn";
import {RoutingProvider} from "./routing";
import {saveCard} from "./study";
import type * as StudyModule from "./study";
import {appFixture} from "./test/fixtures";

vi.mock("./modelServices", () => ({translate: vi.fn(), transcribe: vi.fn()}));
vi.mock("./study", async (original) => ({
  ...await original<typeof StudyModule>(), saveCard: vi.fn(),
}));

describe("learner request and draft safety", () => {
  let container: HTMLDivElement;
  let root: Root;
  const data = appFixture();

  beforeEach(() => {
    vi.clearAllMocks();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
  });
  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  async function render(language = "lang_amis", active = true) {
    await act(async () => root.render(<I18nProvider><RoutingProvider>
      <TranslationTool catalog={data.models} languages={data.languages}
        selectedLanguageId={language} selectedDialect="Coastal" active={active} />
    </RoutingProvider></I18nProvider>));
  }
  function element<T extends Element>(selector: string): T {
    const value = container.querySelector<T>(selector);
    if (!value) throw new Error(`Missing ${selector}`);
    return value;
  }
  async function enter(text: string) {
    const input = element<HTMLTextAreaElement>("textarea");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setter) throw new Error("Textarea setter missing");
    await act(async () => {
      setter.call(input, text);
      input.dispatchEvent(new Event("input", {bubbles: true}));
    });
  }
  async function submit() {
    await act(async () => element<HTMLInputElement>('input[type="checkbox"]').click());
    await act(async () => element<HTMLFormElement>("form").dispatchEvent(
      new Event("submit", {bubbles: true, cancelable: true}),
    ));
  }
  function pending() {
    let complete: (value: {text: string; metadata: string}) => void = () => undefined;
    const promise = new Promise<{text: string; metadata: string}>((resolve) => { complete = resolve; });
    vi.mocked(translate).mockReturnValueOnce(promise);
    return () => complete({text: "lima", metadata: "Fixture"});
  }

  it("discards late responses after language or input changes and resets consent", async () => {
    await render();
    await enter("five");
    const complete = pending();
    await submit();
    await render("lang_atayal");
    expect(vi.mocked(translate).mock.calls[0]?.[2].signal.aborted).toBe(true);
    await act(async () => complete());
    expect(container.querySelector(".machine-output")).toBeNull();
    expect(element<HTMLInputElement>('input[type="checkbox"]')).not.toBeChecked();
    expect(element<HTMLTextAreaElement>("textarea").value).toBe("five");
  });

  it("saves the submitted context and preserves the draft when storage fails", async () => {
    await render();
    await enter("five");
    vi.mocked(translate).mockResolvedValueOnce({text: "lima", metadata: "Fixture"});
    await submit();
    vi.mocked(saveCard).mockRejectedValueOnce(new Error("quota"));
    const save = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes("Save as"));
    if (!save) throw new Error("Missing save button");
    await act(async () => save.click());
    expect(saveCard).toHaveBeenCalledWith(expect.objectContaining({
      front: "lima", back: "five", languageId: "lang_amis", tags: ["Coastal", "machine-draft"],
    }));
    expect(container).toHaveTextContent("Could not save. Your draft is still here.");
    expect(container.querySelector(".machine-output")).toHaveTextContent("lima");
    await enter("six");
    expect(container.querySelector(".machine-output")).toBeNull();
  });

  it("keeps text when changing tools and supports keyboard tabs", async () => {
    window.history.replaceState(null, "", "/learn?tool=translation");
    await act(async () => root.render(<I18nProvider><RoutingProvider>
      <Learn data={data} />
    </RoutingProvider></I18nProvider>));
    await enter("my unfinished draft");
    const tab = element<HTMLButtonElement>("#studio-tab-translation");
    await act(async () => tab.dispatchEvent(new KeyboardEvent("keydown", {key: "ArrowRight", bubbles: true})));
    expect(document.activeElement).toHaveAttribute("id", "studio-tab-orthography");
    expect(element("#studio-tab-orthography")).toHaveAttribute("aria-selected", "true");
    await act(async () => tab.click());
    expect(element<HTMLTextAreaElement>("#studio-translation textarea").value).toBe("my unfinished draft");
  });

  it("cancels a pending request when its panel becomes inactive", async () => {
    await render();
    await enter("five");
    const complete = pending();
    await submit();
    await render("lang_amis", false);
    await act(async () => complete());
    await render();
    expect(container.querySelector(".machine-output")).toBeNull();
    expect(element<HTMLInputElement>('input[type="checkbox"]')).not.toBeChecked();
  });
});
