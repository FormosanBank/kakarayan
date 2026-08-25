import {act} from "react";
import {createRoot} from "react-dom/client";

import {I18nProvider} from "../i18n";
import {DatasetPreview} from "./DatasetPreview";

it("renders the expanded translation columns returned by the API", async () => {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);

  await act(async () => root.render(
    <I18nProvider>
      <DatasetPreview
        fields={{
          sentence: ["id", "translations"],
          word: [],
          morpheme: [],
        }}
        languageSelected
        levels={["sentence"]}
        loadingLevels={[]}
        previews={{
          sentence: {
            release_id: "fb-20240102-3b367525",
            record_level: "sentence",
            complete_fields: true,
            estimated_rows: 1,
            returned_rows: 1,
            truncated: false,
            fields: ["id", "translation_eng_1", "translation_zho_1"],
            items: [{
              id: "sentence_fixture",
              translation_eng_1: "A line.",
              translation_zho_1: "一行。",
            }],
          },
        }}
      />
    </I18nProvider>,
  ));

  expect([...container.querySelectorAll("th")].map((item) => item.textContent)).toEqual([
    "id",
    "translation_eng_1",
    "translation_zho_1",
  ]);
  expect(container.querySelector("table")).toHaveTextContent("A line.");
  expect(container.querySelector(".builder__schema")).toHaveTextContent(
    "One owner-level TRANSL element",
  );

  await act(async () => root.unmount());
  container.remove();
});
