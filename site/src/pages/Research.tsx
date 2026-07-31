import {useState} from "react";

import {DatasetBuilder} from "../components/DatasetBuilder";
import {PageIntro} from "../components/Layout";
import {SearchTool} from "../components/SearchTool";
import {Summaries} from "../components/Summaries";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Research({data}: {data: AppData}) {
  const {t, tx} = useI18n();
  const [view, setView] = useState<"search" | "builder" | "summaries">("search");
  return (
    <div className="page-wrap page-wrap--wide">
      <PageIntro title={t("search.title")} lede={t("search.lede")} />
      <div className="research-tabs" role="tablist" aria-label={tx("Research tools", "研究工具")}>
        <button
          role="tab"
          aria-selected={view === "search"}
          onClick={() => setView("search")}
        >
          {tx("Concordance and dictionary", "索引行與詞典")}
        </button>
        <button
          role="tab"
          aria-selected={view === "builder"}
          onClick={() => setView("builder")}
        >
          {tx("Dataset builder", "資料集產生器")}
        </button>
        <button
          role="tab"
          aria-selected={view === "summaries"}
          onClick={() => setView("summaries")}
        >
          {tx("Linguistic summaries", "語言學摘要")}
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
