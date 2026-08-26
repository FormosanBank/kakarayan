import {useI18n} from "../i18n";

export function LookupGuide() {
  const {tx} = useI18n();

  return (
    <details className="lookup-guide">
      <summary>{tx("30-second lookup guide", "30 秒查詢指南")}</summary>
      <div className="lookup-guide__content">
        <ol>
          <li>
            <strong>{tx("Choose what you are typing.", "先選擇您要輸入的文字類型。")}</strong>
            <span>{tx(
              "Use Formosan text for a word you already have, or A translation for English or Chinese.",
              "已有族語詞彙時選「族語文字」；輸入中文或英文時選「翻譯文字」。",
            )}</span>
          </li>
          <li>
            <strong>{tx("Choose the Formosan language.", "選擇臺灣南島語。")}</strong>
            <span>{tx(
              "For a translation search, this is the language you want in the results.",
              "搜尋翻譯時，這是您希望在結果中看到的族語。",
            )}</span>
          </li>
          <li>
            <strong>{tx("Enter the word and search.", "輸入詞彙並搜尋。")}</strong>
            <span>{tx(
              "Example: A translation → English → Rukai → dog.",
              "例如：翻譯文字 → 中文 → 魯凱語 → 狗。",
            )}</span>
          </li>
        </ol>
      </div>
    </details>
  );
}
