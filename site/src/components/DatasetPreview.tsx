import {DATASET_FIELD_INFO} from "../datasetSelection";
import {useI18n} from "../i18n";

function alignedTranslationPreview(value: string): string {
  try {
    const items = JSON.parse(value) as Array<{form?: string; text?: string; xml_lang?: string}>;
    return items
      .map((item) => `${item.form || "?"} → ${item.text || "?"}${item.xml_lang ? ` (${item.xml_lang})` : ""}`)
      .join(" · ");
  } catch {
    return value;
  }
}

export function DatasetPreview({
  fields,
  languageSelected,
  preview,
  previewBusy,
}: {
  fields: string[];
  languageSelected: boolean;
  preview: Array<Record<string, string>>;
  previewBusy: boolean;
}) {
  const {tx} = useI18n();
  return (
    <>
      <div className="builder__preview" aria-busy={previewBusy}>
        <div className="builder__preview-heading">
          <div>
            <h2>{tx("Dataset preview", "資料集預覽")}</h2>
            <p>
              {languageSelected
                ? tx(
                    `First ${preview.length} sentence rows in deterministic source order.`,
                    `依可重現來源順序顯示前 ${preview.length} 筆句子列。`,
                  )
                : tx("Choose a language to inspect the dataset.", "選擇語言以檢視資料集。")}
            </p>
          </div>
          {previewBusy && <span className="status">{tx("Updating…", "更新中…")}</span>}
        </div>
        {languageSelected && !previewBusy && preview.length === 0 && (
          <div className="empty-state">
            {tx("No rows match this selection.", "沒有符合此選取範圍的列。")}
          </div>
        )}
        {preview.length > 0 && fields.length > 0 && (
          <div className="table-scroll" tabIndex={0}>
            <table>
              <thead>
                <tr>{fields.map((field) => <th key={field}>{field}</th>)}</tr>
              </thead>
              <tbody>
                {preview.map((record) => (
                  <tr key={record.id}>
                    {fields.map((field) => (
                      <td key={field}>
                        {field === "word_translations" || field === "morpheme_translations"
                          ? alignedTranslationPreview(record[field] || "[]") || "—"
                          : record[field] || "—"}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {fields.length === 0 && (
          <div className="empty-state">
            {tx("Select at least one field to preview and export.", "請至少選擇一個欄位以預覽及匯出。")}
          </div>
        )}
      </div>
      <details className="builder__schema">
        <summary>{tx("Export schema and data model", "匯出結構與資料模型")}</summary>
        <p>
          {tx(
            "Rows are projections of public FormosanBank XML. Original and standardized forms remain separate, translations retain language tags, and source_path resolves provenance.",
            "資料列是公開 FormosanBank XML 的投影。原始形式與標準化形式保持分離，翻譯保留語言標籤，source_path 可追溯來源。",
          )}
        </p>
        <dl>
          {DATASET_FIELD_INFO.filter(([field]) => fields.includes(field)).map(
            ([field, description, descriptionZh]) => (
              <div key={field}><dt><code>{field}</code></dt><dd>{tx(description, descriptionZh)}</dd></div>
            ),
          )}
        </dl>
      </details>
    </>
  );
}
