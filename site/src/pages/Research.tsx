import {PageIntro} from "../components/Layout";
import {SearchTool} from "../components/SearchTool";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Research({data}: {data: AppData}) {
  const {t} = useI18n();
  return (
    <div className="page-wrap page-wrap--wide">
      <PageIntro title={t("search.title")} lede={t("search.lede")} />
      <SearchTool data={data} />
    </div>
  );
}
