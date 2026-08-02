import {useI18n} from "../i18n";
import {RESULT_TIERS, type ResultSort, type ResultTier} from "../searchResultControls";

export function SearchFilters({
  dialects,
  dialectFilter,
  hasFilters,
  onDialectChange,
  onReset,
  onSortChange,
  onTiersChange,
  requiredTiers,
  resultSort,
}: {
  dialects: string[];
  dialectFilter: string;
  hasFilters: boolean;
  onDialectChange: (value: string) => void;
  onReset: () => void;
  onSortChange: (value: ResultSort) => void;
  onTiersChange: (values: ResultTier[]) => void;
  requiredTiers: ResultTier[];
  resultSort: ResultSort;
}) {
  const {tx} = useI18n();
  return (
    <>
      <label className="field">
        {tx("Dialect", "方言")}
        <select value={dialectFilter} onChange={(event) => onDialectChange(event.target.value)}>
          <option value="">{tx("All dialect labels", "所有方言標籤")}</option>
          {dialects.map((value) => <option key={value}>{value}</option>)}
        </select>
      </label>
      <label className="field">
        {tx("Order shown results", "排序顯示結果")}
        <select value={resultSort} onChange={(event) => onSortChange(event.target.value as ResultSort)}>
          <option value="source">{tx("Deterministic source order", "固定來源順序")}</option>
          <option value="shortest">{tx("Shortest sentence first", "最短句優先")}</option>
          <option value="longest">{tx("Longest sentence first", "最長句優先")}</option>
          <option value="corpus">{tx("Corpus, dialect, source", "語料庫、方言、來源")}</option>
        </select>
      </label>
      <fieldset className="mode-picker result-tier-picker">
        <legend>{tx("Require evidence tiers", "必須包含的證據層級")}</legend>
        {RESULT_TIERS.map((value) => (
          <label key={value}>
            <input
              type="checkbox"
              checked={requiredTiers.includes(value)}
              onChange={() => onTiersChange(
                requiredTiers.includes(value)
                  ? requiredTiers.filter((item) => item !== value)
                  : [...requiredTiers, value],
              )}
            />
            <span>{{
              audio: tx("audio", "音訊"),
              phonology: tx("phonology", "音韻"),
              interlinear: tx("interlinear", "逐行分析"),
              unclear: tx("unclear annotation", "不確定標註"),
            }[value]}</span>
          </label>
        ))}
      </fieldset>
      {hasFilters && (
        <button className="text-button lookup-options__reset" type="button" onClick={onReset}>
          {tx("Reset result filters", "重設結果篩選")}
        </button>
      )}
    </>
  );
}
