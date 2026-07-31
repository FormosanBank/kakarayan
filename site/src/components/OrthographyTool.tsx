import {useMemo, useState} from "react";

import {convertOrthography, type OrthographyChange} from "../orthography";
import type {OrthographyCatalog} from "../types";

export function OrthographyTool({
  catalog,
  sourceCommit,
}: {
  catalog: OrthographyCatalog;
  sourceCommit: string;
}) {
  const amisTables = useMemo(
    () => catalog.tables.filter((table) => table.language === "Amis"),
    [catalog.tables],
  );
  const [tableId, setTableId] = useState(amisTables[0]?.id ?? "");
  const table = amisTables.find((item) => item.id === tableId) ?? amisTables[0];
  const [dialect, setDialect] = useState(table?.dialects[0] ?? "");
  const [input, setInput] = useState("");
  const [result, setResult] = useState<{
    text: string;
    changes: OrthographyChange[];
  } | null>(null);

  if (!table) {
    return (
      <section className="model-tool">
        <h3>Orthography assistant</h3>
        <p className="callout callout--warning">
          This release contains no reviewed Amis conversion table. No conversion is guessed.
        </p>
      </section>
    );
  }

  return (
    <section className="model-tool" aria-labelledby="orthography-heading">
      <div className="tool-heading">
        <div>
          <p className="eyebrow">Deterministic public table</p>
          <h3 id="orthography-heading">Orthography assistant</h3>
        </div>
        <span className="status status--local">no AI</span>
      </div>
      <p>
        Apply a named FormosanBank conversion table and inspect every change. Empty or
        ambiguous mappings are preserved and flagged.
      </p>
      <div className="tool-grid">
        <label className="field">
          Source table
          <select
            value={table.id}
            onChange={(event) => {
              const next = amisTables.find((item) => item.id === event.target.value);
              setTableId(event.target.value);
              setDialect(next?.dialects[0] ?? "");
              setResult(null);
            }}
          >
            {amisTables.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          Target dialect
          <select value={dialect} onChange={(event) => setDialect(event.target.value)}>
            {table.dialects.map((value) => (
              <option key={value}>{value}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="field">
        Text to convert
        <textarea value={input} onChange={(event) => setInput(event.target.value)} rows={4} />
      </label>
      <button
        className="button button--primary"
        disabled={!input || !dialect}
        onClick={() => setResult(convertOrthography(input, table, dialect))}
      >
        Preview conversion
      </button>
      {result && (
        <div className="orthography-result">
          <span>Preview, not a source transcription</span>
          <p>{result.text}</p>
          {result.changes.length ? (
            <ol>
              {result.changes.map((change, index) => (
                <li key={`${change.position}-${index}`}>
                  position {change.position + 1}: <code>{change.from}</code> →{" "}
                  <code>{change.to}</code>
                  {change.ambiguous && " (no unambiguous mapping; preserved)"}
                </li>
              ))}
            </ol>
          ) : (
            <small>No table-driven changes.</small>
          )}
        </div>
      )}
      <p className="source-note">
        Rule source:{" "}
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
