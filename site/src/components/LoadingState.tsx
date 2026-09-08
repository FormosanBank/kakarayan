type LoadingKind = "panel" | "results" | "table" | "code" | "document" | "page";

export function ResourceGate({resource, state, children}: {
  resource: OptionalResource; state: ResourceState; children?: ReactNode;
}) {
  const retry = useContext(ResourceRetryContext);
  const {tx} = useI18n();
  if (state.status === "ready") return children;
  if (state.status === "loading") return <LoadingState compact label={tx("Loading resources", "正在載入資源")} />;
  return <div className="callout callout--error" role="status">
    <p>{tx("These resources could not be loaded.", "無法載入這些資源。")}</p>
    <button className="button button--quiet" onClick={() => retry(resource)}>{tx("Retry", "重試")}</button>
  </div>;
}

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
        {kind === "page" && <h1>Kakarayan</h1>}
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
import {useContext, type ReactNode} from "react";

import {ResourceRetryContext} from "../data";
import {useI18n} from "../i18n";
import type {OptionalResource, ResourceState} from "../types";
