import type {KeyboardEvent} from "react";

export function Tabs<T extends string>({
  items, value, onChange, label, prefix, className,
}: {
  items: ReadonlyArray<readonly [T, string]>;
  value: T;
  onChange: (value: T) => boolean | void;
  label: string;
  prefix: string;
  className: string;
}) {
  function move(event: KeyboardEvent<HTMLButtonElement>, index: number) {
    let nextIndex: number;
    if (event.key === "ArrowRight") nextIndex = (index + 1) % items.length;
    else if (event.key === "ArrowLeft") nextIndex = (index + items.length - 1) % items.length;
    else if (event.key === "Home") nextIndex = 0;
    else if (event.key === "End") nextIndex = items.length - 1;
    else return;
    event.preventDefault();
    const next = items[nextIndex];
    if (next && onChange(next[0]) !== false) {
      document.getElementById(`${prefix}-tab-${next[0]}`)?.focus();
    }
  }
  return <div className={className} role="tablist" aria-label={label}>
    {items.map(([id, text], index) => <button key={id} type="button" role="tab"
      id={`${prefix}-tab-${id}`} aria-controls={`${prefix}-${id}`}
      aria-selected={value === id} tabIndex={value === id ? 0 : -1}
      onClick={() => onChange(id)} onKeyDown={(event) => move(event, index)}>
      <span>{text}</span>
    </button>)}
  </div>;
}
