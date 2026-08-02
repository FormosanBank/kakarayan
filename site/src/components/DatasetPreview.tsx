import {DATASET_FIELD_INFO, datasetFieldValue} from "../datasetSelection";
import {useI18n} from "../i18n";
import type {RecordUnit} from "../recordUnits";
import type {SearchRecord} from "../types";

export function DatasetPreview({
  fields,
  languageSelected,
  preview,
  previewBusy,
  recordUnit,
}: {
  fields: string[];
  languageSelected: boolean;
  preview: SearchRecord[];
  previewBusy: boolean;
  recordUnit: RecordUnit;
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
                    `First ${preview.length} ${recordUnit} rows in deterministic source order.`,
                    `依可重現來源順序顯示前 ${preview.length} 筆 ${recordUnit} 列。`,
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
                      <td key={field}>{datasetFieldValue(record, field) || "—"}</td>
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
            ([field, description]) => (
              <div key={field}><dt><code>{field}</code></dt><dd>{description}</dd></div>
            ),
          )}
        </dl>
      </details>
    </>
  );
}
