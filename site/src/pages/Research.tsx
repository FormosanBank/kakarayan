import {useState} from "react";

import {DatasetBuilder} from "../components/DatasetBuilder";
import {PageIntro} from "../components/Layout";
import {Summaries} from "../components/Summaries";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Research({data}: {data: AppData}) {
  const {tx} = useI18n();
  const [view, setView] = useState<"builder" | "summaries">("builder");
  return (
    <div className="page-wrap page-wrap--wide">
      <PageIntro
        title={tx("Research tools", "研究工具")}
      />
      <div className="research-tabs" role="tablist" aria-label={tx("Research tools", "研究工具")}>
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
        {view === "builder" && <DatasetBuilder data={data} />}
        {view === "summaries" && <Summaries data={data} />}
      </div>
    </div>
  );
}
