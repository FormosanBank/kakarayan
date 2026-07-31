import {normalizeSearch, type SearchMode} from "../data";
import type {AppData, SearchRecord} from "../types";

interface Candidate {
  key: string;
  label: string;
  records: SearchRecord[];
}

function candidateFor(record: SearchRecord, query: string, mode: SearchMode) {
  const needle = normalizeSearch(query);
  const token = record.tokens.find((item) => {
    if (mode === "source") return item.surface.normalize("NFC") === query.normalize("NFC").trim();
    if (mode === "prefix") return item.normalized.startsWith(needle);
    if (mode === "contains") return item.normalized.includes(needle);
    return item.normalized === needle;
  });
  if (token) return {key: token.normalized, label: token.surface};
  const form = record.forms.find(
    (item) => item.owner_type !== "sentence" && item.normalized.includes(needle),
  );
  return form
    ? {key: form.normalized, label: form.text}
    : {
        key: normalizeSearch(record.standard || record.original),
        label: record.standard || record.original || "untranscribed",
      };
}

function groups(records: SearchRecord[], query: string, mode: SearchMode): Candidate[] {
  const values = new Map<string, Candidate>();
  for (const record of records) {
    const candidate = candidateFor(record, query, mode);
    const existing = values.get(candidate.key);
    if (existing) existing.records.push(record);
    else values.set(candidate.key, {...candidate, records: [record]});
  }
  return [...values.values()].sort(
    (left, right) =>
      right.records.length - left.records.length || left.key.localeCompare(right.key),
  );
}

export function CandidateGroups({
  data,
  records,
  query,
  mode,
  onSave,
  onOpen,
}: {
  data: AppData;
  records: SearchRecord[];
  query: string;
  mode: SearchMode;
  onSave: (record: SearchRecord) => void;
  onOpen: (record: SearchRecord) => void;
}) {
  return (
    <div className="candidate-groups">
      <p className="callout callout--info">
        These are transparent occurrence groups, not reviewed dictionary entries. Conflicting
        spellings, dialects, and meanings remain separate in the cited occurrences.
      </p>
      {groups(records, query, mode).map((candidate) => {
        const corpora = new Set(candidate.records.map((record) => record.corpus_id));
        const variants = new Set(
          candidate.records.flatMap((record) => [record.original, record.standard]).filter(Boolean),
        );
        const meanings = new Set(
          candidate.records.flatMap((record) =>
            record.translations.map((translation) => translation.text),
          ),
        );
        const pronunciations = new Set(
          candidate.records.flatMap((record) => record.phonology.map((item) => item.text)),
        );
        return (
          <article key={candidate.key}>
            <p className="eyebrow">Automatic headword candidate</p>
            <h3>{candidate.label}</h3>
            <dl className="candidate-stats">
              <div>
                <dt>Attestations shown</dt>
                <dd>{candidate.records.length.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Corpora</dt>
                <dd>{corpora.size.toLocaleString()}</dd>
              </div>
              <div>
                <dt>Variants</dt>
                <dd>{variants.size.toLocaleString()}</dd>
              </div>
            </dl>
            {pronunciations.size > 0 && (
              <p>
                <strong>Phonology:</strong> {[...pronunciations].slice(0, 6).join(" · ")}
              </p>
            )}
            {meanings.size > 0 && (
              <ul>
                {[...meanings].slice(0, 6).map((meaning) => (
                  <li key={meaning}>{meaning}</li>
                ))}
              </ul>
            )}
            <div className="candidate-links">
              {candidate.records.slice(0, 8).map((record) => (
                <button
                  className="text-button"
                  key={record.id}
                  onClick={() => onOpen(record)}
                >
                  {data.corpora.find((item) => item.id === record.corpus_id)?.name ??
                    record.corpus_id}
                  :{record.xml_id}
                </button>
              ))}
              <button className="text-button" onClick={() => onSave(candidate.records[0]!)}>
                Save cited example
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}
