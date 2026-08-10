import {useI18n} from "../i18n";
import type {LookupKind} from "./SearchTool";

export function LookupKindToggle({
  kind,
  onChange,
}: {
  kind: LookupKind;
  onChange: (kind: LookupKind) => void;
}) {
  const {tx} = useI18n();
  const options = [
    {
      id: "dictionary",
      ariaLabel: tx("Dictionary lookup", "單詞釋義查詢"),
      label: tx("Dictionary", "單詞釋義"),
      description: tx("word to meaning", "從單詞查釋義"),
    },
    {
      id: "sentences",
      ariaLabel: tx("Sentence lookup", "語境例句查詢"),
      label: tx("Sentences", "語境例句"),
      description: tx("word or phrase in context", "在語境中查單詞或片語"),
    },
  ] satisfies Array<{id: LookupKind; ariaLabel: string; label: string; description: string}>;

  return (
    <div
      className="lookup-kind-toggle"
      role="group"
      aria-label={tx("Lookup type", "查詢類型")}
    >
      {options.map((option) => (
        <button
          type="button"
          key={option.id}
          aria-label={option.ariaLabel}
          aria-pressed={kind === option.id}
          aria-controls="lookup-results"
          onClick={() => onChange(option.id)}
        >
          <span aria-hidden="true">{option.id === "dictionary" ? "Aa" : "¶"}</span>
          <span>
            <strong>{option.label}</strong>
            <small>{option.description}</small>
          </span>
          <span className="lookup-kind-toggle__state">
            {kind === option.id ? tx("Selected", "已選擇") : tx("Choose", "選擇")}
          </span>
        </button>
      ))}
    </div>
  );
}
