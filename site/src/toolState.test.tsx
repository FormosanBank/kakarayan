import {act, cleanup, fireEvent, render, screen} from "@testing-library/react";

import {concordance, datasetPreview, translationLanguages} from "./apiClient";
import type * as ApiClient from "./apiClient";
import {DatasetBuilder} from "./components/DatasetBuilder";
import {SearchTool} from "./components/SearchTool";
import {datasetScopeFromUrl, datasetScopeToUrl} from "./datasetRecipe";
import {I18nProvider} from "./i18n";
import {RoutingProvider} from "./routing";
import {appFixture} from "./test/fixtures";

vi.mock("./apiClient", async (original) => ({
  ...await original<typeof ApiClient>(),
  datasetPreview: vi.fn(), translationLanguages: vi.fn(), concordance: vi.fn(),
}));

const data = appFixture();
data.query.available = true;
data.query.error = "";

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  window.history.replaceState(null, "", "/kakarayan/research?language=lang_amis");
  vi.mocked(translationLanguages).mockResolvedValue([{xml_lang: "eng", records: 2}, {xml_lang: "zho", records: 1}]);
  vi.mocked(datasetPreview).mockImplementation(async (_release, params) => ({
    release_id: data.meta.release_id, record_level: "sentence", complete_fields: params.get("complete_fields") === "true",
    estimated_rows: 2000, selected_rows: Math.min(2000, Number(params.get("selection_rows"))),
    returned_rows: 1, truncated: true, fields: ["id", "translation_eng_1"], items: [{id: "s1", translation_eng_1: "five"}],
  }));
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

async function mount(tool: "builder" | "search" = "builder") {
  await act(async () => {
    render(<I18nProvider><RoutingProvider>{tool === "builder"
      ? <DatasetBuilder data={data} /> : <SearchTool data={data} kind="sentences" />}
    </RoutingProvider></I18nProvider>);
  });
}
async function tick(ms = 500) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }

it("round-trips every builder selection and rejects malformed public scope", () => {
  const scope = datasetScopeFromUrl(new URLSearchParams("language=lang_amis&corpus=corpus_fixture&dialect=Coastal&q=five&direction=translation&target=eng&mode=contains&levels=sentence,word&sentence_fields=id,unclear,translations&rows=25000&complete=false&format=tsv"), data);
  expect(datasetScopeFromUrl(datasetScopeToUrl(scope), data)).toEqual(scope);
  expect(scope.completeFields).toBe(false);
  const invalid = datasetScopeFromUrl(new URLSearchParams("language=unknown&corpus=corpus_fixture&dialect=bogus&mode=wild&rows=Infinity&sentence_fields=id,sql&levels=word,bogus"), data);
  expect(invalid).toMatchObject({languageId: "", corpusId: "", dialect: "", match: "exact", maxRows: 1000, recordLevels: ["word"]});
  expect(invalid.fields.sentence).toEqual(["id"]);
});

it("cancels before debounce and retries without a stranded skeleton", async () => {
  await mount();
  fireEvent.click(screen.getByRole("button", {name: "Cancel preview"}));
  await tick();
  expect(datasetPreview).not.toHaveBeenCalled();
  expect(screen.getByText("Preview cancelled")).toBeVisible();
  fireEvent.click(screen.getByRole("button", {name: "Retry preview"}));
  await tick();
  expect(datasetPreview).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("table")).toBeVisible();
});

it("keeps format changes out of preview work and uses the finite export schema", async () => {
  await mount(); await tick();
  expect(datasetPreview).toHaveBeenCalledTimes(1);
  expect(vi.mocked(datasetPreview).mock.calls[0]?.[1].get("selection_rows")).toBe("1000");
  fireEvent.change(screen.getByLabelText("File type"), {target: {value: "tsv"}});
  await tick();
  expect(datasetPreview).toHaveBeenCalledTimes(1);
  expect(new URLSearchParams(window.location.search).get("format")).toBe("tsv");
  fireEvent.change(screen.getByLabelText("Maximum per level"), {target: {value: "25000"}});
  await tick();
  expect(datasetPreview).toHaveBeenCalledTimes(2);
  expect(vi.mocked(datasetPreview).mock.calls[1]?.[1].get("selection_rows")).toBe("25000");
});

it("ignores a cancelled preview even if the transport resolves late", async () => {
  let finish: (value: Awaited<ReturnType<typeof datasetPreview>>) => void = () => undefined;
  vi.mocked(datasetPreview).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  await mount(); await tick();
  fireEvent.click(screen.getByRole("button", {name: "Cancel preview"}));
  expect(vi.mocked(datasetPreview).mock.calls[0]?.[2]?.aborted).toBe(true);
  await act(async () => finish({release_id: data.meta.release_id, record_level: "sentence", complete_fields: true,
    estimated_rows: 1, selected_rows: 1, returned_rows: 1, truncated: false, fields: ["id"], items: [{id: "stale"}]}));
  expect(screen.queryByText("stale")).toBeNull();
  expect(screen.getByText("Preview cancelled")).toBeVisible();
});

it("restores search requirements from URLs and keeps translation intent on facet failure", async () => {
  window.history.replaceState(null, "", "/kakarayan/lookup?type=sentences&language=lang_amis&direction=translation&target=zho&q=父親&require=audio&require=translation");
  vi.mocked(translationLanguages).mockRejectedValueOnce(new Error("network unavailable"));
  vi.mocked(concordance).mockResolvedValue({release_id: data.meta.release_id, items: [], next_cursor: null});
  await mount("search");
  expect(screen.getByLabelText("Search text language")).toHaveValue("translation:zho");
  expect(screen.getByRole("checkbox", {name: "audio"})).toBeChecked();
  expect(screen.getByRole("button", {name: "Search"})).toBeDisabled();
  fireEvent.click(screen.getByRole("button", {name: "Retry"}));
  await tick(1);
  fireEvent.click(screen.getByRole("button", {name: "Search"}));
  await tick(1);
  expect(concordance).toHaveBeenCalledWith(data.meta.release_id, expect.objectContaining({
    q: "父親", direction: "translation", translationLanguage: "zho", requirements: ["translation", "audio"],
  }), expect.any(AbortSignal));
  expect(new URLSearchParams(window.location.search).getAll("require")).toEqual(["translation", "audio"]);
  await act(async () => {
    window.history.pushState(null, "", "/kakarayan/lookup?type=sentences&language=lang_atayal&q=hello&mode=prefix");
    window.dispatchEvent(new PopStateEvent("popstate"));
  });
  expect(screen.getByLabelText("Formosan language")).toHaveValue("lang_atayal");
  expect(screen.getByLabelText("Atayal word or phrase")).toHaveValue("hello");
  expect(screen.getByRole("radio", {name: "Prefix"})).toBeChecked();
  expect(screen.getByRole("checkbox", {name: "audio"})).not.toBeChecked();
});
