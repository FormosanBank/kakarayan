import {PageIntro} from "../components/Layout";
import {SearchTool} from "../components/SearchTool";
import {useI18n} from "../i18n";
import type {AppData} from "../types";

export function Sentences({data}: {data: AppData}) {
  const {tx} = useI18n();
  return (
    <div className="page-wrap page-wrap--wide">
      <PageIntro
        title={tx("Sentence search", "例句搜尋")}
        lede={tx(
          "Find sentences containing a word, phrase, translation, or linguistic tier.",
          "尋找包含單詞、片語、翻譯或語言層級的句子。",
        )}
      />
      <SearchTool data={data} kind="sentences" />
    </div>
  );
}
