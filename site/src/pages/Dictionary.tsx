import {PageIntro} from "../components/Layout";
import {SearchTool} from "../components/SearchTool";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Dictionary({data}: {data: AppData}) {
  const {tx} = useI18n();
  return (
    <div className="page-wrap page-wrap--lookup">
      <PageIntro
        title={tx("Dictionary", "單詞查詢")}
        lede={tx(
          "Look up a Formosan word and choose the translation language.",
          "查詢臺灣南島語單詞，並選擇翻譯語言。",
        )}
      />
      <SearchTool data={data} kind="dictionary" />
    </div>
  );
}
