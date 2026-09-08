import {useState} from "react";

import {DatasetBuilder} from "../components/DatasetBuilder";
import {PageIntro} from "../components/Layout";
import {Summaries} from "../components/Summaries";
import {Tabs} from "../components/Tabs";
import {useI18n} from "../i18n";
import {useSearchParams} from "../routing";
import type {AppData} from "../types";

export function Research({data}: {data: AppData}) {
  const {tx} = useI18n();
  const [params, setParams] = useSearchParams();
  const view = params.get("view") === "summaries" ? "summaries" : "builder";
  const [visitedSummaries, setVisitedSummaries] = useState(view === "summaries");
  return (
    <div className="page-wrap page-wrap--wide">
      <PageIntro
        title={tx("Research tools", "研究工具")}
      />
      <Tabs items={[["builder", tx("Dataset builder", "資料集產生器")], ["summaries", tx("Linguistic summaries", "語言學摘要")]]}
        value={view} prefix="research" activation="manual" className="research-tabs" label={tx("Research tools", "研究工具")}
        onChange={(next) => { const values = new URLSearchParams(params); values.set("view", next);
          if (setParams(values) && next === "summaries") setVisitedSummaries(true); }} />
      <div role="tabpanel" id="research-builder" aria-labelledby="research-tab-builder" hidden={view !== "builder"}>
        <DatasetBuilder data={data} active={view === "builder"} />
      </div>
      <div role="tabpanel" id="research-summaries" aria-labelledby="research-tab-summaries" hidden={view !== "summaries"}>
        {(visitedSummaries || view === "summaries") && <Summaries data={data} active={view === "summaries"} />}
      </div>
    </div>
  );
}
