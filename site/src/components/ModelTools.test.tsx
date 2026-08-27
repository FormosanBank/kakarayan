const serviceMock = vi.hoisted(() => ({translate: vi.fn()}));

vi.mock("../modelServices", () => ({translate: serviceMock.translate}));

import {act} from "react";
import {createRoot, type Root} from "react-dom/client";

import {I18nProvider} from "../i18n";
import {translate} from "../modelServices";
import {RoutingProvider} from "../routing";
import type {Language, ModelCatalog} from "../types";
import {TranslationTool} from "./ModelTools";
import {Recorder} from "./Recorder";

const language: Language = {
  id: "lang_amis",
  name: "Amis",
  iso639_3: "ami",
  names: {en: "Amis", "zh-Hant": "阿美語", autonym: "Pangcah"},
  capabilities: [],
  dialects: ["Coastal"],
  counts: {},
};

const catalog: ModelCatalog = {
  schema_version: "1.0.0",
  generated_at: "2024-01-02T03:04:05Z",
  provider: "Hugging Face",
  models: [],
  services: [{
    id: "mt",
    space: "FormosanBank/formosan-mt",
    url: "https://huggingface.co/spaces/FormosanBank/formosan-mt",
    api_url: null,
    api_name: "/translate",
    tasks: ["translation"],
    supported_languages: ["Amis"],
    status: "available",
    checked_at: null,
    third_party_notice: "Hugging Face",
  }],
};

function input(container: HTMLElement, selector: string, value: string) {
  const element = container.querySelector<HTMLInputElement | HTMLTextAreaElement>(selector);
  if (!element) throw new Error(`Missing test input: ${selector}`);
  const prototype = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
  if (!setter) throw new Error("Native input value setter not found");
  setter.call(element, value);
  element.dispatchEvent(new Event("input", {bubbles: true}));
}

describe("translation progress", () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(async () => {
    window.localStorage.clear();
    vi.spyOn(window, "confirm").mockReturnValue(false);
    serviceMock.translate.mockReset();
    container = document.createElement("div");
    document.body.append(container);
    root = createRoot(container);
    await act(async () => root.render(
      <I18nProvider>
        <RoutingProvider>
          <TranslationTool
            catalog={catalog}
            languages={[language]}
            selectedLanguageId={language.id}
            selectedDialect="Coastal"
          />
        </RoutingProvider>
      </I18nProvider>,
    ));
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await act(async () => root.unmount());
    container.remove();
  });

  it("shows queue progress and protects an active request from accidental unload", async () => {
    let finish = () => undefined;
    vi.mocked(translate).mockImplementation((_request, _service, options) => {
      options.onStage("connecting");
      options.onStage("pending", "Queue position 2");
      return new Promise((resolve) => {
        finish = () => {
          options.onStage("complete");
          resolve({text: "lima", metadata: ""});
        };
      });
    });

    await act(async () => {
      input(container, "textarea", "five");
      container.querySelector<HTMLInputElement>('.consent input[type="checkbox"]')?.click();
    });
    const translateButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Translate");
    if (!translateButton) throw new Error("Translate button not found");
    expect(translateButton).toBeEnabled();
    await act(async () => translateButton.click());

    await vi.waitFor(() => expect(container.querySelector(".model-progress")).toBeVisible());
    expect(container.querySelector(".model-progress")).toHaveTextContent(
      "Waiting in queue · position 2",
    );
    expect(container.querySelector('[data-state="current"]')).toHaveTextContent("Queue");
    expect([...container.querySelectorAll("button")].some(
      (button) => button.textContent === "Cancel",
    )).toBe(true);

    const unload = new Event("beforeunload", {cancelable: true});
    window.dispatchEvent(unload);
    expect(unload.defaultPrevented).toBe(true);

    await act(async () => finish());
    await vi.waitFor(() => expect(container.querySelector(".model-progress")).toBeNull());
    expect(container.querySelector(".machine-output")).toHaveTextContent("lima");
  });

  it("requires opt-in and links the provider privacy policy", () => {
    const translateButton = [...container.querySelectorAll("button")]
      .find((button) => button.textContent === "Translate");
    expect(translateButton).toBeDisabled();
    expect(container.querySelector(".model-privacy-note")).toHaveTextContent(
      "Nothing is sent unless you check the box and press Translate",
    );
    expect(container.querySelector<HTMLAnchorElement>('.model-privacy-note a')?.href).toBe(
      "https://huggingface.co/privacy",
    );
  });
});

it("keeps recorder submission optional and explicit", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(
    <I18nProvider>
      <Recorder catalog={catalog} selectedLanguage="Amis" />
    </I18nProvider>,
  ));

  expect(container.querySelector(".model-privacy-note")).toHaveTextContent(
    "Microphone audio remains in this tab unless you explicitly consent",
  );
  expect(container).toHaveTextContent("Start recording");

  await act(async () => root.unmount());
  container.remove();
});
