import {useState} from "react";

import {DatasetBuilder} from "../components/DatasetBuilder";
import {PageIntro} from "../components/Layout";
import {SearchTool} from "../components/SearchTool";
import {Summaries} from "../components/Summaries";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Research({data}: {data: AppData}) {
  const {t} = useI18n();
  const [view, setView] = useState<"search" | "builder" | "summaries">("search");
  return (
    <div className="page-wrap page-wrap--wide">
      <PageIntro title={t("search.title")} lede={t("search.lede")} />
      <div className="research-tabs" role="tablist" aria-label="Research tools">
        <button
          role="tab"
          aria-selected={view === "search"}
          onClick={() => setView("search")}
        >
          Concordance and dictionary
        </button>
        <button
          role="tab"
          aria-selected={view === "builder"}
          onClick={() => setView("builder")}
        >
          Dataset builder
        </button>
        <button
          role="tab"
          aria-selected={view === "summaries"}
          onClick={() => setView("summaries")}
        >
          Linguistic summaries
        </button>
      </div>
      <div role="tabpanel">
        {view === "search" && <SearchTool data={data} />}
        {view === "builder" && <DatasetBuilder data={data} />}
        {view === "summaries" && <Summaries data={data} />}
      </div>
    </div>
  );
}
