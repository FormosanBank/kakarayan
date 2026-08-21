import {useState} from "react";

import type {DatasetPreviewResult} from "../apiClient";
import {
  DATASET_FIELD_INFO,
  DATASET_LEVEL_INFO,
  type DatasetFieldsByLevel,
  type DatasetLevel,
} from "../datasetSelection";
import {useI18n} from "../i18n";

const levelInfo = new Map(DATASET_LEVEL_INFO.map((item) => [item[0], item]));

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

export function DatasetPreview({
  fields,
  languageSelected,
  levels,
  previews,
  previewBusy,
}: {
  fields: DatasetFieldsByLevel;
  languageSelected: boolean;
  levels: DatasetLevel[];
  previews: Partial<Record<DatasetLevel, DatasetPreviewResult>>;
  previewBusy: boolean;
}) {
  const {tx} = useI18n();
  const [activeLevel, setActiveLevel] = useState<DatasetLevel>(levels[0] ?? "sentence");

  const displayLevel = levels.includes(activeLevel) ? activeLevel : (levels[0] ?? "sentence");
  const active = previews[displayLevel];
  const activeFields = fields[displayLevel];
  const info = levelInfo.get(displayLevel) ?? DATASET_LEVEL_INFO[0];

  return (
    <>
      <div className="builder__preview" aria-busy={previewBusy}>
        <div className="builder__preview-heading">
          <div>
            <h2>{tx("Preview", "預覽")}</h2>
            <p>
              {languageSelected
                ? tx(
                    "Selected columns are required on every row.",
                    "每一列都必須包含所選欄位。",
                  )
                : tx("Choose a language to inspect the dataset.", "選擇語言以檢視資料集。")}
            </p>
          </div>
          {previewBusy && <span className="status">{tx("Updating…", "更新中…")}</span>}
        </div>
        {levels.length > 1 && (
          <div className="builder__preview-tabs" role="tablist" aria-label={tx("XML level preview", "XML 層級預覽")}>
            {levels.map((level) => {
              const item = levelInfo.get(level) ?? DATASET_LEVEL_INFO[0];
              return (
                <button
                  aria-selected={displayLevel === level}
                  key={level}
                  onClick={() => setActiveLevel(level)}
                  role="tab"
                  type="button"
                >
                  <code>{item[1]}</code> {tx(item[2], item[3])}
                  <span>{previews[level]?.estimated_rows ?? "—"}</span>
                </button>
              );
            })}
          </div>
        )}
        {levels.length === 0 && (
          <div className="empty-state">{tx("Select an XML level.", "請選擇 XML 層級。")}</div>
        )}
        {languageSelected && activeFields.length === 0 && (
          <div className="empty-state">
            {tx(`Select columns for ${info[1]}.`, `請選擇 ${info[1]} 的欄位。`)}
          </div>
        )}
        {languageSelected && !previewBusy && activeFields.length > 0 && active?.items.length === 0 && (
          <div className="empty-state">
            {tx(
              "No complete rows match these filters and columns.",
              "沒有同時符合篩選條件及完整欄位的資料列。",
            )}
          </div>
        )}
        {active && active.items.length > 0 && activeFields.length > 0 && (
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`${info[1]} preview`}>
            <table>
              <thead>
                <tr>{activeFields.map((field) => <th key={field}>{field}</th>)}</tr>
              </thead>
              <tbody>
                {active.items.map((record, index) => (
                  <tr key={String(record.id ?? index)}>
                    {activeFields.map((field) => (
                      <td key={field}>{displayValue(record[field])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {levels.length > 0 && activeFields.length > 0 && (
        <details className="builder__schema">
          <summary>{tx(`${info[1]} column definitions`, `${info[1]} 欄位定義`)}</summary>
          <dl>
            {activeFields.map((field) => (
              <div key={field}>
                <dt><code>{field}</code></dt>
                <dd>{tx(DATASET_FIELD_INFO[field][0], DATASET_FIELD_INFO[field][1])}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}
    </>
  );
}
