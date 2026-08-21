type LoadingKind = "panel" | "results" | "table" | "code" | "document" | "page";

function ResultsSkeleton() {
  return (
    <div className="loading-state__results" aria-hidden="true">
      {Array.from({length: 3}, (_, index) => (
        <div key={index}>
          <span />
          <span />
          <span />
        </div>
      ))}
    </div>
  );
}

function TableSkeleton({columns}: {columns: string[]}) {
  const headings = columns.length ? columns : ["", "", ""];
  return (
    <div className="loading-state__table" aria-hidden="true">
      <table>
        <thead>
          <tr>{headings.map((heading, index) => <th key={`${heading}-${index}`}>{heading}</th>)}</tr>
        </thead>
        <tbody>
          {Array.from({length: 6}, (_, row) => (
            <tr key={row}>
              {headings.map((heading, column) => (
                <td key={`${heading}-${column}`}>
                  <span data-width={(row + column) % 3} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function CodeSkeleton() {
  return (
    <div className="loading-state__code" aria-hidden="true">
      {Array.from({length: 10}, (_, index) => <span key={index} data-width={index % 4} />)}
    </div>
  );
}

function DocumentSkeleton() {
  return (
    <div className="loading-state__document" aria-hidden="true">
      <div>{Array.from({length: 7}, (_, index) => <span key={index} />)}</div>
      <div>{Array.from({length: 12}, (_, index) => <span key={index} />)}</div>
    </div>
  );
}

export function LoadingState({
  label,
  kind = "panel",
  columns = [],
  compact = false,
  className = "",
}: {
  label: string;
  kind?: LoadingKind;
  columns?: string[];
  compact?: boolean;
  className?: string;
}) {
  const classes = [
    "loading-state",
    `loading-state--${kind}`,
    compact ? "loading-state--compact" : "",
    className,
  ].filter(Boolean).join(" ");
  return (
    <section className={classes} role="status" aria-live="polite" aria-busy="true">
      <div className="loading-state__heading">
        {kind === "page" && <strong>Kakarayan</strong>}
        <span>{label}</span>
      </div>
      <div className="loading-state__rail" aria-hidden="true" />
      {kind === "results" && <ResultsSkeleton />}
      {kind === "table" && <TableSkeleton columns={columns} />}
      {kind === "code" && <CodeSkeleton />}
      {kind === "document" && <DocumentSkeleton />}
    </section>
  );
}
