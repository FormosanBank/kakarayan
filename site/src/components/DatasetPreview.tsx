import {useState} from "react";

import type {DatasetPreviewResult} from "../apiClient";
import {
  DATASET_FIELD_INFO,
  DATASET_LEVEL_INFO,
  type DatasetFieldsByLevel,
  type DatasetLevel,
} from "../datasetSelection";
import {useI18n} from "../i18n";
import {LoadingState} from "./LoadingState";

const levelInfo = new Map(DATASET_LEVEL_INFO.map((item) => [item[0], item]));

function displayValue(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "—";
  return String(value);
}

function columnDefinition(field: string): readonly [string, string] {
  if (/^translation_[a-z0-9_]+_\d+$/u.test(field)) {
    return [
      "One owner-level TRANSL element; the suffix is its XML language and occurrence",
      "一個元素所屬的 TRANSL；後綴為 XML 語言及出現順序",
    ];
  }
  return DATASET_FIELD_INFO[field as keyof typeof DATASET_FIELD_INFO];
}

export function DatasetPreview({
  fields,
  languageSelected,
  levels,
  previews,
  loadingLevels,
}: {
  fields: DatasetFieldsByLevel;
  languageSelected: boolean;
  levels: DatasetLevel[];
  previews: Partial<Record<DatasetLevel, DatasetPreviewResult>>;
  loadingLevels: DatasetLevel[];
}) {
  const {tx} = useI18n();
  const [activeLevel, setActiveLevel] = useState<DatasetLevel>(levels[0] ?? "sentence");

  const displayLevel = levels.includes(activeLevel) ? activeLevel : (levels[0] ?? "sentence");
  const active = previews[displayLevel];
  const activeFields = fields[displayLevel];
  const previewFields = active?.fields ?? activeFields;
  const info = levelInfo.get(displayLevel) ?? DATASET_LEVEL_INFO[0];
  const activeLoading = loadingLevels.includes(displayLevel);
  const previewBusy = loadingLevels.length > 0;

  return (
    <>
      <div className="builder__preview" aria-busy={previewBusy}>
        <div className="builder__preview-heading">
          <div>
            <h2>{tx("Preview", "預覽")}</h2>
            <p>
              {languageSelected
                ? tx(
                    "TRANSL elements are separated by XML language and occurrence.",
                    "TRANSL 元素會依 XML 語言及出現順序分開。",
                  )
                : tx("Choose a language to inspect the dataset.", "選擇語言以檢視資料集。")}
            </p>
          </div>
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
                  <span>{previews[level]?.estimated_rows ?? (loadingLevels.includes(level) ? "…" : "—")}</span>
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
        {languageSelected && activeLoading && activeFields.length > 0 && (
          <LoadingState
            className="builder__preview-skeleton"
            columns={activeFields}
            kind="table"
            label={tx(`Loading ${info[1]} preview`, `正在載入 ${info[1]} 預覽`)}
          />
        )}
        {languageSelected && !activeLoading && activeFields.length > 0 && active?.items.length === 0 && (
          <div className="empty-state">
            {tx(
              "No complete rows match these filters and columns.",
              "沒有同時符合篩選條件及完整欄位的資料列。",
            )}
          </div>
        )}
        {!activeLoading && active && active.items.length > 0 && activeFields.length > 0 && (
          <div className="table-scroll" tabIndex={0} role="region" aria-label={`${info[1]} preview`}>
            <table>
              <thead>
                <tr>{previewFields.map((field) => <th key={field}>{field}</th>)}</tr>
              </thead>
              <tbody>
                {active.items.map((record, index) => (
                  <tr key={String(record.id ?? index)}>
                    {previewFields.map((field) => (
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
            {previewFields.map((field) => {
              const definition = columnDefinition(field);
              return (
                <div key={field}>
                  <dt><code>{field}</code></dt>
                  <dd>{tx(definition[0], definition[1])}</dd>
                </div>
              );
            })}
          </dl>
        </details>
      )}
    </>
  );
}
