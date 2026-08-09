import {useMemo, useState} from "react";

import {convertOrthography, type OrthographyChange} from "../orthography";
import {useI18n} from "../i18n";
import type {OrthographyCatalog} from "../types";

export function OrthographyTool({
  catalog,
  sourceCommit,
  languageName = "Amis",
  selectedDialect = "",
}: {
  catalog: OrthographyCatalog;
  sourceCommit: string;
  languageName?: string;
  selectedDialect?: string;
}) {
  const {number, tx} = useI18n();
  const languageTables = useMemo(
    () => catalog.tables.filter((table) => table.language === languageName),
    [catalog.tables, languageName],
  );
  const [tableId, setTableId] = useState(languageTables[0]?.id ?? "");
  const table = languageTables.find((item) => item.id === tableId) ?? languageTables[0];
  const [dialect, setDialect] = useState(
    table?.dialects.includes(selectedDialect) ? selectedDialect : table?.dialects[0] ?? "",
  );
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{
    text: string;
    changes: OrthographyChange[];
  } | null>(null);

  if (!table) {
    return (
      <section className="model-tool">
        <h3>{tx("Orthography assistant", "正寫法輔助工具")}</h3>
        <p className="callout callout--warning">
          {tx(`This release contains no reviewed ${languageName} conversion table. No conversion is guessed.`, `此版本沒有經審查的${languageName}轉換表，因此不會猜測任何轉換。`)}
        </p>
      </section>
    );
  }

  return (
    <section className="model-tool" aria-labelledby="orthography-heading">
      <div className="tool-heading">
        <h3 id="orthography-heading">{tx("Orthography assistant", "正寫法輔助工具")}</h3>
      </div>
      <div className="tool-grid">
        <label className="field">
          {tx("Source table", "來源表")}
          <select
            value={table.id}
            onChange={(event) => {
              const next = languageTables.find((item) => item.id === event.target.value);
              setTableId(event.target.value);
              setDialect(next?.dialects[0] ?? "");
              setResult(null);
            }}
          >
            {languageTables.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          {tx("Target dialect", "目標方言")}
          <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
            {table.dialects.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        {tx("Text to convert", "要轉換的文字")}
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} />
      </label>
      <button
        className="button button--primary"
        disabled={!input || !dialect}
        onClick={() => setResult(convertOrthography(input, table, dialect))}
      >
        {tx("Preview conversion", "預覽轉換")}
      </button>
      {result && (
        <div className="orthography-result">
          <span>{tx("Preview, not a source transcription", "此為預覽，不是來源轉錄")}</span>
          <p>{result.text}</p>
          {result.changes.length ? (
            <ol>
              {result.changes.map((change, index) => (
                <li key={`${change.position}-${index}`}>
                  {tx("position", "位置")} {number(change.position + 1)}：<code>{change.from}</code> →{" "}
                  <code>{change.to}</code>
                  {change.ambiguous && tx(" (no unambiguous mapping; preserved)", "（無明確對應，已保留）")}
                </li>
              ))}
            </ol>
          ) : (
            <small>{tx("No table-driven changes.", "轉換表未產生任何變更。")}</small>
          )}
        </div>
      )}
      <p className="source-note">
        {tx("Rule source:", "規則來源：")}{" "}
        <a
          href={`https://github.com/FormosanBank/FormosanBank/blob/${sourceCommit}/${table.source_path}`}
          target="_blank"
          rel="noreferrer"
        >
          {table.source_path}
        </a>
      </p>
    </section>
  );
}
